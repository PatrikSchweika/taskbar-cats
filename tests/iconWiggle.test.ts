import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { IconWiggler } from "../src/lib/iconWiggle.ts";
import { resetEnv } from "./support/env.ts";
import { FakeActor } from "./support/stubs/actor.ts";

/** An app icon shaped like the dock's: a button wrapping an inner icon. */
function makeAppIcon(): { button: FakeActor; inner: FakeActor } {
	const inner = new FakeActor();
	const button = new FakeActor();
	(button as unknown as { icon: { icon: FakeActor } }).icon = { icon: inner };
	return { button, inner };
}

const MAX_DEGREES = 6.5;

describe("IconWiggler", () => {
	beforeEach(() => resetEnv());

	it("shakes the inner icon, not the button", () => {
		// The button carries dash-to-dock's hover-zoom; touching it would fight.
		const { button, inner } = makeAppIcon();
		new IconWiggler().shake(button, 0.05);
		assert.notEqual(inner.rotation_angle_z, 0);
		assert.equal(button.rotation_angle_z, 0);
	});

	it("falls back to the actor when there is no inner icon", () => {
		const plain = new FakeActor();
		new IconWiggler().shake(plain, 0.05);
		assert.notEqual(plain.rotation_angle_z, 0);
	});

	it("keeps the rotation within bounds and scales it by strength", () => {
		const { button, inner } = makeAppIcon();
		const w = new IconWiggler();
		for (let t = 0; t < 2; t += 0.01) {
			w.shake(button, t);
			assert.ok(
				Math.abs(inner.rotation_angle_z) <= MAX_DEGREES + 1e-9,
				`|${inner.rotation_angle_z}| exceeded ${MAX_DEGREES}`,
			);
		}
		let peakHalf = 0;
		for (let t = 0; t < 2; t += 0.01) {
			w.shake(button, t, 0.5);
			peakHalf = Math.max(peakHalf, Math.abs(inner.rotation_angle_z));
		}
		assert.ok(peakHalf <= MAX_DEGREES / 2 + 1e-9);
		assert.ok(peakHalf > MAX_DEGREES / 4, "half strength should still move");
	});

	it("does not move the icon at zero strength", () => {
		const { button, inner } = makeAppIcon();
		new IconWiggler().shake(button, 0.3, 0);
		assert.equal(inner.rotation_angle_z, 0);
	});

	it("sets the pivot to the icon's bottom centre", () => {
		const { button, inner } = makeAppIcon();
		new IconWiggler().shake(button, 0.05);
		assert.deepEqual(inner.pivot_point, { x: 0.5, y: 1.0 });
	});

	describe("restoring", () => {
		it("puts rotation and pivot back exactly", () => {
			const { button, inner } = makeAppIcon();
			inner.rotation_angle_z = 3;
			inner.pivot_point = { x: 0.25, y: 0.75 };

			const w = new IconWiggler();
			w.shake(button, 0.4);
			assert.notEqual(inner.rotation_angle_z, 3);

			w.release(button);
			assert.equal(inner.rotation_angle_z, 3);
			assert.deepEqual(inner.pivot_point, { x: 0.25, y: 0.75 });
		});

		it("restoreAll clears every icon it touched", () => {
			const icons = [makeAppIcon(), makeAppIcon(), makeAppIcon()];
			const w = new IconWiggler();
			for (const { button } of icons) w.shake(button, 0.4);
			for (const { inner } of icons) assert.notEqual(inner.rotation_angle_z, 0);

			w.restoreAll();
			for (const { inner } of icons) assert.equal(inner.rotation_angle_z, 0);

			// and it is idempotent — disable() must never throw
			assert.doesNotThrow(() => w.restoreAll());
		});

		it("disconnects its destroy handler on release", () => {
			// A leaked handler would keep a dead actor referenced for the life
			// of the shell.
			const { button, inner } = makeAppIcon();
			const w = new IconWiggler();
			assert.equal(inner.handlerCount(), 0);

			w.shake(button, 0.4);
			assert.equal(inner.handlerCount(), 1, "should watch for destroy");

			w.release(button);
			assert.equal(inner.handlerCount(), 0, "destroy handler leaked");
		});

		it("leaves nothing attached after restoreAll", () => {
			const icons = [makeAppIcon(), makeAppIcon()];
			const w = new IconWiggler();
			for (const { button } of icons) w.shake(button, 0.4);
			w.restoreAll();
			for (const { inner } of icons) assert.equal(inner.handlerCount(), 0);
		});

		it("forgets an icon the dock destroyed mid-shake", () => {
			// Dock icons are recreated whenever the app list changes.
			const { button, inner } = makeAppIcon();
			const w = new IconWiggler();
			w.shake(button, 0.4);
			inner.destroy();
			assert.doesNotThrow(() => w.restoreAll());
		});

		it("survives an actor that throws when written to", () => {
			// GJS throws on a disposed GObject; that must not escape.
			const inner = new FakeActor();
			Object.defineProperty(inner, "rotation_angle_z", {
				get: () => 0,
				set: () => {
					throw new Error("disposed");
				},
			});
			const button = new FakeActor();
			(button as unknown as { icon: { icon: FakeActor } }).icon = {
				icon: inner,
			};

			const w = new IconWiggler();
			assert.doesNotThrow(() => w.shake(button, 0.4));
			assert.doesNotThrow(() => w.restoreAll());
		});
	});
});
