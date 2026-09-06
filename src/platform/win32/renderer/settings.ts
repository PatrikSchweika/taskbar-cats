/**
 * The settings window, built from the shared settings table.
 *
 * Every row here is generated from INT_SETTINGS and BOOL_SETTINGS, so a new
 * setting appears in this window as soon as it exists in core/config.ts — the
 * same property that makes the GNOME prefs dialog and this one agree on ranges.
 */
import { resolveCatPalette } from "../../../core/colony.js";
import {
	AUTO_POSITION,
	BOOL_SETTINGS,
	CAT_SIZE_MAX,
	CAT_SIZE_MIN,
	INT_SETTINGS,
	type Settings,
} from "../../../core/config.js";
import {
	acceleratorFromKeyEvent,
	describeAccelerator,
	formatAccelerator,
	hasModifier,
	parseAccelerator,
} from "../../../core/hotkey.js";
import type { SpriteManifest } from "../../../core/sprites.js";
import type { SettingsDescription } from "../ipc.js";
import { SpritePreview } from "./preview.js";

declare const cats: {
	onSettings(fn: (settings: Settings) => void): void;
	apply(patch: Partial<Settings>): void;
	describe(): Promise<SettingsDescription>;
	manifest(): Promise<SpriteManifest>;
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
	beds: {
		title: "Cat beds",
		hint: "on the floor beside the taskbar; a sleepy cat curls up in a free one",
	},
	scratchers: {
		title: "Scratching posts",
		hint: "something to claw that is not one of your icons",
	},
	mouseInterval: {
		title: "Mouse visits",
		hint: "roughly this many seconds apart; every cat joins the hunt. 0 means no mice",
	},
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
	const manifest = await cats.manifest();
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

	// -- each cat ----------------------------------------------------------
	// One block per cat: a name, a palette, a size with an Auto box, and a
	// preview of what that cat will actually wear. Rebuilt when the count
	// changes; otherwise every settings echo just refreshes the values.
	const catRows = (): void => {
		const section = element("div", "cats");
		section.appendChild(element("div", "title", "Each cat"));
		section.appendChild(
			element(
				"div",
				"hint",
				"Auto follows the fur palettes and the cat size above.",
			),
		);
		const list = element("div", "list");
		section.appendChild(list);
		form.appendChild(section);

		interface CatControls {
			title: HTMLElement;
			name: HTMLInputElement;
			palette: HTMLSelectElement;
			size: HTMLInputElement;
			sizeReadout: HTMLElement;
			auto: HTMLInputElement;
			preview: SpritePreview;
		}
		let shownCount = -1;
		const controls: CatControls[] = [];

		const commit = (): void => {
			const catNames = [...current.catNames];
			const catPalettes = [...current.catPalettes];
			const catSizes = [...current.catSizes];
			controls.forEach((c, i) => {
				catNames[i] = c.name.value;
				catPalettes[i] = c.palette.value;
				catSizes[i] = c.auto.checked ? 0 : Number(c.size.value);
			});
			for (let k = 0; k < controls.length; k++) {
				if (catNames[k] === undefined) catNames[k] = "";
				if (catPalettes[k] === undefined) catPalettes[k] = "";
				if (catSizes[k] === undefined) catSizes[k] = 0;
			}
			cats.apply({ catNames, catPalettes, catSizes });
		};

		const reflect = (c: CatControls, i: number, settings: Settings): void => {
			c.title.textContent = c.name.value.trim() || `Cat ${i + 1}`;
			c.size.disabled = c.auto.checked;
			c.sizeReadout.textContent = c.auto.checked ? "auto" : c.size.value;
			c.preview.setPalette(
				resolveCatPalette(settings, i, description.palettes),
			);
		};

		const render = (settings: Settings): void => {
			if (settings.count !== shownCount) {
				shownCount = settings.count;
				for (const c of controls) c.preview.destroy();
				list.textContent = "";
				controls.length = 0;
				for (let i = 0; i < settings.count; i++) {
					const block = element("div", "cat");
					const preview = new SpritePreview(manifest);
					block.appendChild(preview.element);

					const title = element("div", "title");
					block.appendChild(title);

					const name = element("input");
					name.type = "text";
					name.placeholder = `Cat ${i + 1}`;
					name.maxLength = 24;
					block.appendChild(row("Name", undefined, name));

					const palette = element("select");
					palette.appendChild(new Option("Auto", ""));
					for (const p of description.palettes)
						palette.appendChild(new Option(p, p));
					block.appendChild(row("Fur palette", undefined, palette));

					const size = element("input");
					size.type = "range";
					size.min = String(CAT_SIZE_MIN);
					size.max = String(CAT_SIZE_MAX);
					size.step = "1";
					size.value = "48";
					const sizeReadout = element("span", "value");
					const autoBox = element("input");
					autoBox.type = "checkbox";
					const autoLabel = element("label", "auto");
					autoLabel.appendChild(autoBox);
					autoLabel.appendChild(element("span", undefined, "Auto"));
					const side = element("div", "control");
					side.appendChild(sizeReadout);
					side.appendChild(size);
					side.appendChild(autoLabel);
					const sizeRow = element("div", "row");
					const text = element("div", "text");
					text.appendChild(element("div", "title", "Size"));
					sizeRow.appendChild(text);
					sizeRow.appendChild(side);
					block.appendChild(sizeRow);

					list.appendChild(block);
					const c: CatControls = {
						title,
						name,
						palette,
						size,
						sizeReadout,
						auto: autoBox,
						preview,
					};
					name.addEventListener("input", () => {
						reflect(c, i, current);
						commit();
					});
					palette.addEventListener("change", commit);
					size.addEventListener("input", () => {
						reflect(c, i, current);
						commit();
					});
					autoBox.addEventListener("change", () => {
						reflect(c, i, current);
						commit();
					});
					controls.push(c);
				}
			}
			controls.forEach((c, i) => {
				const name = settings.catNames[i] ?? "";
				// Only touch the field when it differs, or the caret jumps.
				if (c.name.value !== name) c.name.value = name;
				const palette = settings.catPalettes[i] ?? "";
				c.palette.value = description.palettes.includes(palette) ? palette : "";
				const size = settings.catSizes[i] ?? 0;
				c.auto.checked = size === 0;
				if (size) c.size.value = String(size);
				reflect(c, i, settings);
			});
		};
		render(current);
		sync.push(render);
	};
	catRows();

	// -- positions ---------------------------------------------------------
	// One slider per bed and post — a percentage of the floor from the left —
	// with an "Auto" box that hands the placement back to the cats. The rows
	// follow the count, so they are rebuilt whenever the settings change.
	const positions = (
		countName: "beds" | "scratchers",
		listName: "bedPositions" | "scratcherPositions",
		noun: string,
	): void => {
		const section = element("div", "positions");
		section.appendChild(element("div", "title", `${noun} positions`));
		section.appendChild(
			element(
				"div",
				"hint",
				`Percent of the floor from the left edge. Auto leaves a ${noun.toLowerCase()} where the cats would put it.`,
			),
		);
		const list = element("div", "list");
		section.appendChild(list);
		form.appendChild(section);

		interface Controls {
			slider: HTMLInputElement;
			readout: HTMLElement;
			auto: HTMLInputElement;
			wrapper: HTMLElement;
		}
		let shownCount = -1;
		const controls: Controls[] = [];

		const commit = (): void => {
			const values = [...current[listName]];
			controls.forEach(({ slider, auto }, k) => {
				values[k] = auto.checked ? AUTO_POSITION : Number(slider.value);
			});
			for (let k = 0; k < values.length; k++)
				if (values[k] === undefined) values[k] = AUTO_POSITION;
			cats.apply({ [listName]: values } as Partial<Settings>);
		};

		const reflect = (c: Controls): void => {
			c.slider.disabled = c.auto.checked;
			c.readout.textContent = c.auto.checked ? "auto" : c.slider.value;
			c.wrapper.classList.toggle("disabled", c.auto.checked);
		};

		const render = (settings: Settings): void => {
			const count = settings[countName];
			section.hidden = count === 0;
			if (count !== shownCount) {
				shownCount = count;
				list.textContent = "";
				controls.length = 0;
				for (let i = 0; i < count; i++) {
					const slider = element("input");
					slider.type = "range";
					slider.min = "0";
					slider.max = "100";
					slider.step = "1";
					// A fresh row starts in the middle, so unticking Auto puts
					// the prop somewhere visible straight away.
					slider.value = "50";
					const readout = element("span", "value");
					const auto = element("input");
					auto.type = "checkbox";
					const autoLabel = element("label", "auto");
					autoLabel.appendChild(auto);
					autoLabel.appendChild(element("span", undefined, "Auto"));

					const side = element("div", "control");
					side.appendChild(readout);
					side.appendChild(slider);
					side.appendChild(autoLabel);
					const wrapper = element("div", "row");
					const text = element("div", "text");
					text.appendChild(element("div", "title", `${noun} ${i + 1}`));
					wrapper.appendChild(text);
					wrapper.appendChild(side);
					list.appendChild(wrapper);

					const c: Controls = { slider, readout, auto, wrapper };
					slider.addEventListener("input", () => {
						reflect(c);
						commit();
					});
					auto.addEventListener("change", () => {
						reflect(c);
						commit();
					});
					controls.push(c);
				}
			}
			controls.forEach((c, i) => {
				const value = settings[listName][i];
				const isAuto = value === undefined || value === AUTO_POSITION;
				c.auto.checked = isAuto;
				if (!isAuto) c.slider.value = String(value);
				reflect(c);
			});
		};
		render(current);
		sync.push(render);
	};
	positions("beds", "bedPositions", "Bed");
	positions("scratchers", "scratcherPositions", "Post");

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
			const preview = new SpritePreview(manifest);
			preview.setPalette(palette);
			label.appendChild(preview.element);
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

	// -- the hide hotkey ---------------------------------------------------
	const hotkeyRow = (): void => {
		const shown = element("span", "value");
		const button = element("button", undefined, "Change");
		const wrapper = row(
			"Hide or show the cats",
			"a keyboard shortcut that works in any program",
			button,
			shown,
		);
		const status = element("div", "error");
		status.hidden = true;
		wrapper.querySelector(".text")?.appendChild(status);
		form.appendChild(wrapper);

		const show = (settings: Settings): void => {
			const accel = settings.toggleHotkey[0]
				? parseAccelerator(settings.toggleHotkey[0])
				: null;
			shown.textContent = accel ? describeAccelerator(accel) : "Not set";
		};
		const showStatus = (error: string | null): void => {
			status.textContent = error ?? "";
			status.hidden = !error;
		};
		const refreshStatus = async (): Promise<void> => {
			showStatus((await cats.describe()).hotkeyError);
		};

		let capturing = false;
		const stop = (): void => {
			capturing = false;
			button.textContent = "Change";
			document.removeEventListener("keydown", onKey, true);
			show(current);
		};
		const onKey = (event: KeyboardEvent): void => {
			event.preventDefault();
			event.stopPropagation();
			if (event.key === "Escape") {
				stop();
				return;
			}
			const accel = acceleratorFromKeyEvent(event);
			if (event.key === "Backspace" && accel && !hasModifier(accel)) {
				cats.apply({ toggleHotkey: [] });
				stop();
				void refreshStatus();
				return;
			}
			if (!accel) return; // a modifier on its own: keep waiting
			if (!hasModifier(accel)) {
				shown.textContent = "Add Ctrl, Alt, Shift or Win";
				return;
			}
			cats.apply({ toggleHotkey: [formatAccelerator(accel)] });
			stop();
			void refreshStatus();
		};
		button.addEventListener("click", () => {
			if (capturing) {
				stop();
				return;
			}
			capturing = true;
			button.textContent = "Cancel";
			shown.textContent = "Press the new shortcut…";
			document.addEventListener("keydown", onKey, true);
		});

		show(current);
		sync.push((settings) => {
			if (!capturing) show(settings);
		});
		showStatus(description.hotkeyError);
	};
	hotkeyRow();

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
