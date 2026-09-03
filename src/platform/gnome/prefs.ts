import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";

import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { AUTO_POSITION, normalizePositions } from "../../core/config.js";

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
		colony.add(this._paletteRow(settings));

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
	 * One entry per bed or post, holding where it stands as a percentage of the
	 * floor from the left. Blank leaves that one where the cats would put it.
	 *
	 * The rows follow the count: turning a bed on adds its entry, turning it
	 * off takes the entry away (its stored position is kept, so it comes back
	 * where it was).
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
				"Percent of the floor from the left edge, 0–100. " +
				`Blank leaves a ${noun.toLowerCase()} where the cats would put it.`,
		});

		const stored = (): number[] =>
			normalizePositions(settings.get_value(positionsKey).deepUnpack());
		const rows: Adw.EntryRow[] = [];
		let rebuilding = false;

		const commit = (): void => {
			if (rebuilding) return;
			// Entries beyond the current count are kept as they were.
			const values = stored();
			rows.forEach((row, i) => {
				const text = row.get_text().trim();
				const n = Number(text);
				const valid = text !== "" && Number.isInteger(n) && n >= 0 && n <= 100;
				values[i] = valid ? n : AUTO_POSITION;
				if (text !== "" && !valid) row.add_css_class("error");
				else row.remove_css_class("error");
			});
			for (let i = 0; i < values.length; i++)
				if (values[i] === undefined) values[i] = AUTO_POSITION;
			settings.set_value(positionsKey, new GLib.Variant("ai", values));
		};

		const rebuild = (): void => {
			rebuilding = true;
			for (const row of rows) expander.remove(row);
			rows.length = 0;
			const values = stored();
			const count = settings.get_int(countKey);
			for (let i = 0; i < count; i++) {
				const value = values[i] ?? AUTO_POSITION;
				const row = new Adw.EntryRow({
					title: `${noun} ${i + 1}`,
					text: value === AUTO_POSITION ? "" : String(value),
					input_purpose: Gtk.InputPurpose.DIGITS,
				});
				row.connect("changed", commit);
				rows.push(row);
				expander.add_row(row);
			}
			expander.sensitive = count > 0;
			rebuilding = false;
		};

		rebuild();
		settings.connect(`changed::${countKey}`, rebuild);
		return expander;
	}

	/** One toggle per fur palette, read from the generated sprite manifest. */
	private _paletteRow(settings: Gio.Settings): Adw.ExpanderRow {
		const expander = new Adw.ExpanderRow({
			title: "Fur palettes",
			subtitle: "Cats are assigned these in turn.",
		});

		let palettes: string[] = [];
		try {
			const path = GLib.build_filenamev([
				this.path,
				"assets",
				"cats",
				"manifest.json",
			]);
			const [ok, bytes] = GLib.file_get_contents(path);
			if (ok) {
				palettes = (
					JSON.parse(new TextDecoder().decode(bytes)) as { palettes: string[] }
				).palettes;
			}
		} catch (e) {
			logError(e as Error, "taskbar-cats: cannot read sprite manifest");
		}

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
