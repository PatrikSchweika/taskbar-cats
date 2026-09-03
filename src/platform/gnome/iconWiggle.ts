import type Clutter from "gi://Clutter";

const SHAKE_DEGREES = 6.5;
const SHAKE_HZ = 7.0;

/** What we need from a dock app-icon in order to reach its inner icon. */
interface AppIconLike extends Clutter.Actor {
	icon?: { icon?: Clutter.Actor };
}

interface Original {
	angle: number;
	pivotX: number;
	pivotY: number;
	destroyId: number;
}

/**
 * Rocks a real dock icon while a cat claws at it.
 *
 * This is the only part of the extension that mutates another extension's
 * actors, so it is deliberately the only place that needs auditing.
 *
 * Three rules keep it safe:
 *   1. We drive `rotation_angle_z` directly from our own tick rather than
 *      installing a Clutter transition. Nothing to cancel, nothing to collide
 *      with the dock's own hover-zoom animations, and the value is always
 *      exactly what we last wrote.
 *   2. We target the inner icon rather than the button, for the same reason.
 *   3. Every actor we touch is recorded with its original rotation and pivot,
 *      and restored in restoreAll(). Dock icons are destroyed and recreated
 *      whenever the app list changes, so we also drop our reference on
 *      'destroy' rather than holding a stale actor.
 */
export class IconWiggler {
	private readonly _touched = new Map<Clutter.Actor, Original>();

	/** The inner icon if we can reach it, else the actor itself. */
	static target(appIcon: Clutter.Actor | null): Clutter.Actor | null {
		if (!appIcon) return null;
		return (appIcon as AppIconLike).icon?.icon ?? appIcon;
	}

	private _remember(actor: Clutter.Actor): Original {
		const existing = this._touched.get(actor);
		if (existing) return existing;

		const pivot = actor.pivot_point;
		const entry: Original = {
			angle: actor.rotation_angle_z,
			pivotX: pivot ? pivot.x : 0,
			pivotY: pivot ? pivot.y : 0,
			destroyId: 0,
		};
		entry.destroyId = actor.connect("destroy", () => {
			this._touched.delete(actor);
		});
		this._touched.set(actor, entry);
		return entry;
	}

	/**
	 * Drive one icon's shake. `elapsed` is seconds since the scratch started;
	 * `strength` fades the motion in and out so it does not snap.
	 */
	shake(appIcon: Clutter.Actor, elapsed: number, strength = 1): void {
		const actor = IconWiggler.target(appIcon);
		if (!actor) return;
		try {
			const base = this._remember(actor);
			actor.set_pivot_point(0.5, 1.0);
			actor.rotation_angle_z =
				base.angle +
				SHAKE_DEGREES * strength * Math.sin(elapsed * Math.PI * 2 * SHAKE_HZ);
		} catch {
			// The icon vanished mid-scratch; nothing to do.
		}
	}

	/** Put one icon back exactly as we found it. */
	release(appIcon: Clutter.Actor): void {
		this._restore(IconWiggler.target(appIcon));
	}

	private _restore(actor: Clutter.Actor | null): void {
		if (!actor) return;
		const entry = this._touched.get(actor);
		if (!entry) return;
		try {
			actor.rotation_angle_z = entry.angle;
			actor.set_pivot_point(entry.pivotX, entry.pivotY);
			if (entry.destroyId) actor.disconnect(entry.destroyId);
		} catch {
			// Already destroyed; the Map entry is all that is left to clean up.
		}
		this._touched.delete(actor);
	}

	/** Called from disable(). Must leave the dock exactly as we found it. */
	restoreAll(): void {
		for (const actor of [...this._touched.keys()]) this._restore(actor);
		this._touched.clear();
	}
}
