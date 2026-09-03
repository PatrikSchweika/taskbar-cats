type SettingsHandler = (settings: unknown, key: string) => void;

export class File {
	path: string;
	constructor(path: string) {
		this.path = path;
	}
	static new_for_path(path: string): File {
		return new File(path);
	}
}

/** Carries the path so tests can assert which frame was selected. */
export class FileIcon {
	file: File;
	constructor(file: File) {
		this.file = file;
	}
	static new(file: File): FileIcon {
		return new FileIcon(file);
	}
	get path(): string {
		return this.file.path;
	}
}

export const SettingsBindFlags = {
	DEFAULT: 0,
	GET: 1,
	NO_SENSITIVITY: 4,
};

/** A Gio.Settings good enough for reading a fixed dictionary of values. */
export class Settings {
	private _handlers = new Map<number, SettingsHandler>();
	private _nextId = 1;
	values: Record<string, unknown>;
	constructor(values: Record<string, unknown> = {}) {
		this.values = values;
	}
	get_int(key: string): number {
		return Number(this.values[key] ?? 0);
	}
	get_boolean(key: string): boolean {
		return Boolean(this.values[key]);
	}
	get_strv(key: string): string[] {
		return (this.values[key] as string[]) ?? [];
	}
	set_strv(key: string, value: string[]): void {
		this.values[key] = value;
	}
	/** Just enough GLib.Variant to `deepUnpack()` an array key. */
	get_value(key: string): { deepUnpack<T>(): T } {
		const value = this.values[key] ?? [];
		return { deepUnpack: <T>() => value as T };
	}
	set_value(key: string, value: { deepUnpack<T>(): T }): boolean {
		this.values[key] = value.deepUnpack();
		return true;
	}
	connect(_signal: string, cb: SettingsHandler): number {
		const id = this._nextId++;
		this._handlers.set(id, cb);
		return id;
	}
	disconnect(id: number): void {
		if (!this._handlers.delete(id))
			throw new Error(`no settings handler ${id}`);
	}
	bind(): void {}
	/** Test control: change a key and notify listeners, as GSettings would. */
	__change(key: string, value: unknown): void {
		this.values[key] = value;
		for (const cb of [...this._handlers.values()]) cb(this, key);
	}
	__handlerCount(): number {
		return this._handlers.size;
	}
}

export default { File, FileIcon, Settings, SettingsBindFlags };
