import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";

import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { resolveCatPalette } from "../../core/colony.js";
import {
	AUTO_POSITION,
	CAT_SIZE_MAX,
	CAT_SIZE_MIN,
	CAT_SIZES_KEY,
	HOTKEY_KEY,
	normalizeCatSizes,
	normalizePositions,
	normalizeStringList,
	PALETTES_KEY,
	STRING_LIST_SETTINGS,
} from "../../core/config.js";
import {
	formatAccelerator,
	hasModifier,
	parseAccelerator,
} from "../../core/hotkey.js";
import { loadManifest, SpritePreview } from "./preview.js";

function spinRow(
	settings: Gio.Settings,
	key: string,
	title: string,
	subtitle: string | null,
	min: number,
	max: number,
	step = 1,
): Adw.SpinRow {
	const row = new Adw.SpinRow({
		title,
		subtitle: subtitle ?? "",
		adjustment: new Gtk.Adjustment({
			lower: min,
			upper: max,
			step_increment: step,
			page_increment: step * 10,
		}),
	});
	settings.bind(key, row, "value", Gio.SettingsBindFlags.DEFAULT);
	return row;
}

function switchRow(
	settings: Gio.Settings,
	key: string,
	title: string,
	subtitle: string,
): Adw.SwitchRow {
	const row = new Adw.SwitchRow({ title, subtitle });
	settings.bind(key, row, "active", Gio.SettingsBindFlags.DEFAULT);
	return row;
}

export default class TaskbarCatsPreferences extends ExtensionPreferences {
	override fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
		const settings = this.getSettings();

		const manifest = loadManifest(this.path);
		const palettes = manifest?.palettes ?? [];
		const spriteRoot = GLib.build_filenamev([this.path, "assets", "cats"]);
		const preview = (): SpritePreview | null =>
			manifest ? new SpritePreview(spriteRoot, manifest, 48) : null;

		const page = new Adw.PreferencesPage({
			title: "Cats",
			icon_name: "preferences-desktop-symbolic",
		});
		window.add(page);

		// -- Colony ---------------------------------------------------------
		const colony = new Adw.PreferencesGroup({
			title: "Colony",
			description: "How many cats live on your dock, and what they look like.",
		});
		page.add(colony);
		colony.add(spinRow(settings, "cat-count", "Cats", null, 1, 8));
		colony.add(
			spinRow(
				settings,
				"sprite-size",
				"Cat size",
				"In pixels. 0 matches the dock’s own icon size.",
				0,
				128,
			),
		);
		colony.add(this._paletteRow(settings, palettes, preview));
		page.add(this._catsGroup(settings, palettes, preview));

		// -- Behaviour ------------------------------------------------------
		const behaviour = new Adw.PreferencesGroup({
			title: "Behaviour",
			description: "How the cats react to your pointer.",
		});
		page.add(behaviour);
		behaviour.add(
			spinRow(
				settings,
				"mouse-attraction",
				"Mouse attraction",
				"How strongly cats chase the pointer. 0 means they ignore it.",
				0,
				100,
				5,
			),
		);
		behaviour.add(
			spinRow(
				settings,
				"attract-radius",
				"Attraction radius",
				"How far above the bottom of the screen the pointer can be and still interest them.",
				40,
				1200,
				20,
			),
		);
		behaviour.add(
			spinRow(
				settings,
				"max-speed",
				"Top speed",
				"Pixels per second at a full run.",
				40,
				600,
				10,
			),
		);
		behaviour.add(
			spinRow(
				settings,
				"sleep-after",
				"Nap after",
				"Seconds of stillness before the cats curl up. 0 keeps them awake.",
				0,
				600,
				5,
			),
		);
		behaviour.add(this._hotkeyRow(settings, window));

		// -- Mischief -------------------------------------------------------
		const mischief = new Adw.PreferencesGroup({
			title: "Mischief",
			description:
				"Scratching is the only thing that touches your real dock. " +
				"Turning the shake off leaves the dock completely alone.",
		});
		page.add(mischief);
		const scratch = switchRow(
			settings,
			"scratch-icons",
			"Scratch app icons",
			"Cats stop at an icon and claw at it.",
		);
		const wiggle = switchRow(
			settings,
			"wiggle-icons",
			"Shake the scratched icon",
			"Rock the real dock icon while a cat is clawing it.",
		);
		mischief.add(scratch);
		mischief.add(wiggle);
		settings.bind(
			"scratch-icons",
			wiggle,
			"sensitive",
			Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.NO_SENSITIVITY,
		);

		// -- Furniture and toys ---------------------------------------------
		const toys = new Adw.PreferencesGroup({
			title: "Furniture and toys",
			description:
				"Beds and scratching posts stand on the floor to either side of " +
				"the dock, never in front of an icon.",
		});
		page.add(toys);
		toys.add(
			spinRow(
				settings,
				"bed-count",
				"Cat beds",
				"A sleepy cat walks to a free bed and curls up in it.",
				0,
				8,
			),
		);
		toys.add(
			spinRow(
				settings,
				"scratcher-count",
				"Scratching posts",
				"Something to claw that is not one of your icons.",
				0,
				8,
			),
		);
		toys.add(this._positionsRow(settings, "bed-count", "bed-positions", "Bed"));
		toys.add(
			this._positionsRow(
				settings,
				"scratcher-count",
				"scratcher-positions",
				"Post",
			),
		);
		toys.add(
			spinRow(
				settings,
				"mouse-interval",
				"Mouse visits",
				"Roughly how many seconds pass between mice running across the " +
					"floor. Every cat joins the hunt. 0 means no mice.",
				0,
				3600,
				10,
			),
		);

		// -- Rendering ------------------------------------------------------
		const rendering = new Adw.PreferencesGroup({ title: "Rendering" });
		page.add(rendering);
		rendering.add(
			spinRow(
				settings,
				"animation-fps",
				"Animation frame rate",
				"Sprite frames per second.",
				4,
				30,
			),
		);

		return Promise.resolve();
	}

	/**
	 * One row per bed or post: a spin button holding where it stands as a
	 * percentage of the floor from the left, and an "Auto" switch that hands
	 * the placement back to the cats. While Auto is on the number is greyed
	 * out but keeps its last value, so switching Auto off puts the prop back
	 * where it was.
	 *
	 * The rows follow the count: turning a bed on adds its row, turning it off
	 * takes the row away (its stored position is kept for when it comes back).
	 */
	private _positionsRow(
		settings: Gio.Settings,
		countKey: string,
		positionsKey: string,
		noun: string,
	): Adw.ExpanderRow {
		const expander = new Adw.ExpanderRow({
			title: `${noun} positions`,
			subtitle:
				"Percent of the floor from the left edge. " +
				`Auto leaves a ${noun.toLowerCase()} where the cats would put it.`,
		});

		const stored = (): number[] =>
			normalizePositions(settings.get_value(positionsKey).deepUnpack());
		const rows: {
			row: Adw.ActionRow;
			spin: Gtk.SpinButton;
			auto: Gtk.Switch;
		}[] = [];
		let rebuilding = false;

		const commit = (): void => {
			if (rebuilding) return;
			// Entries beyond the current count are kept as they were.
			const values = stored();
			rows.forEach(({ spin, auto }, i) => {
				values[i] = auto.active ? AUTO_POSITION : Math.round(spin.value);
			});
			for (let i = 0; i < values.length; i++)
				if (values[i] === undefined) values[i] = AUTO_POSITION;
			settings.set_value(positionsKey, new GLib.Variant("ai", values));
		};

		const rebuild = (): void => {
			rebuilding = true;
			for (const { row } of rows) expander.remove(row);
			rows.length = 0;
			const values = stored();
			const count = settings.get_int(countKey);
			for (let i = 0; i < count; i++) {
				const value = values[i] ?? AUTO_POSITION;
				const isAuto = value === AUTO_POSITION;

				const spin = new Gtk.SpinButton({
					adjustment: new Gtk.Adjustment({
						lower: 0,
						upper: 100,
						step_increment: 1,
						page_increment: 10,
						// A fresh row starts in the middle, so switching Auto
						// off puts the prop somewhere visible straight away.
						value: isAuto ? 50 : value,
					}),
					numeric: true,
					valign: Gtk.Align.CENTER,
					sensitive: !isAuto,
				});
				const auto = new Gtk.Switch({
					active: isAuto,
					valign: Gtk.Align.CENTER,
				});
				const autoBox = new Gtk.Box({
					spacing: 8,
					valign: Gtk.Align.CENTER,
					margin_start: 12,
				});
				autoBox.append(new Gtk.Label({ label: "Auto" }));
				autoBox.append(auto);

				const row = new Adw.ActionRow({
					title: `${noun} ${i + 1}`,
					activatable_widget: spin,
				});
				row.add_suffix(spin);
				row.add_suffix(autoBox);

				spin.connect("value-changed", commit);
				auto.connect("notify::active", () => {
					spin.sensitive = !auto.active;
					commit();
				});
				rows.push({ row, spin, auto });
				expander.add_row(row);
			}
			expander.sensitive = count > 0;
			rebuilding = false;
		};

		rebuild();
		settings.connect(`changed::${countKey}`, rebuild);
		return expander;
	}

	/**
	 * One expander per cat, following the cat count: a name, a palette, a size
	 * with an Auto switch, and a preview of what the cat will wear. Entries
	 * beyond the current count are kept in the arrays so a cat that comes back
	 * gets its old settings.
	 */
	private _catsGroup(
		settings: Gio.Settings,
		palettes: string[],
		preview: () => SpritePreview | null,
	): Adw.PreferencesGroup {
		const group = new Adw.PreferencesGroup({
			title: "Each cat",
			description: "Auto follows the fur palettes and the cat size above.",
		});

		const names = (): string[] =>
			normalizeStringList(settings.get_strv(STRING_LIST_SETTINGS.catNames.key));
		const catPalettes = (): string[] =>
			normalizeStringList(
				settings.get_strv(STRING_LIST_SETTINGS.catPalettes.key),
			);
		const sizes = (): number[] =>
			normalizeCatSizes(settings.get_value(CAT_SIZES_KEY).deepUnpack());

		interface CatRow {
			row: Adw.ExpanderRow;
			name: Adw.EntryRow;
			palette: Adw.ComboRow;
			size: Gtk.SpinButton;
			auto: Gtk.Switch;
			picture: SpritePreview | null;
		}
		const rows: CatRow[] = [];
		let rebuilding = false;

		const commit = (): void => {
			if (rebuilding) return;
			const n = names();
			const p = catPalettes();
			const s = sizes();
			rows.forEach((r, i) => {
				n[i] = r.name.text ?? "";
				p[i] = r.palette.selected > 0 ? palettes[r.palette.selected - 1] : "";
				s[i] = r.auto.active ? 0 : Math.round(r.size.value);
			});
			for (let k = 0; k < rows.length; k++) {
				if (n[k] === undefined) n[k] = "";
				if (p[k] === undefined) p[k] = "";
				if (s[k] === undefined) s[k] = 0;
			}
			settings.set_strv(STRING_LIST_SETTINGS.catNames.key, n);
			settings.set_strv(STRING_LIST_SETTINGS.catPalettes.key, p);
			settings.set_value(CAT_SIZES_KEY, new GLib.Variant("ai", s));
		};

		const refreshPreviews = (): void => {
			const view = {
				palettes: settings.get_strv(PALETTES_KEY),
				catPalettes: catPalettes(),
			};
			rows.forEach((r, i) => {
				r.picture?.setPalette(resolveCatPalette(view, i, palettes));
			});
		};

		const rebuild = (): void => {
			rebuilding = true;
			for (const { row } of rows) group.remove(row);
			rows.length = 0;
			const n = names();
			const p = catPalettes();
			const s = sizes();
			const count = settings.get_int("cat-count");
			for (let i = 0; i < count; i++) {
				const row = new Adw.ExpanderRow({ title: n[i] || `Cat ${i + 1}` });

				const name = new Adw.EntryRow({ title: "Name", text: n[i] ?? "" });
				name.connect("changed", () => {
					row.title = (name.text ?? "").trim() || `Cat ${i + 1}`;
					commit();
				});
				row.add_row(name);

				const palette = new Adw.ComboRow({
					title: "Fur palette",
					model: Gtk.StringList.new(["Auto", ...palettes]),
					selected: Math.max(0, palettes.indexOf(p[i] ?? "") + 1),
				});
				palette.connect("notify::selected", () => {
					commit();
					refreshPreviews();
				});
				row.add_row(palette);

				const own = s[i] ?? 0;
				const size = new Gtk.SpinButton({
					adjustment: new Gtk.Adjustment({
						lower: CAT_SIZE_MIN,
						upper: CAT_SIZE_MAX,
						step_increment: 1,
						page_increment: 8,
						value: own || 48,
					}),
					numeric: true,
					valign: Gtk.Align.CENTER,
					sensitive: own !== 0,
				});
				const auto = new Gtk.Switch({
					active: own === 0,
					valign: Gtk.Align.CENTER,
				});
				const autoBox = new Gtk.Box({
					spacing: 8,
					valign: Gtk.Align.CENTER,
					margin_start: 12,
				});
				autoBox.append(new Gtk.Label({ label: "Auto" }));
				autoBox.append(auto);
				const sizeRow = new Adw.ActionRow({
					title: "Size",
					subtitle: "In pixels.",
					activatable_widget: size,
				});
				sizeRow.add_suffix(size);
				sizeRow.add_suffix(autoBox);
				size.connect("value-changed", commit);
				auto.connect("notify::active", () => {
					size.sensitive = !auto.active;
					commit();
				});
				row.add_row(sizeRow);

				const picture = preview();
				if (picture) row.add_prefix(picture.widget);

				rows.push({ row, name, palette, size, auto, picture });
				group.add(row);
			}
			rebuilding = false;
			refreshPreviews();
		};

		rebuild();
		settings.connect("changed::cat-count", rebuild);
		settings.connect(`changed::${PALETTES_KEY}`, refreshPreviews);
		return group;
	}

	/**
	 * The hide/show shortcut: a label showing the current one and a button
	 * that opens a small window waiting for the next key press. Escape keeps
	 * the old shortcut, Backspace removes it, and a key without a modifier is
	 * refused because GNOME would grab it from every application.
	 */
	private _hotkeyRow(
		settings: Gio.Settings,
		parent: Gtk.Window,
	): Adw.ActionRow {
		const row = new Adw.ActionRow({
			title: "Hide or show the cats",
			subtitle: "A keyboard shortcut that works in any program.",
		});
		const label = new Gtk.ShortcutLabel({
			accelerator: settings.get_strv(HOTKEY_KEY)[0] ?? "",
			disabled_text: "Not set",
			valign: Gtk.Align.CENTER,
		});
		const button = new Gtk.Button({
			label: "Change…",
			valign: Gtk.Align.CENTER,
		});
		row.add_suffix(label);
		row.add_suffix(button);
		row.activatable_widget = button;

		settings.connect(`changed::${HOTKEY_KEY}`, () => {
			label.accelerator = settings.get_strv(HOTKEY_KEY)[0] ?? "";
		});

		button.connect("clicked", () => {
			const dialog = new Gtk.Window({
				transient_for: parent,
				modal: true,
				title: "Hide or show the cats",
				default_width: 380,
				resizable: false,
			});
			const box = new Gtk.Box({
				orientation: Gtk.Orientation.VERTICAL,
				spacing: 8,
				margin_top: 24,
				margin_bottom: 24,
				margin_start: 24,
				margin_end: 24,
			});
			box.append(
				new Gtk.Label({
					label: "Press the new shortcut.",
					css_classes: ["title-3"],
				}),
			);
			const hint = new Gtk.Label({
				label: "Escape keeps the old one. Backspace removes it.",
				css_classes: ["dim-label"],
				wrap: true,
			});
			box.append(hint);
			dialog.set_child(box);

			const keys = new Gtk.EventControllerKey();
			keys.connect("key-pressed", (_controller, keyval, _keycode, state) => {
				const mods = state & Gtk.accelerator_get_default_mod_mask();
				if (keyval === Gdk.KEY_Escape && !mods) {
					dialog.close();
					return Gdk.EVENT_STOP;
				}
				if (keyval === Gdk.KEY_BackSpace && !mods) {
					settings.set_strv(HOTKEY_KEY, []);
					dialog.close();
					return Gdk.EVENT_STOP;
				}
				// A modifier on its own names a key ("Control_L") that is not in
				// the table, so parse returns null and we keep waiting.
				const accel = parseAccelerator(Gtk.accelerator_name(keyval, mods));
				if (!accel) return Gdk.EVENT_STOP;
				if (!hasModifier(accel)) {
					hint.label = "Add Ctrl, Alt, Shift or Super.";
					return Gdk.EVENT_STOP;
				}
				settings.set_strv(HOTKEY_KEY, [formatAccelerator(accel)]);
				dialog.close();
				return Gdk.EVENT_STOP;
			});
			dialog.add_controller(keys);
			dialog.present();
		});
		return row;
	}

	/** One toggle per fur palette, with a preview of each. */
	private _paletteRow(
		settings: Gio.Settings,
		palettes: string[],
		preview: () => SpritePreview | null,
	): Adw.ExpanderRow {
		const expander = new Adw.ExpanderRow({
			title: "Fur palettes",
			subtitle: "Cats are assigned these in turn.",
		});

		const enabled = new Set(settings.get_strv("palettes"));
		// An empty list means "all of them", which is the default.
		const allOn = enabled.size === 0;

		const rows = new Map<string, Adw.SwitchRow>();
		const commit = (): void => {
			const chosen = [...rows.entries()]
				.filter(([, row]) => row.active)
				.map(([name]) => name);
			// Storing every palette and storing none mean the same thing;
			// normalise to the empty list so the default stays meaningful.
			settings.set_strv(
				"palettes",
				chosen.length === palettes.length ? [] : chosen,
			);
		};

		for (const name of palettes) {
			const row = new Adw.SwitchRow({
				title: name.replace(/-/g, " "),
				active: allOn || enabled.has(name),
			});
			const picture = preview();
			if (picture) {
				picture.setPalette(name);
				row.add_prefix(picture.widget);
			}
			row.connect("notify::active", () => {
				// Never let the user switch every palette off.
				if (![...rows.values()].some((r) => r.active)) {
					row.active = true;
					return;
				}
				commit();
			});
			rows.set(name, row);
			expander.add_row(row);
		}

		return expander;
	}
}
