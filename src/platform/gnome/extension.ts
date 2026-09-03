import type Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import GLib from "gi://GLib";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { SCRATCH_SECONDS } from "../../core/cat.js";
import {
	ACTIVE_INTERVAL_MS,
	boundsOfMonitor,
	Colony,
	DROWSY_INTERVAL_MS,
	PointerTracker,
} from "../../core/colony.js";
import {
	BOOL_SETTINGS,
	defaultSettings,
	INT_SETTINGS,
	PALETTES_KEY,
	type Settings,
} from "../../core/config.js";
import { CatLayer } from "./catLayer.js";
import { DockTracker, iconActor } from "./dockTracker.js";
import { IconWiggler } from "./iconWiggle.js";
import { SpriteSet } from "./sprites.js";

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
	colony: Colony;
	shaking: Set<Clutter.Actor>;
}

export default class UbuntuCatsExtension extends Extension {
	private _rt: Runtime | null = null;
	private _cfg: Settings = defaultSettings();

	private readonly _pointer = new PointerTracker();
	private _lastTick = 0;
	private _intervalMs = 0;
	private _timeoutId = 0;
	private _settingsId = 0;
	private _extensionsId = 0;
	private _monitorsId = 0;

	override enable(): void {
		const sprites = new SpriteSet(this.path);
		const layer = new CatLayer();
		const rt: Runtime = {
			settings: this.getSettings(),
			sprites,
			tracker: new DockTracker(),
			layer,
			wiggler: new IconWiggler(),
			colony: new Colony({
				sprites,
				createView: () => layer.createView(),
			}),
			shaking: new Set(),
		};
		this._rt = rt;

		this._pointer.reset();
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
			rt.colony.destroy();
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

	/**
	 * Read GSettings into the shared settings shape.
	 *
	 * Driven by the key tables in core/config.ts rather than a hand-written
	 * list, so a new setting cannot be wired up on one platform and forgotten
	 * on the other.
	 */
	private _readConfig(rt: Runtime): void {
		const s = rt.settings;
		const cfg = defaultSettings();
		for (const [name, spec] of Object.entries(INT_SETTINGS))
			(cfg as unknown as Record<string, number>)[name] = s.get_int(spec.key);
		for (const [name, spec] of Object.entries(BOOL_SETTINGS))
			(cfg as unknown as Record<string, boolean>)[name] = s.get_boolean(
				spec.key,
			);
		cfg.palettes = s.get_strv(PALETTES_KEY);
		this._cfg = cfg;
	}

	private _onSettingChanged(key: string): void {
		const rt = this._rt;
		if (!rt) return;
		this._readConfig(rt);
		if (
			key === INT_SETTINGS.count.key ||
			key === PALETTES_KEY ||
			key === INT_SETTINGS.spriteSize.key
		)
			this._syncCats(rt);
		if (key === BOOL_SETTINGS.wiggleIcons.key && !this._cfg.wiggleIcons)
			this._releaseAllShaken(rt);
		// Wake up so the change is visible immediately.
		this._setInterval(ACTIVE_INTERVAL_MS);
	}

	private _rediscover(): void {
		this._rt?.tracker.invalidate();
		this._rt?.layer.raise();
	}

	private _syncCats(rt: Runtime): void {
		const monitor = rt.tracker.getMonitorRect();
		rt.colony.sync(
			this._cfg,
			rt.tracker.getIconRects(),
			monitor ? boundsOfMonitor(monitor) : null,
			(cat) => this._releaseShaken(rt, cat),
		);
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

		const [px, py] = global.get_pointer();
		this._pointer.update(dt, px, py);

		let wanted = ACTIVE_INTERVAL_MS;
		const monitor = rt.tracker.isUsable() ? rt.tracker.getMonitorRect() : null;
		if (monitor) {
			rt.layer.show();
			rt.colony.update(
				dt,
				{
					...boundsOfMonitor(monitor),
					icons: rt.tracker.getIconRects(),
					pointer: this._pointer.sample,
				},
				this._cfg,
			);
			this._applyWiggles(rt);
			if (rt.colony.allAsleep(this._cfg)) wanted = DROWSY_INTERVAL_MS;
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

	/** Shake the icons being clawed this tick; release the ones that are not. */
	private _applyWiggles(rt: Runtime): void {
		const stillShaking = new Set<Clutter.Actor>();

		if (this._cfg.wiggleIcons) {
			for (const cat of rt.colony.cats) {
				const target = cat.scratchTarget;
				if (!target) continue;
				const actor = iconActor(target);
				// Ease the shake in and out so it does not snap on and off.
				const p = Math.min(1, Math.max(0, cat.stateTime / SCRATCH_SECONDS));
				rt.wiggler.shake(actor, cat.stateTime, Math.sin(p * Math.PI));
				stillShaking.add(actor);
			}
		}

		for (const actor of rt.shaking) {
			if (!stillShaking.has(actor)) rt.wiggler.release(actor);
		}
		rt.shaking = stillShaking;
	}

	private _releaseShaken(rt: Runtime, cat: Colony["cats"][number]): void {
		const target = cat.scratchTarget;
		if (target) {
			const actor = iconActor(target);
			rt.wiggler.release(actor);
			rt.shaking.delete(actor);
		}
	}

	private _releaseAllShaken(rt: Runtime): void {
		if (!rt.shaking.size) return;
		for (const actor of rt.shaking) rt.wiggler.release(actor);
		rt.shaking.clear();
	}
}
