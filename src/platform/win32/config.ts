/**
 * Settings on disk, standing in for GSettings.
 *
 * A single JSON file keyed exactly as the GSettings schema is, so a Windows
 * config and a `gsettings list-recursively` dump read the same way. Validation,
 * defaults and ranges all come from core/config.ts — this file only does I/O
 * and change notification.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
	defaultSettings,
	normalizeSettings,
	type Settings,
	toStorage,
} from "../../core/config.js";

export type ConfigListener = (settings: Settings, changed: string[]) => void;

export class ConfigStore {
	readonly path: string;
	private _settings: Settings;
	private _listeners: ConfigListener[] = [];

	constructor(userDataDir: string) {
		this.path = join(userDataDir, "settings.json");
		this._settings = this._read();
	}

	get settings(): Settings {
		return this._settings;
	}

	private _read(): Settings {
		try {
			return normalizeSettings(JSON.parse(readFileSync(this.path, "utf8")));
		} catch (e) {
			// A missing file is the first run. Anything else — unparseable JSON,
			// a permissions problem — is reported but must not stop the app: the
			// defaults are always a usable configuration.
			if ((e as NodeJS.ErrnoException).code !== "ENOENT")
				console.error(`ubuntu-cats: ignoring ${this.path}: ${e}`);
			return defaultSettings();
		}
	}

	/**
	 * Merge a partial update, persist it, and notify listeners.
	 *
	 * Returns the keys that actually changed, so a caller can skip work — the
	 * settings window sends the whole object on every keystroke.
	 */
	update(patch: Partial<Settings>): string[] {
		const next = normalizeSettings(toStorage({ ...this._settings, ...patch }));
		const changed = changedKeys(this._settings, next);
		if (!changed.length) return [];

		this._settings = next;
		this._write(next);
		for (const listener of this._listeners) listener(next, changed);
		return changed;
	}

	private _write(settings: Settings): void {
		// Write-then-rename: a crash mid-write leaves the previous settings
		// intact rather than a truncated file that reads as "all defaults".
		try {
			mkdirSync(dirname(this.path), { recursive: true });
			const temporary = `${this.path}.tmp`;
			writeFileSync(
				temporary,
				`${JSON.stringify(toStorage(settings), null, 2)}\n`,
			);
			renameSync(temporary, this.path);
		} catch (e) {
			console.error(`ubuntu-cats: could not save ${this.path}: ${e}`);
		}
	}

	onChange(listener: ConfigListener): void {
		this._listeners.push(listener);
	}
}

/** Which properties differ between two settings objects. */
export function changedKeys(a: Settings, b: Settings): string[] {
	const out: string[] = [];
	for (const key of Object.keys(b) as (keyof Settings)[]) {
		const before = a[key];
		const after = b[key];
		const same = Array.isArray(before)
			? Array.isArray(after) &&
				before.length === after.length &&
				before.every((v, i) => v === after[i])
			: before === after;
		if (!same) out.push(key);
	}
	return out;
}
