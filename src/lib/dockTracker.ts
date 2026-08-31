import type Clutter from "gi://Clutter";
import type St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

const MAX_DEPTH = 16;

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface IconRect extends Rect {
	/** The dock's app-icon actor. Passed to IconWiggler, never stored across ticks. */
	actor: Clutter.Actor;
	/**
	 * The icon's size in *logical* pixels (its `icon_size`), as opposed to
	 * `w`/`h` which are stage pixels. The two differ by the HiDPI scale
	 * factor: St sizes things logically, Clutter positions them in stage px.
	 */
	logicalSize: number;
}

/**
 * The bits of the dock's internals we duck-type. None of this is public API,
 * which is exactly why it is quarantined in one place and every access is
 * optional and guarded.
 */
interface DashLike extends Clutter.Actor {
	_box?: Clutter.Actor;
}

interface AppIconLike extends Clutter.Actor {
	icon?: { icon?: Clutter.Actor };
	app?: unknown;
}

interface DashItemLike extends Clutter.Actor {
	child?: AppIconLike;
	animatingOut?: boolean;
}

/**
 * Finds the dock and reports its geometry, without importing anything from the
 * dock extension itself.
 *
 * Importing ubuntu-dock's docking.js would give us a *second* module instance
 * whose DockManager singleton is null, so instead we duck-type the actor tree.
 * The stock GNOME dash, Ubuntu Dock, Dash to Dock and Dash to Panel all name
 * the dash widget 'dash' and all wrap each icon in a container whose `.child`
 * exposes `.icon` — this is the same predicate dash-to-dock's own
 * `getAppIcons()` uses, so it is as stable as anything available to us.
 *
 * Everything here reads *transformed* (stage-space) coordinates fresh on each
 * call. That is what makes intellihide work for free: when the dock slides
 * away, its transformed y simply moves off-screen and the cats ride along.
 */
export class DockTracker {
	private _dash: DashLike | null = null;
	private _destroyId = 0;

	/** Locate the dash, preferring one that is currently on screen. */
	private _discover(): DashLike | null {
		const found: DashLike[] = [];
		const overviewGroup = Main.layoutManager.overviewGroup;

		const visit = (actor: Clutter.Actor, depth: number): void => {
			if (!actor || depth > MAX_DEPTH) return;
			// The overview has a dash of its own; we want the one on the desktop.
			if (actor === overviewGroup) return;
			if (actor.name === "dash") found.push(actor as DashLike);
			for (const child of actor.get_children()) visit(child, depth + 1);
		};

		try {
			visit(Main.layoutManager.uiGroup, 0);
		} catch (e) {
			logError(e as Error, "ubuntu-cats: dash discovery failed");
			return null;
		}

		// Prefer a mapped dash that actually has icons in it.
		return found.find((d) => d.mapped && this._boxOf(d)) ?? found[0] ?? null;
	}

	/**
	 * `_box` is the icon container in every dash implementation we target. If a
	 * future version renames it, fall back to nothing so we degrade to "no
	 * icons found" rather than throwing.
	 */
	private _boxOf(dash: DashLike): Clutter.Actor | null {
		const box = dash._box;
		return box && typeof box.get_children === "function" ? box : null;
	}

	/** The dash actor, rediscovered if the cached one has gone away. */
	get dash(): DashLike | null {
		if (this._dash?.get_stage()) return this._dash;

		this._forget();
		this._dash = this._discover();
		if (this._dash) {
			this._destroyId = this._dash.connect("destroy", () => {
				this._dash = null;
				this._destroyId = 0;
			});
		}
		return this._dash;
	}

	private _forget(): void {
		if (this._dash && this._destroyId) {
			try {
				this._dash.disconnect(this._destroyId);
			} catch {
				// already gone
			}
		}
		this._destroyId = 0;
	}

	/** Force rediscovery, e.g. after another extension is toggled. */
	invalidate(): void {
		this._forget();
		this._dash = null;
	}

	/**
	 * The dock's visible background, if we can find it.
	 *
	 * The dash *actor* is often wider and taller than the bar you can actually
	 * see — on Ubuntu Dock it spans the whole screen while the painted panel is
	 * inset. Standing the cats on the actor's edge leaves them floating, so we
	 * prefer the 'dash-background' child when it exists.
	 */
	private _backgroundOf(dash: DashLike): Clutter.Actor | null {
		for (const child of dash.get_children()) {
			const cls = (child as St.Widget).style_class ?? "";
			if (cls.includes("dash-background")) return child;
		}
		return null;
	}

	/** Stage-space rect of the dock surface, or null if there is nothing to stand on. */
	getBarRect(): Rect | null {
		const dash = this.dash;
		if (!dash) return null;
		try {
			if (!dash.mapped || dash.opacity < 8) return null;
			const surface = this._backgroundOf(dash) ?? dash;
			const [x, y] = surface.get_transformed_position();
			const [w, h] = surface.get_transformed_size();
			if (!(w > 8 && h > 8)) return null;
			if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
			return { x, y, w, h };
		} catch {
			return null;
		}
	}

	/**
	 * Stage-space rects for every app icon on the dock, left to right.
	 * Returns [] rather than throwing if the dock's internals have moved.
	 */
	getIconRects(): IconRect[] {
		const dash = this.dash;
		if (!dash) return [];
		const box = this._boxOf(dash);
		if (!box) return [];

		const out: IconRect[] = [];
		try {
			for (const child of box.get_children()) {
				const item = child as DashItemLike;
				const icon = item.child;
				if (!icon?.icon || item.animatingOut || !icon.mapped) continue;
				// Measure the drawn icon rather than the button around it: the
				// button carries padding and label space, which would make the
				// cats oversized and the scratch zones too wide.
				const visual = icon.icon.icon ?? icon;
				const [x, y] = visual.get_transformed_position();
				const [w, h] = visual.get_transformed_size();
				if (!(w > 4 && h > 4) || !Number.isFinite(x)) continue;
				const logical = (visual as St.Icon).icon_size;
				out.push({
					actor: icon,
					x,
					y,
					w,
					h,
					logicalSize: typeof logical === "number" && logical > 0 ? logical : 0,
				});
			}
		} catch {
			return [];
		}
		return out;
	}

	/**
	 * The y the cats' feet rest on: the bottom edge of the monitor the dock is
	 * on.
	 *
	 * Not the dock's own bottom edge — a floating dock stops short of the
	 * screen edge, and standing the cats there leaves them hovering just above
	 * the floor. The monitor bottom is what "walking along the bottom of the
	 * screen" actually means.
	 */
	/**
	 * Stage-space rect of the monitor the dock is on. This, not the dock, is
	 * what bounds the cats: they are free to roam the whole bottom edge.
	 */
	getMonitorRect(): Rect | null {
		const dash = this.dash;
		if (!dash) return null;
		try {
			const monitor =
				Main.layoutManager.findMonitorForActor(dash) ??
				Main.layoutManager.primaryMonitor;
			if (!monitor) return null;
			return {
				x: monitor.x,
				y: monitor.y,
				w: monitor.width,
				h: monitor.height,
			};
		} catch {
			return null;
		}
	}

	/**
	 * The y the cats' feet rest on: the bottom edge of the dock's monitor.
	 *
	 * Not the dock's own bottom edge — a floating dock stops short of the
	 * screen edge, and standing the cats there leaves them hovering just above
	 * the floor.
	 */
	getFloorY(): number | null {
		const monitor = this.getMonitorRect();
		return monitor ? monitor.y + monitor.h : null;
	}

	/** True when the dock is visible and the cats should be drawn. */
	isUsable(): boolean {
		if (Main.overview.visible) return false;
		const monitor = Main.layoutManager.primaryMonitor;
		if (monitor?.inFullscreen) return false;

		const bar = this.getBarRect();
		if (!bar) return false;

		// Off the bottom/side of the screen means intellihide has parked it.
		const stageH = global.stage.height;
		const stageW = global.stage.width;
		return (
			bar.y < stageH - 4 &&
			bar.x < stageW - 4 &&
			bar.y + bar.h > 4 &&
			bar.x + bar.w > 4
		);
	}

	destroy(): void {
		this.invalidate();
	}
}
