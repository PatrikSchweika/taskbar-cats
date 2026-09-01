/**
 * The settings window, built from the shared settings table.
 *
 * Every row here is generated from INT_SETTINGS and BOOL_SETTINGS, so a new
 * setting appears in this window as soon as it exists in core/config.ts — the
 * same property that makes the GNOME prefs dialog and this one agree on ranges.
 */
import {
	BOOL_SETTINGS,
	INT_SETTINGS,
	type Settings,
} from "../../../core/config.js";
import type { SettingsDescription } from "../ipc.js";

declare const cats: {
	onSettings(fn: (settings: Settings) => void): void;
	apply(patch: Partial<Settings>): void;
	describe(): Promise<SettingsDescription>;
};

/** Human wording for each key, in the order they should appear. */
const LABELS: Record<string, { title: string; hint?: string }> = {
	count: { title: "Number of cats" },
	spriteSize: {
		title: "Cat size",
		hint: "0 matches your taskbar's own icon size",
	},
	maxSpeed: { title: "Top speed", hint: "pixels per second" },
	attraction: {
		title: "Mouse attraction",
		hint: "0 means they ignore the pointer entirely",
	},
	attractRadius: {
		title: "Attraction radius",
		hint: "how far above the bottom of the screen the pointer still interests them",
	},
	sleepAfter: {
		title: "Nap after",
		hint: "seconds of stillness; 0 means they never sleep",
	},
	fps: { title: "Animation frame rate" },
	scratchIcons: {
		title: "Claw at taskbar icons",
		hint: "cats stop at an icon and scratch it",
	},
	wiggleIcons: {
		title: "Shake the icon being clawed",
		hint: "not available on Windows — the taskbar belongs to explorer.exe",
	},
};

function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function row(
	title: string,
	hint: string | undefined,
	control: HTMLElement,
	value?: HTMLElement,
): HTMLElement {
	const wrapper = element("div", "row");
	const text = element("div", "text");
	text.appendChild(element("div", "title", title));
	if (hint) text.appendChild(element("div", "hint", hint));
	wrapper.appendChild(text);
	const side = element("div", "control");
	if (value) side.appendChild(value);
	side.appendChild(control);
	wrapper.appendChild(side);
	return wrapper;
}

async function main(): Promise<void> {
	const form = document.getElementById("form");
	const footer = document.getElementById("footer");
	if (!form || !footer) throw new Error("settings window markup is missing");

	const description = await cats.describe();
	let current = description.settings;

	/** Controls that need updating when settings change elsewhere. */
	const sync: ((settings: Settings) => void)[] = [];

	if (description.shellError) {
		const warning = element(
			"div",
			"warning",
			"The taskbar helper could not be loaded, so the cats cannot see your icons. They will still roam the bottom of the screen.",
		);
		form.appendChild(warning);
	}

	for (const [name, spec] of Object.entries(INT_SETTINGS)) {
		const label = LABELS[name] ?? { title: spec.key };
		const input = element("input");
		input.type = "range";
		input.min = String(spec.min);
		input.max = String(spec.max);
		input.step = "1";
		input.value = String(current[name as keyof Settings] as number);

		const readout = element("span", "value", input.value);
		input.addEventListener("input", () => {
			readout.textContent = input.value;
			cats.apply({ [name]: Number(input.value) } as Partial<Settings>);
		});
		sync.push((settings) => {
			const value = String(settings[name as keyof Settings] as number);
			input.value = value;
			readout.textContent = value;
		});

		form.appendChild(row(label.title, label.hint, input, readout));
	}

	for (const [name, spec] of Object.entries(BOOL_SETTINGS)) {
		const label = LABELS[name] ?? { title: spec.key };
		const input = element("input");
		input.type = "checkbox";
		input.checked = current[name as keyof Settings] as boolean;

		// The GNOME backend shakes the real dock icon while a cat claws it.
		// Nothing outside explorer.exe can do that to a taskbar button, so the
		// setting is shown, explained and disabled rather than quietly missing.
		const unsupported = name === "wiggleIcons";
		input.disabled = unsupported;

		input.addEventListener("change", () => {
			cats.apply({ [name]: input.checked } as Partial<Settings>);
		});
		sync.push((settings) => {
			input.checked = settings[name as keyof Settings] as boolean;
		});

		const wrapper = row(label.title, label.hint, input);
		if (unsupported) wrapper.classList.add("disabled");
		form.appendChild(wrapper);
	}

	// -- palettes ----------------------------------------------------------
	if (description.palettes.length) {
		const fieldset = element("div", "palettes");
		fieldset.appendChild(element("div", "title", "Fur palettes"));
		fieldset.appendChild(
			element(
				"div",
				"hint",
				"Cats cycle through the ones you pick. None selected means all of them.",
			),
		);
		const grid = element("div", "grid");

		for (const palette of description.palettes) {
			const label = element("label", "palette");
			const input = element("input");
			input.type = "checkbox";
			input.checked = current.palettes.includes(palette);
			input.addEventListener("change", () => {
				const chosen = description.palettes.filter((name) => {
					const box = grid.querySelector<HTMLInputElement>(
						`input[data-palette="${name}"]`,
					);
					return box?.checked ?? false;
				});
				cats.apply({ palettes: chosen });
			});
			input.dataset.palette = palette;
			label.appendChild(input);
			label.appendChild(element("span", undefined, palette));
			grid.appendChild(label);
			sync.push((settings) => {
				input.checked = settings.palettes.includes(palette);
			});
		}
		fieldset.appendChild(grid);
		form.appendChild(fieldset);
	}

	footer.textContent = description.configPath;

	cats.onSettings((settings) => {
		current = settings;
		for (const update of sync) update(settings);
	});
}

void main().catch((e) => {
	const form = document.getElementById("form");
	if (form) form.textContent = `Could not load settings: ${e}`;
});
