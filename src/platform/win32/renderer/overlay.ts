/**
 * The overlay renderer: runs the shared simulation and draws it.
 *
 * Main polls the shell and sends this window a layout (where the floor is, what
 * the icons are) and a pointer sample; everything else — the cats, their
 * physics, when they nap — is the same code the GNOME extension runs.
 */
import {
	Colony,
	DROWSY_INTERVAL_MS,
	PointerTracker,
	type World,
} from "../../../core/colony.js";
import { defaultSettings, type Settings } from "../../../core/config.js";
import type { Layout, SpriteManifest } from "../ipc.js";
import { DomCatView } from "./catView.js";
import { WebSpriteSet } from "./sprites.js";

/** The API preload.ts exposes. */
declare const cats: {
	onLayout(fn: (layout: Layout | null) => void): void;
	onPointer(fn: (pointer: { x: number; y: number }) => void): void;
	onSettings(fn: (settings: Settings) => void): void;
	manifest(): Promise<SpriteManifest>;
	ready(): void;
};

const MAX_DT = 0.2; // a stalled renderer must not teleport every cat
const MIN_DT = 0.001;

async function main(): Promise<void> {
	const stage = document.getElementById("stage");
	if (!stage) throw new Error("ubuntu-cats: the overlay has no #stage");

	const sprites = await WebSpriteSet.load(await cats.manifest());
	const colony = new Colony({
		sprites,
		createView: () => new DomCatView(stage),
	});
	const pointer = new PointerTracker();

	let settings = defaultSettings();
	let layout: Layout | null = null;
	let latestPointer = { x: -5000, y: -5000 };
	/** Set when something arrived that needs the colony rebuilt. */
	let dirty = true;

	cats.onSettings((next) => {
		settings = next;
		dirty = true;
	});

	cats.onLayout((next) => {
		layout = next;
		stage.style.visibility = next ? "visible" : "hidden";
		dirty = true;
	});

	cats.onPointer((next) => {
		// Stored, not applied: the pointer is only meaningful alongside the dt
		// of the frame that consumes it.
		latestPointer = next;
	});

	let last = performance.now() / 1000;

	const frame = (nowMs: number): void => {
		requestAnimationFrame(frame);
		const now = nowMs / 1000;
		const elapsed = now - last;

		// Sleeping cats do not need sixty frames a second. Skipping without
		// touching `last` keeps the elapsed time accumulating, so the sleep
		// animation still advances at its own slow rate.
		const step = colony.allAsleep(settings) ? DROWSY_INTERVAL_MS / 1000 : 0;
		if (elapsed < step) return;
		last = now;

		if (dirty) {
			dirty = false;
			colony.sync(settings, layout?.icons ?? [], layout);
		}
		if (!layout) return;

		const dt = Math.min(MAX_DT, Math.max(MIN_DT, elapsed));
		pointer.update(dt, latestPointer.x, latestPointer.y);

		const world: World = {
			roam: layout.roam,
			floorY: layout.floorY,
			icons: layout.icons,
			pointer: pointer.sample,
		};
		colony.update(dt, world, settings);
	};

	requestAnimationFrame(frame);
	cats.ready();
}

void main().catch((e) => {
	// There is no window chrome to show an error in, so the console is it.
	console.error("ubuntu-cats: the overlay failed to start", e);
});
