/**
 * The overlay renderer: runs the shared simulation and draws it.
 *
 * Main polls the shell and sends this window a layout (where the floor is, what
 * the icons are) and a pointer sample; everything else — the cats, their
 * physics, when they nap — is the same code the GNOME extension runs.
 */
import { Arranger, resetAllPositions } from "../../../core/arrange.js";
import {
	Colony,
	DROWSY_INTERVAL_MS,
	PointerTracker,
	propUnderPointer,
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
	onVisible(fn: (visible: boolean) => void): void;
	onSettings(fn: (settings: Settings) => void): void;
	onArrange(fn: (on: boolean) => void): void;
	setArranging(on: boolean): void;
	capture(on: boolean): void;
	apply(patch: Partial<Settings>): void;
	manifest(): Promise<SpriteManifest>;
	ready(): void;
};

const HINT = "Drag the furniture. Double-click one to place it automatically.";
const EMPTY_HINT = "Add a bed, post or bowl first";

const MAX_DT = 0.2; // a stalled renderer must not teleport every cat
const MIN_DT = 0.001;

async function main(): Promise<void> {
	const stage = document.getElementById("stage");
	const bar = document.getElementById("arrange-bar");
	const hint = document.getElementById("arrange-hint");
	const reset = document.getElementById("arrange-reset");
	const done = document.getElementById("arrange-done");
	if (!stage || !bar || !hint || !reset || !done)
		throw new Error("taskbar-cats: the overlay markup is missing");

	const sprites = await WebSpriteSet.load(await cats.manifest());
	const colony = new Colony({
		sprites,
		createView: () => new DomCatView(stage),
		createPropView: () => {
			const view = new DomCatView(stage, { behind: true });
			// Marks the furniture apart from the mouse toy, which is also drawn
			// behind the cats but is never arranged.
			view.element.classList.add("furniture");
			return view;
		},
		createToyView: () => new DomCatView(stage, { behind: true }),
	});
	const pointer = new PointerTracker();

	let settings = defaultSettings();
	let layout: Layout | null = null;
	let latestPointer = { x: -5000, y: -5000 };
	/** Set when something arrived that needs the colony rebuilt. */
	let dirty = true;
	/** False while the hotkey has hidden the cats; the window is hidden too. */
	let shown = true;

	cats.onVisible((visible) => {
		shown = visible;
	});

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

	// -- arrange mode ---------------------------------------------------------
	// Main owns whether the furniture is being arranged; this window follows.
	// Outside it the window stays click-through. Inside it, it asks main for
	// the mouse only while the pointer is over a prop or the toolbar, or a
	// press is held, so the rest of the taskbar keeps working.

	/** The drag logic, while arranging; null otherwise. */
	let arranger: Arranger | null = null;
	/** What was last asked of main with `capture`, so it is sent on change only. */
	let captured = false;
	/** The pointer whose press is holding a prop, captured to the stage. */
	let heldPointer: number | null = null;

	const setCapture = (want: boolean): void => {
		if (want === captured) return;
		captured = want;
		cats.capture(want);
	};

	const releaseHeld = (): void => {
		if (heldPointer !== null && stage.hasPointerCapture(heldPointer))
			stage.releasePointerCapture(heldPointer);
		heldPointer = null;
	};

	/** Outline the furniture, and mark the props standing where they were put. */
	const markProps = (): void => {
		for (const prop of colony.props)
			if (prop.view instanceof DomCatView)
				prop.view.element.classList.toggle("pinned", prop.pinned !== null);
		const text = colony.props.length ? HINT : EMPTY_HINT;
		if (hint.textContent !== text) hint.textContent = text;
	};

	const startArranging = (): void => {
		if (arranger) return;
		arranger = new Arranger(colony);
		stage.classList.add("arranging");
		bar.hidden = false;
		markProps();
	};

	/** Leave arrange mode, however it ended. Safe to call when off. */
	const stopArranging = (): void => {
		if (!arranger) return;
		arranger.cancel();
		arranger = null;
		releaseHeld();
		bar.hidden = true;
		stage.classList.remove("arranging");
		for (const prop of colony.props)
			if (prop.view instanceof DomCatView)
				prop.view.element.classList.remove("pinned");
		// Sent even when already false: main restores click-through anyway, and
		// this keeps the two sides from disagreeing.
		captured = false;
		cats.capture(false);
	};

	cats.onArrange((on) => {
		if (on) startArranging();
		else stopArranging();
	});

	/** Ask main to end arrange mode, and stop here without waiting for the echo. */
	const endArranging = (): void => {
		cats.setArranging(false);
		stopArranging();
	};

	reset.addEventListener("click", () => cats.apply(resetAllPositions()));
	done.addEventListener("click", endArranging);

	/** Finish a held press: save the drop, or a double-click's automatic place. */
	const finishPress = (e: PointerEvent): void => {
		releaseHeld();
		if (!arranger?.pressed) return;
		if (!layout) {
			arranger.cancel();
			return;
		}
		const patch = arranger.release(e.timeStamp / 1000, settings, layout.roam);
		if (patch) cats.apply(patch);
	};

	window.addEventListener("pointerdown", (e) => {
		if (!arranger || !layout || e.button !== 0) return;
		// The toolbar's buttons handle their own clicks.
		if (e.target instanceof Node && bar.contains(e.target)) return;
		const hit = arranger.press(
			e.timeStamp / 1000,
			e.clientX,
			e.clientY,
			layout.floorY,
		);
		if (!hit) return;
		// Keep the moves and the release coming even if the pointer outruns
		// the prop.
		releaseHeld();
		stage.setPointerCapture(e.pointerId);
		heldPointer = e.pointerId;
	});

	window.addEventListener("pointermove", (e) => {
		if (!arranger?.pressed || !layout) return;
		// The release can be lost — the window went click-through, or the
		// button came up outside it — and then a bare move must not drag.
		if ((e.buttons & 1) === 0) {
			finishPress(e);
			return;
		}
		arranger.move(e.clientX, layout.roam);
	});

	window.addEventListener("pointerup", (e) => {
		if (e.button !== 0) return;
		finishPress(e);
	});

	window.addEventListener("pointercancel", () => {
		releaseHeld();
		arranger?.cancel();
	});

	let last = performance.now() / 1000;

	const frame = (nowMs: number): void => {
		requestAnimationFrame(frame);
		const now = nowMs / 1000;
		const elapsed = now - last;

		// Sleeping cats do not need sixty frames a second. Skipping without
		// touching `last` keeps the elapsed time accumulating, so the sleep
		// animation still advances at its own slow rate.
		// A dragged prop has to follow the pointer smoothly, so arranging
		// never drops to the drowsy rate.
		const step =
			!arranger && colony.allAsleep(settings) ? DROWSY_INTERVAL_MS / 1000 : 0;
		if (elapsed < step) return;
		last = now;

		if (dirty) {
			dirty = false;
			colony.sync(settings, layout?.icons ?? [], layout);
			// A count change rebuilds the props; a drag on one that's gone is
			// dropped, not saved.
			const pressed = arranger?.pressed;
			if (pressed && !colony.props.includes(pressed)) {
				arranger?.cancel();
				releaseHeld();
			}
		}
		// `last` was refreshed above, so the cats resume without a dt jump.
		if (!layout || !shown) return;

		const dt = Math.min(MAX_DT, Math.max(MIN_DT, elapsed));
		pointer.update(dt, latestPointer.x, latestPointer.y);

		if (arranger) {
			if (!arranger.tick(dt)) {
				endArranging();
			} else {
				// Read before the cats move, while the layout is still clean.
				const rect = bar.getBoundingClientRect();
				const overBar =
					latestPointer.x >= rect.left &&
					latestPointer.x <= rect.right &&
					latestPointer.y >= rect.top &&
					latestPointer.y <= rect.bottom;
				setCapture(
					arranger.pressed !== null ||
						propUnderPointer(colony.props, latestPointer, layout.floorY) !==
							null ||
						overBar,
				);
				// Props are pinned and unpinned by drops and Reset all, and
				// rebuilt when a count changes, so this is kept current.
				markProps();
			}
		}

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
	console.error("taskbar-cats: the overlay failed to start", e);
});
