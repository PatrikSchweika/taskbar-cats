import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import {
	Arranger,
	type PositionList,
	type PositionPatch,
	resetAllPositions,
} from "../../core/arrange.js";
import { SCRATCH_SECONDS } from "../../core/cat.js";
import {
	ACTIVE_INTERVAL_MS,
	type Bounds,
	boundsOfMonitor,
	Colony,
	DROWSY_INTERVAL_MS,
	PointerTracker,
} from "../../core/colony.js";
import {
	ARRANGE_KEY,
	BOOL_SETTINGS,
	CAT_SIZES_KEY,
	defaultSettings,
	HOTKEY_KEY,
	INT_SETTINGS,
	normalizeCatSizes,
	normalizeHotkey,
	normalizePositions,
	normalizeStringList,
	POSITION_SETTINGS,
	type Settings,
	STRING_LIST_SETTINGS,
} from "../../core/config.js";
import { ArrangeBar } from "./arrangeBar.js";
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

/** Arrange mode, while it is on: the drag logic and its toolbar. */
interface Arranging {
	arranger: Arranger;
	bar: ArrangeBar;
}

/** How far the toolbar stands above the tallest piece of furniture, in px. */
const BAR_GAP = 8;

export default class TaskbarCatsExtension extends Extension {
	private _rt: Runtime | null = null;
	private _cfg: Settings = defaultSettings();
	/** Set by the hotkey. Runtime only: a fresh enable always shows the cats. */
	private _hidden = false;
	private _arranging: Arranging | null = null;
	/** Set while {@link _savePositions} writes, which re-lays out once after. */
	private _savingPositions = false;

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
				createPropView: () => layer.createPropView(),
				createToyView: () => layer.createToyView(),
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

		// A shell restart never comes back up arranging. Cleared before
		// listening, so this write is not mistaken for the user switching it.
		this._arranging = null;
		if (rt.settings.get_boolean(ARRANGE_KEY))
			rt.settings.set_boolean(ARRANGE_KEY, false);
		this._settingsId = rt.settings.connect(
			"changed",
			(_s: Gio.Settings, key: string) => {
				this._onSettingChanged(key);
			},
		);

		this._hidden = false;
		// GNOME re-reads the accelerator from the settings key whenever it
		// changes, so the prefs dialog needs no extra wiring to rebind it.
		Main.wm.addKeybinding(
			HOTKEY_KEY,
			rt.settings,
			Meta.KeyBindingFlags.NONE,
			Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
			() => this._toggleHidden(),
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
				logError(e as Error, `taskbar-cats: teardown step '${what}' failed`);
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
		step("keybinding", () => {
			Main.wm.removeKeybinding(HOTKEY_KEY);
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

		// Before the layer goes, so nothing is left reactive or switched on.
		step("arrange", () => {
			this._stopArranging(rt);
		});
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
		for (const [name, spec] of Object.entries(POSITION_SETTINGS))
			(cfg as unknown as Record<string, number[]>)[name] = normalizePositions(
				s.get_value(spec.key).deepUnpack<number[]>(),
			);
		for (const [name, spec] of Object.entries(STRING_LIST_SETTINGS))
			(cfg as unknown as Record<string, string[]>)[name] = normalizeStringList(
				s.get_strv(spec.key),
			);
		cfg.catSizes = normalizeCatSizes(
			s.get_value(CAT_SIZES_KEY).deepUnpack<number[]>(),
		);
		cfg.toggleHotkey = normalizeHotkey(s.get_strv(HOTKEY_KEY));
		this._cfg = cfg;
	}

	private _onSettingChanged(key: string): void {
		const rt = this._rt;
		if (!rt || this._savingPositions) return;
		this._readConfig(rt);
		if (
			key === INT_SETTINGS.count.key ||
			key === INT_SETTINGS.beds.key ||
			key === INT_SETTINGS.scratchers.key ||
			key === INT_SETTINGS.bowls.key ||
			key === INT_SETTINGS.mouseInterval.key ||
			key === POSITION_SETTINGS.bedPositions.key ||
			key === POSITION_SETTINGS.scratcherPositions.key ||
			key === POSITION_SETTINGS.bowlPositions.key ||
			key === STRING_LIST_SETTINGS.catPalettes.key ||
			key === CAT_SIZES_KEY
		) {
			this._syncCats(rt);
			// A count change rebuilds the props; a drag on one that's gone
			// is dropped, not saved.
			const pressed = this._arranging?.arranger.pressed;
			if (pressed && !rt.colony.props.includes(pressed))
				this._arranging?.arranger.cancel();
		}
		if (key === ARRANGE_KEY) {
			if (rt.settings.get_boolean(ARRANGE_KEY)) this._startArranging(rt);
			else this._stopArranging(rt);
		}
		if (key === BOOL_SETTINGS.wiggleIcons.key && !this._cfg.wiggleIcons)
			this._releaseAllShaken(rt);
		// Wake up so the change is visible immediately.
		this._setInterval(ACTIVE_INTERVAL_MS);
	}

	private _rediscover(): void {
		this._rt?.tracker.invalidate();
		this._rt?.layer.raise();
	}

	private _toggleHidden(): void {
		this._hidden = !this._hidden;
		if (this._hidden && this._rt) this._stopArranging(this._rt);
		// Wake the tick so the change shows at once rather than at the next
		// drowsy interval.
		this._setInterval(ACTIVE_INTERVAL_MS);
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
		GLib.Source.set_name_by_id(this._timeoutId, "[taskbar-cats] tick");
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

		const [px, py, mods] = global.get_pointer();
		this._pointer.update(dt, px, py);

		let wanted = ACTIVE_INTERVAL_MS;
		const monitor =
			!this._hidden && rt.tracker.isUsable()
				? rt.tracker.getMonitorRect()
				: null;
		if (monitor) {
			const bounds = boundsOfMonitor(monitor);
			if (this._arranging)
				this._updateArranging(rt, this._arranging, dt, now, bounds, px, mods);
			rt.layer.show();
			rt.colony.update(
				dt,
				{
					...bounds,
					icons: rt.tracker.getIconRects(),
					pointer: this._pointer.sample,
				},
				this._cfg,
			);
			this._applyWiggles(rt);
			if (this._arranging) this._decorateArranging(rt, this._arranging, bounds);
			else if (rt.colony.allAsleep(this._cfg)) wanted = DROWSY_INTERVAL_MS;
		} else {
			// Hidden, the overview, or the dock gone: nothing to arrange on.
			this._stopArranging(rt);
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
			GLib.Source.set_name_by_id(this._timeoutId, "[taskbar-cats] tick");
			return GLib.SOURCE_REMOVE;
		}
		return GLib.SOURCE_CONTINUE;
	}

	// -- arrange mode -------------------------------------------------------

	private _startArranging(rt: Runtime): void {
		if (this._arranging) return;
		rt.layer.setArranging(true, (x, y) => this._onArrangePress(x, y));
		this._arranging = {
			arranger: new Arranger(rt.colony),
			bar: new ArrangeBar(rt.layer.actor, {
				reset: () => this._savePositions(rt, resetAllPositions()),
				done: () => this._stopArranging(rt),
			}),
		};
	}

	/** Leave arrange mode, whichever way it ended. Safe to call when off. */
	private _stopArranging(rt: Runtime): void {
		const arranging = this._arranging;
		if (!arranging) return;
		this._arranging = null;
		arranging.arranger.cancel();
		rt.layer.setArranging(false);
		arranging.bar.destroy();
		if (rt.settings.get_boolean(ARRANGE_KEY))
			rt.settings.set_boolean(ARRANGE_KEY, false);
	}

	/** A press on a prop, in stage pixels: the space the colony works in. */
	private _onArrangePress(x: number, y: number): void {
		const rt = this._rt;
		const monitor = rt?.tracker.getMonitorRect();
		if (!rt || !monitor || !this._arranging) return;
		const now = GLib.get_monotonic_time() / 1e6;
		this._arranging.arranger.press(now, x, y, boundsOfMonitor(monitor).floorY);
	}

	/**
	 * Follow a held press by polling the pointer, before the props are placed.
	 * Polling rather than grabbing the pointer means a lost release can never
	 * lock up the desktop.
	 */
	private _updateArranging(
		rt: Runtime,
		arranging: Arranging,
		dt: number,
		now: number,
		bounds: Bounds,
		px: number,
		mods: Clutter.ModifierType,
	): void {
		const { arranger } = arranging;
		if (!arranger.tick(dt)) {
			this._stopArranging(rt);
			return;
		}
		if (!arranger.pressed) return;
		if (mods & Clutter.ModifierType.BUTTON1_MASK) {
			arranger.move(px, bounds.roam);
			return;
		}
		const patch = arranger.release(now, this._cfg, bounds.roam);
		if (patch) this._savePositions(rt, patch);
	}

	/** Mark the pinned props and stand the toolbar above the furniture. */
	private _decorateArranging(
		rt: Runtime,
		arranging: Arranging,
		bounds: Bounds,
	): void {
		const props = rt.colony.props;
		for (const prop of props)
			rt.layer.markPinned(prop.view, prop.pinned !== null);
		const tallest = Math.max(0, ...props.map((p) => p.size));
		arranging.bar.setEmpty(props.length === 0);
		arranging.bar.place(
			(bounds.roam.min + bounds.roam.max) / 2,
			bounds.floorY - tallest - BAR_GAP,
		);
	}

	/**
	 * Write a patch of position lists, laying the furniture out once rather
	 * than once per list. `settings.delay()` would not do it: GSettings still
	 * emits `changed` for each write as it is made, and once delayed a
	 * settings object stays delayed, holding back every later write too.
	 */
	private _savePositions(rt: Runtime, patch: PositionPatch): void {
		const entries = Object.entries(patch) as [PositionList, number[]][];
		this._savingPositions = true;
		try {
			for (const [name, list] of entries)
				rt.settings.set_value(
					POSITION_SETTINGS[name].key,
					new GLib.Variant("ai", list),
				);
		} finally {
			this._savingPositions = false;
		}
		const last = entries.at(-1);
		if (last) this._onSettingChanged(POSITION_SETTINGS[last[0]].key);
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
