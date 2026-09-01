/**
 * The colony: everything about keeping a set of cats alive that is not physics
 * and not platform.
 *
 * Extracted so the GNOME extension and the Windows overlay share cat count,
 * palette cycling, auto-sizing against the dock, sleep detection and pointer
 * idle tracking. Both platforms then reduce to "find the dock, build a World,
 * call update()".
 */
import { Cat, type CatConfig, State } from "./cat.js";
import type { Settings } from "./config.js";
import { resolvePalettes } from "./sprites.js";
import type { CatView, IconRect, Rect, SpriteSource } from "./types.js";

export const ACTIVE_INTERVAL_MS = 33; // ~30Hz while anything is happening
export const DROWSY_INTERVAL_MS = 250; // when every cat is asleep or the dock is gone
const POINTER_EPS = 2; // px of jitter that does not count as movement
const DEFAULT_SIZE = 40; // used only until the dock can be measured
const FALLBACK_PALETTE = "tabby-orange";

/** How far the cats may walk, and where the floor is. */
export interface Bounds {
	/** Horizontal range, inclusive of the cats' own width. */
	roam: { min: number; max: number };
	/** The y the cats' feet rest on. */
	floorY: number;
}

/** Everything the simulation needs to know about the desktop this tick. */
export interface World extends Bounds {
	icons: IconRect[];
	pointer: { x: number; y: number; idleTime: number };
}

/** The bounds of a monitor: what both platforms derive them from. */
export function boundsOfMonitor(monitor: Rect): Bounds {
	return {
		roam: { min: monitor.x, max: monitor.x + monitor.w },
		floorY: monitor.y + monitor.h,
	};
}

/**
 * Turns raw pointer samples into "how long has it been still", which is what
 * makes the cats nap.
 *
 * Kept separate from the platform because the *rule* (a couple of px of jitter
 * is not movement) should not differ between them, even though GNOME asks
 * Clutter for the pointer and Windows asks GetCursorPos.
 */
export class PointerTracker {
	x = -1;
	y = -1;
	idleTime = 0;

	reset(): void {
		this.x = -1;
		this.y = -1;
		this.idleTime = 0;
	}

	update(dt: number, x: number, y: number): void {
		if (
			Math.abs(x - this.x) > POINTER_EPS ||
			Math.abs(y - this.y) > POINTER_EPS
		) {
			this.x = x;
			this.y = y;
			this.idleTime = 0;
		} else {
			this.idleTime += dt;
		}
	}

	/** The pointer as the simulation wants it. */
	get sample(): { x: number; y: number; idleTime: number } {
		return { x: this.x, y: this.y, idleTime: this.idleTime };
	}
}

export interface ColonyHost {
	readonly sprites: SpriteSource;
	/** Make a view for one more cat, already attached to the overlay. */
	createView(): CatView;
}

export class Colony {
	readonly cats: Cat[] = [];
	private readonly _host: ColonyHost;
	private _size = 0;

	constructor(host: ColonyHost) {
		this._host = host;
	}

	/**
	 * Cat size: the dock's own icon size unless the user pinned one.
	 *
	 * The dock often does not exist yet when we start — on GNOME extension load
	 * order is not guaranteed, on Windows the taskbar may not have been read
	 * yet — so this is recomputed from the icons we already measured each tick,
	 * rather than once at startup.
	 */
	sizeFor(settings: Settings, icons: readonly IconRect[]): number {
		if (settings.spriteSize > 0) return settings.spriteSize;
		// Match the dock's *logical* icon size. Using the measured on-screen
		// height would make the cats scale-factor times too big on HiDPI.
		const sizes = icons.map((i) => i.logicalSize).filter((n) => n > 0);
		const median = sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)];
		if (median === undefined) return DEFAULT_SIZE;
		return Math.round(Math.min(96, Math.max(20, median)));
	}

	/**
	 * The palettes to draw from: whatever the user chose, minus any that no
	 * longer exist on disk, falling back to every palette.
	 */
	private _palettes(settings: Settings): string[] {
		return resolvePalettes(settings.palettes, this._host.sprites.palettes);
	}

	/** Palette for the nth cat, cycling through whatever is enabled. */
	private _paletteFor(palettes: readonly string[], index: number): string {
		return palettes[index % palettes.length] ?? FALLBACK_PALETTE;
	}

	/**
	 * Add or remove cats to match the settings, and reapply palette and size to
	 * the ones that stay.
	 *
	 * @param onRemove called for each cat about to be destroyed, so a platform
	 * can undo anything it did on that cat's behalf (GNOME releases the dock
	 * icon it was shaking).
	 */
	sync(
		settings: Settings,
		icons: readonly IconRect[],
		bounds: Bounds | null,
		onRemove?: (cat: Cat) => void,
	): void {
		const size = this.sizeFor(settings, icons);
		const palettes = this._palettes(settings);

		while (this.cats.length > settings.count) {
			const cat = this.cats.pop();
			if (!cat) break;
			onRemove?.(cat);
			cat.destroy();
		}

		while (this.cats.length < settings.count) {
			const i = this.cats.length;
			// Spread new cats evenly rather than stacking them at one edge.
			const x = bounds
				? bounds.roam.min +
					((bounds.roam.max - bounds.roam.min) * (i + 1)) / (settings.count + 1)
				: 100 + i * 60;
			this.cats.push(
				new Cat({
					view: this._host.createView(),
					sprites: this._host.sprites,
					palette: this._paletteFor(palettes, i),
					size,
					x,
					index: i,
				}),
			);
		}

		// Palette assignment and size can change without the count changing.
		this.cats.forEach((cat, i) => {
			cat.palette = this._paletteFor(palettes, i);
			cat.index = i;
			cat.setSize(size);
		});
		this._size = size;
	}

	/** Advance every cat one tick against the desktop as it is right now. */
	update(dt: number, world: World, settings: Settings): void {
		// The dock may have appeared, or changed icon size, since we last
		// looked. Cats resize to match rather than staying at the fallback.
		const size = this.sizeFor(settings, world.icons);
		if (size !== this._size) {
			this._size = size;
			for (const cat of this.cats) cat.setSize(size);
		}

		const ctx = {
			roam: world.roam,
			floorY: world.floorY,
			icons: world.icons,
			pointer: world.pointer,
			neighbours: this.cats,
			cfg: settings as CatConfig,
		};

		for (const cat of this.cats) cat.update(dt, ctx);
	}

	/** True when nothing is going to move until the user does. */
	allAsleep(settings: Settings): boolean {
		return (
			settings.sleepAfter > 0 &&
			this.cats.length > 0 &&
			this.cats.every((c) => c.state === State.SLEEP)
		);
	}

	destroy(): void {
		for (const cat of this.cats) cat.destroy();
		this.cats.length = 0;
		this._size = 0;
	}
}
