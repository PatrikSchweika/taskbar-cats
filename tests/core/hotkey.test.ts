import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type Accel,
	acceleratorFromKeyEvent,
	describeAccelerator,
	formatAccelerator,
	hasModifier,
	parseAccelerator,
	toElectronAccelerator,
} from "../../src/core/hotkey.ts";

const CTRL_ALT_C: Accel = {
	ctrl: true,
	alt: true,
	shift: false,
	super: false,
	key: "c",
};

describe("parseAccelerator", () => {
	it("reads the GTK form", () => {
		assert.deepEqual(parseAccelerator("<Control><Alt>c"), CTRL_ALT_C);
	});

	it("accepts the aliases GTK itself accepts", () => {
		assert.deepEqual(parseAccelerator("<Ctrl><Alt>C"), CTRL_ALT_C);
		assert.deepEqual(parseAccelerator("<Primary><Alt>c"), CTRL_ALT_C);
		assert.deepEqual(parseAccelerator("<Meta>space"), {
			...CTRL_ALT_C,
			ctrl: false,
			alt: false,
			super: true,
			key: "space",
		});
	});

	it("lower-cases GDK key names so the table has one spelling", () => {
		assert.equal(parseAccelerator("<Control>Page_Up")?.key, "page_up");
		assert.equal(parseAccelerator("<Control>F9")?.key, "f9");
		assert.equal(parseAccelerator("<Control>BackSpace")?.key, "backspace");
	});

	it("rejects junk, bare modifiers and unknown keys", () => {
		assert.equal(parseAccelerator(""), null);
		assert.equal(parseAccelerator("<Control>"), null);
		assert.equal(parseAccelerator("<Hyper>x"), null);
		assert.equal(parseAccelerator("banana"), null);
		assert.equal(parseAccelerator("Control_L"), null);
	});
});

describe("formatAccelerator", () => {
	it("writes modifiers in one fixed order", () => {
		const all = { ...CTRL_ALT_C, shift: true, super: true };
		assert.equal(formatAccelerator(all), "<Control><Alt><Shift><Super>c");
		assert.equal(
			formatAccelerator(parseAccelerator("<Alt><Control>c") as Accel),
			"<Control><Alt>c",
		);
	});

	it("uses the GDK spelling for named keys", () => {
		assert.equal(
			formatAccelerator({ ...CTRL_ALT_C, key: "page_up" }),
			"<Control><Alt>Page_Up",
		);
		assert.equal(
			formatAccelerator({ ...CTRL_ALT_C, key: "f9" }),
			"<Control><Alt>F9",
		);
	});

	it("round-trips through parse", () => {
		for (const text of [
			"<Control><Alt>c",
			"<Shift><Super>F12",
			"<Control>space",
		])
			assert.equal(formatAccelerator(parseAccelerator(text) as Accel), text);
	});
});

describe("toElectronAccelerator", () => {
	it("translates the common cases", () => {
		assert.equal(toElectronAccelerator(CTRL_ALT_C), "Ctrl+Alt+C");
		assert.equal(
			toElectronAccelerator(parseAccelerator("<Control><Shift>F9") as Accel),
			"Ctrl+Shift+F9",
		);
		assert.equal(
			toElectronAccelerator(parseAccelerator("<Super>space") as Accel),
			"Super+Space",
		);
		assert.equal(
			toElectronAccelerator(parseAccelerator("<Control>Page_Up") as Accel),
			"Ctrl+PageUp",
		);
		assert.equal(
			toElectronAccelerator(parseAccelerator("<Alt>comma") as Accel),
			"Alt+,",
		);
	});
});

describe("describeAccelerator", () => {
	it("is what a human would type on a sticky note", () => {
		assert.equal(describeAccelerator(CTRL_ALT_C), "Ctrl + Alt + C");
		assert.equal(
			describeAccelerator(parseAccelerator("<Super>Page_Down") as Accel),
			"Super + Page Down",
		);
		assert.equal(
			describeAccelerator(parseAccelerator("<Control>Return") as Accel),
			"Ctrl + Enter",
		);
	});
});

describe("acceleratorFromKeyEvent", () => {
	const event = (
		code: string,
		mods: Partial<
			Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>
		> = {},
	) => ({
		code,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		metaKey: false,
		...mods,
	});

	it("uses the physical key, so the layout does not matter", () => {
		assert.deepEqual(
			acceleratorFromKeyEvent(event("KeyC", { ctrlKey: true, altKey: true })),
			CTRL_ALT_C,
		);
		assert.equal(
			acceleratorFromKeyEvent(event("Digit7", { altKey: true }))?.key,
			"7",
		);
		assert.equal(acceleratorFromKeyEvent(event("F5"))?.key, "f5");
		assert.equal(acceleratorFromKeyEvent(event("ArrowUp"))?.key, "up");
		assert.equal(acceleratorFromKeyEvent(event("Quote"))?.key, "apostrophe");
		assert.equal(acceleratorFromKeyEvent(event("Enter"))?.key, "return");
	});

	it("maps the Windows key to Super", () => {
		assert.equal(
			acceleratorFromKeyEvent(event("KeyC", { metaKey: true }))?.super,
			true,
		);
	});

	it("returns null for a modifier on its own or an unknown key", () => {
		assert.equal(
			acceleratorFromKeyEvent(event("ControlLeft", { ctrlKey: true })),
			null,
		);
		assert.equal(
			acceleratorFromKeyEvent(event("ShiftRight", { shiftKey: true })),
			null,
		);
		assert.equal(acceleratorFromKeyEvent(event("MediaPlayPause")), null);
	});
});

describe("hasModifier", () => {
	it("is false for a bare key", () => {
		assert.equal(
			hasModifier({ ...CTRL_ALT_C, ctrl: false, alt: false }),
			false,
		);
		assert.equal(hasModifier(CTRL_ALT_C), true);
	});
});
