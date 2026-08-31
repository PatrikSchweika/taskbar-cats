import type Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import GLib from "gi://GLib";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Cat, type CatConfig, State } from "./lib/cat.js";
import { CatLayer } from "./lib/catLayer.js";
import { DockTracker, type IconRect } from "./lib/dockTracker.js";
import { IconWiggler } from "./lib/iconWiggle.js";
import { SpriteSet } from "./lib/sprites.js";

const ACTIVE_INTERVAL_MS = 33; // ~30Hz while anything is happening
const DROWSY_INTERVAL_MS = 250; // when every cat is asleep or the dock is gone
const POINTER_EPS = 2; // px of jitter that does not count as movement
const SCRATCH_SECONDS = 1.7; // must match cat.ts
const DEFAULT_SIZE = 40; // used only until the dock can be measured

/** Everything _readConfig() pulls out of GSettings. */
interface Config extends CatConfig {
	count: number;
	palettes: string[];
	wiggleIcons: boolean;
	spriteSize: number;
}

/**
 * Everything that exists only while the extension is enabled.
 *
 * Grouping these into one nullable object rather than six separate nullable
 * fields means each method narrows once at the top and then works with
 * non-null values — and disable() releases the whole graph by clearing a
 * single reference.
 */
interface Runtime {
	settings: Gio.Settings;
	sprites: SpriteSet;
	tracker: DockTracker;
	layer: CatLayer;
	wiggler: IconWiggler;
	cats: Cat[];
	shaking: Set<Clutter.Actor>;
}

export default class UbuntuCatsExtension extends Extension {
	private _rt: Runtime | null = null;
	private _cfg!: Config;

	private _currentSize = 0;
	private _pointer: [number, number] = [-1, -1];
	private _pointerIdle = 0;
	private _lastTick = 0;
	private _intervalMs = 0;
	private _timeoutId = 0;
	private _settingsId = 0;
	private _extensionsId = 0;
	private _monitorsId = 0;

	override enable(): void {
		const sprites = new SpriteSet(this.path);
		const rt: Runtime = {
			settings: this.getSettings(),
			sprites,
			tracker: new DockTracker(),
			layer: new CatLayer(),
			wiggler: new IconWiggler(),
			cats: [],
			shaking: new Set(),
		};
		this._rt = rt;

		this._currentSize = 0;
		this._pointer = [-1, -1];
		this._pointerIdle = 0;
		this._lastTick = GLib.get_monotonic_time() / 1e6;
		this._intervalMs = 0;
		this._timeoutId = 0;

		this._readConfig(rt);
		this._syncCats(rt);

		this._settingsId = rt.settings.connect(
			"changed",
			(_s: Gio.Settings, key: string) => {
				this._onSettingChanged(key);
			},
		);

		// The dock can be replaced wholesale when extensions are toggled, and
		// moves when the monitor layout changes. Both invalidate our cached
		// dash actor.
		this._extensionsId = Main.extensionManager.connect(
			"extension-state-changed",
			() => {
				this._rediscover();
			},
		);
		this._monitorsId = Main.layoutManager.connect("monitors-changed", () => {
			this._rt?.layer.syncSize();
			this._rediscover();
		});

		this._setInterval(ACTIVE_INTERVAL_MS);
	}

	override disable(): void {
		// Teardown runs step by step, each under its own guard. A throw in any
		// one step must not leave the tick running or skip restoring the dock —
		// those are the only two things that could outlive us.
		const rt = this._rt;
		this._rt = null;

		const step = (what: string, fn: () => void): void => {
			try {
				fn();
			} catch (e) {
				logError(e as Error, `ubuntu-cats: teardown step '${what}' failed`);
			}
		};

		step("timeout", () => {
			if (this._timeoutId) {
				GLib.Source.remove(this._timeoutId);
				this._timeoutId = 0;
			}
		});
		step("settings", () => {
			if (this._settingsId) {
				rt?.settings.disconnect(this._settingsId);
				this._settingsId = 0;
			}
		});
		step("extensionManager", () => {
			if (this._extensionsId) {
				Main.extensionManager.disconnect(this._extensionsId);
				this._extensionsId = 0;
			}
		});
		step("monitors", () => {
			if (this._monitorsId) {
				Main.layoutManager.disconnect(this._monitorsId);
				this._monitorsId = 0;
			}
		});

		if (!rt) return;

		// Put every dock icon we touched back exactly as we found it.
		step("restoreIcons", () => {
			rt.wiggler.restoreAll();
		});
		step("cats", () => {
			for (const cat of rt.cats) cat.destroy();
		});
		step("layer", () => {
			rt.layer.destroy();
		});
		step("tracker", () => {
			rt.tracker.destroy();
		});
		step("sprites", () => {
			rt.sprites.destroy();
		});
	}

	// -- configuration ------------------------------------------------------

	private _readConfig(rt: Runtime): void {
		const s = rt.settings;
		this._cfg = {
			count: s.get_int("cat-count"),
			palettes: rt.sprites.resolvePalettes(s.get_strv("palettes")),
			maxSpeed: s.get_int("max-speed"),
			attraction: s.get_int("mouse-attraction"),
			attractRadius: s.get_int("attract-radius"),
			scratchIcons: s.get_boolean("scratch-icons"),
			wiggleIcons: s.get_boolean("wiggle-icons"),
			spriteSize: s.get_int("sprite-size"),
			sleepAfter: s.get_int("sleep-after"),
			fps: s.get_int("animation-fps"),
		};
	}

	private _onSettingChanged(key: string): void {
		const rt = this._rt;
		if (!rt) return;
		this._readConfig(rt);
		if (key === "cat-count" || key === "palettes" || key === "sprite-size")
			this._syncCats(rt);
		if (key === "wiggle-icons" && !this._cfg.wiggleIcons)
			this._releaseAllShaken(rt);
		// Wake up so the change is visible immediately.
		this._setInterval(ACTIVE_INTERVAL_MS);
	}

	private _rediscover(): void {
		this._rt?.tracker.invalidate();
		this._rt?.layer.raise();
	}

	/**
	 * Cat size: the dock's own icon size unless the user pinned one.
	 *
	 * The dock often does not exist yet when we are enabled — extension load
	 * order is not guaranteed — so this is recomputed from the icons we already
	 * measured each tick, rather than once at startup.
	 */
	private _spriteSizeFrom(icons: IconRect[]): number {
		if (this._cfg.spriteSize > 0) return this._cfg.spriteSize;
		// Match the dock's *logical* icon size. Using the measured stage height
		// would make the cats scale-factor times too big on a HiDPI display.
		const sizes = icons.map((i) => i.logicalSize).filter((n) => n > 0);
		const median = sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)];
		if (median === undefined) return DEFAULT_SIZE;
		return Math.round(Math.min(96, Math.max(20, median)));
	}

	/** Palette for the nth cat, cycling through whatever is enabled. */
	private _paletteFor(index: number): string {
		const { palettes } = this._cfg;
		return palettes[index % palettes.length] ?? "tabby-orange";
	}

	private _syncCats(rt: Runtime): void {
		const size = this._spriteSizeFrom(rt.tracker.getIconRects());
		const bar = rt.tracker.getBarRect();

		while (rt.cats.length > this._cfg.count) {
			const cat = rt.cats.pop();
			if (!cat) break;
			this._releaseShaken(rt, cat);
			cat.destroy();
		}

		while (rt.cats.length < this._cfg.count) {
			const i = rt.cats.length;
			const x = bar
				? bar.x + (bar.w * (i + 1)) / (this._cfg.count + 1)
				: 100 + i * 60;
			const cat = new Cat({
				sprites: rt.sprites,
				palette: this._paletteFor(i),
				size,
				x,
				index: i,
			});
			rt.layer.add(cat.actor);
			rt.cats.push(cat);
		}

		// Palette assignment and size can change without the count changing.
		rt.cats.forEach((cat, i) => {
			cat.palette = this._paletteFor(i);
			cat.index = i;
			cat.setSize(size);
		});
		this._currentSize = size;
	}

	// -- main loop ----------------------------------------------------------

	private _setInterval(ms: number): void {
		if (!this._rt) return;
		if (ms === this._intervalMs && this._timeoutId) return;
		if (this._timeoutId) {
			GLib.Source.remove(this._timeoutId);
			this._timeoutId = 0;
		}
		this._intervalMs = ms;
		this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () =>
			this._tick(),
		);
		GLib.Source.set_name_by_id(this._timeoutId, "[ubuntu-cats] tick");
	}

	private _tick(): boolean {
		// Belt and braces: if teardown ever fails to remove the source, the
		// callback still stops working against torn-down state.
		const rt = this._rt;
		if (!rt) return GLib.SOURCE_REMOVE;

		const now = GLib.get_monotonic_time() / 1e6;
		// Clamp dt so a stalled shell does not teleport every cat.
		const dt = Math.min(0.2, Math.max(0.001, now - this._lastTick));
		this._lastTick = now;

		this._updatePointer(dt);

		let wanted = ACTIVE_INTERVAL_MS;
		if (rt.tracker.isUsable()) {
			rt.layer.show();
			this._updateCats(rt, dt);
			if (this._allAsleep(rt)) wanted = DROWSY_INTERVAL_MS;
		} else {
			rt.layer.hide();
			this._releaseAllShaken(rt);
			wanted = DROWSY_INTERVAL_MS;
		}

		// Changing the interval means swapping the source, so retire this one.
		if (wanted !== this._intervalMs) {
			this._intervalMs = wanted;
			this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, wanted, () =>
				this._tick(),
			);
			GLib.Source.set_name_by_id(this._timeoutId, "[ubuntu-cats] tick");
			return GLib.SOURCE_REMOVE;
		}
		return GLib.SOURCE_CONTINUE;
	}

	private _updatePointer(dt: number): void {
		const [px, py] = global.get_pointer();
		const [lx, ly] = this._pointer;
		if (Math.abs(px - lx) > POINTER_EPS || Math.abs(py - ly) > POINTER_EPS) {
			this._pointer = [px, py];
			this._pointerIdle = 0;
		} else {
			this._pointerIdle += dt;
		}
	}

	private _updateCats(rt: Runtime, dt: number): void {
		const bar = rt.tracker.getBarRect();
		if (!bar) return;
		const icons = rt.tracker.getIconRects();

		// The dock may have appeared, or changed icon size, since we last
		// looked. Cats resize to match rather than staying at the fallback.
		const size = this._spriteSizeFrom(icons);
		if (size !== this._currentSize) {
			this._currentSize = size;
			for (const cat of rt.cats) cat.setSize(size);
		}

		const ctx = {
			bar,
			floorY: rt.tracker.getFloorY() ?? bar.y + bar.h,
			icons,
			pointer: {
				x: this._pointer[0],
				y: this._pointer[1],
				idleTime: this._pointerIdle,
			},
			neighbours: rt.cats,
			cfg: this._cfg,
		};

		for (const cat of rt.cats) cat.update(dt, ctx);

		this._applyWiggles(rt);
	}

	/** Shake the icons being clawed this tick; release the ones that are not. */
	private _applyWiggles(rt: Runtime): void {
		const stillShaking = new Set<Clutter.Actor>();

		if (this._cfg.wiggleIcons) {
			for (const cat of rt.cats) {
				const target = cat.scratchTarget;
				if (!target) continue;
				// Ease the shake in and out so it does not snap on and off.
				const p = Math.min(1, Math.max(0, cat.stateTime / SCRATCH_SECONDS));
				rt.wiggler.shake(target.actor, cat.stateTime, Math.sin(p * Math.PI));
				stillShaking.add(target.actor);
			}
		}

		for (const actor of rt.shaking) {
			if (!stillShaking.has(actor)) rt.wiggler.release(actor);
		}
		rt.shaking = stillShaking;
	}

	private _releaseShaken(rt: Runtime, cat: Cat): void {
		const target = cat.scratchTarget;
		if (target) {
			rt.wiggler.release(target.actor);
			rt.shaking.delete(target.actor);
		}
	}

	private _releaseAllShaken(rt: Runtime): void {
		if (!rt.shaking.size) return;
		for (const actor of rt.shaking) rt.wiggler.release(actor);
		rt.shaking.clear();
	}

	private _allAsleep(rt: Runtime): boolean {
		return (
			this._cfg.sleepAfter > 0 &&
			rt.cats.length > 0 &&
			rt.cats.every((c) => c.state === State.SLEEP)
		);
	}
}
