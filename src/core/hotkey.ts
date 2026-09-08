/**
 * Keyboard accelerators, in the three spellings this project needs.
 *
 * GTK's form ("<Control><Alt>c") is what GNOME's keybinding API reads and so
 * what is stored on both platforms. Electron wants "Ctrl+Alt+C". Humans want
 * "Ctrl + Alt + C". This module converts between them without touching any
 * platform API, so the conversions are unit tested on plain Node.
 */

export interface Accel {
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
	super: boolean;
	/** A lower-case key name: a letter, a digit, "f1".."f35", or a NAMED key. */
	key: string;
}

type Modifier = "ctrl" | "alt" | "shift" | "super";

/** GTK modifier names, including the aliases gtk_accelerator_parse accepts. */
const MODIFIERS: Record<string, Modifier> = {
	control: "ctrl",
	ctrl: "ctrl",
	primary: "ctrl",
	alt: "alt",
	shift: "shift",
	super: "super",
	meta: "super",
};

interface KeyName {
	/** The GDK keyval name, as GTK writes it. */
	gdk: string;
	/** The Electron accelerator token. */
	electron: string;
	/** Wording for the settings UI. */
	label: string;
	/** The KeyboardEvent.code that produces it. */
	code: string;
}

/** Keys with a name of their own. Letters, digits and F-keys are handled by rule. */
const NAMED: Record<string, KeyName> = {
	space: { gdk: "space", electron: "Space", label: "Space", code: "Space" },
	tab: { gdk: "Tab", electron: "Tab", label: "Tab", code: "Tab" },
	return: { gdk: "Return", electron: "Return", label: "Enter", code: "Enter" },
	backspace: {
		gdk: "BackSpace",
		electron: "Backspace",
		label: "Backspace",
		code: "Backspace",
	},
	delete: {
		gdk: "Delete",
		electron: "Delete",
		label: "Delete",
		code: "Delete",
	},
	insert: {
		gdk: "Insert",
		electron: "Insert",
		label: "Insert",
		code: "Insert",
	},
	home: { gdk: "Home", electron: "Home", label: "Home", code: "Home" },
	end: { gdk: "End", electron: "End", label: "End", code: "End" },
	page_up: {
		gdk: "Page_Up",
		electron: "PageUp",
		label: "Page Up",
		code: "PageUp",
	},
	page_down: {
		gdk: "Page_Down",
		electron: "PageDown",
		label: "Page Down",
		code: "PageDown",
	},
	up: { gdk: "Up", electron: "Up", label: "Up", code: "ArrowUp" },
	down: { gdk: "Down", electron: "Down", label: "Down", code: "ArrowDown" },
	left: { gdk: "Left", electron: "Left", label: "Left", code: "ArrowLeft" },
	right: {
		gdk: "Right",
		electron: "Right",
		label: "Right",
		code: "ArrowRight",
	},
	minus: { gdk: "minus", electron: "-", label: "-", code: "Minus" },
	equal: { gdk: "equal", electron: "=", label: "=", code: "Equal" },
	comma: { gdk: "comma", electron: ",", label: ",", code: "Comma" },
	period: { gdk: "period", electron: ".", label: ".", code: "Period" },
	slash: { gdk: "slash", electron: "/", label: "/", code: "Slash" },
	backslash: {
		gdk: "backslash",
		electron: "\\",
		label: "\\",
		code: "Backslash",
	},
	semicolon: {
		gdk: "semicolon",
		electron: ";",
		label: ";",
		code: "Semicolon",
	},
	apostrophe: { gdk: "apostrophe", electron: "'", label: "'", code: "Quote" },
	grave: { gdk: "grave", electron: "`", label: "`", code: "Backquote" },
	bracketleft: {
		gdk: "bracketleft",
		electron: "[",
		label: "[",
		code: "BracketLeft",
	},
	bracketright: {
		gdk: "bracketright",
		electron: "]",
		label: "]",
		code: "BracketRight",
	},
};

const CODE_TO_KEY = new Map(
	Object.entries(NAMED).map(([key, name]) => [name.code, key]),
);

const LETTER = /^[a-z]$/;
const DIGIT = /^[0-9]$/;
const FKEY = /^f([1-9]|[12][0-9]|3[0-5])$/;

/** A lower-cased GDK key name, or null when it is not one this project binds. */
function normalizeKey(raw: string): string | null {
	const key = raw.trim().toLowerCase();
	if (LETTER.test(key) || DIGIT.test(key) || FKEY.test(key) || key in NAMED)
		return key;
	return null;
}

export function parseAccelerator(text: string): Accel | null {
	const accel: Accel = {
		ctrl: false,
		alt: false,
		shift: false,
		super: false,
		key: "",
	};
	let rest = text.trim();
	const modifier = /^<([a-z]+)>/i;
	for (let m = modifier.exec(rest); m; m = modifier.exec(rest)) {
		const name = MODIFIERS[m[1].toLowerCase()];
		if (!name) return null;
		accel[name] = true;
		rest = rest.slice(m[0].length);
	}
	const key = normalizeKey(rest);
	if (!key) return null;
	accel.key = key;
	return accel;
}

export function hasModifier(a: Accel): boolean {
	return a.ctrl || a.alt || a.shift || a.super;
}

function modifierParts(a: Accel, names: Record<Modifier, string>): string[] {
	const out: string[] = [];
	if (a.ctrl) out.push(names.ctrl);
	if (a.alt) out.push(names.alt);
	if (a.shift) out.push(names.shift);
	if (a.super) out.push(names.super);
	return out;
}

/** The GTK form, the way it is stored. */
export function formatAccelerator(a: Accel): string {
	const key =
		NAMED[a.key]?.gdk ?? (FKEY.test(a.key) ? a.key.toUpperCase() : a.key);
	const mods = modifierParts(a, {
		ctrl: "<Control>",
		alt: "<Alt>",
		shift: "<Shift>",
		super: "<Super>",
	}).join("");
	return `${mods}${key}`;
}

const PLAIN_NAMES: Record<Modifier, string> = {
	ctrl: "Ctrl",
	alt: "Alt",
	shift: "Shift",
	super: "Super",
};

/** The form Electron's globalShortcut wants. */
export function toElectronAccelerator(a: Accel): string {
	const key = NAMED[a.key]?.electron ?? a.key.toUpperCase();
	return [...modifierParts(a, PLAIN_NAMES), key].join("+");
}

/** Wording for a settings row. */
export function describeAccelerator(a: Accel): string {
	const key = NAMED[a.key]?.label ?? a.key.toUpperCase();
	return [...modifierParts(a, PLAIN_NAMES), key].join(" + ");
}

/**
 * The accelerator a DOM key event describes, from the physical key so the
 * keyboard layout does not matter. Null for a modifier pressed on its own or
 * a key this project does not bind.
 */
export function acceleratorFromKeyEvent(e: {
	code: string;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	metaKey: boolean;
}): Accel | null {
	let key: string | null = null;
	const letter = /^Key([A-Z])$/.exec(e.code);
	const digit = /^Digit([0-9])$/.exec(e.code);
	const fkey = /^F([0-9]{1,2})$/.exec(e.code);
	if (letter) key = letter[1].toLowerCase();
	else if (digit) key = digit[1];
	else if (fkey) key = normalizeKey(`f${fkey[1]}`);
	else key = CODE_TO_KEY.get(e.code) ?? null;
	if (!key) return null;
	return {
		ctrl: e.ctrlKey,
		alt: e.altKey,
		shift: e.shiftKey,
		super: e.metaKey,
		key,
	};
}
