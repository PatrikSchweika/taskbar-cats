export class Extension {
	path = "";
	metadata: Record<string, unknown> = {};
	/** Injected by tests before enable(). */
	__settings: unknown = null;
	constructor(metadata: Record<string, unknown> = {}) {
		this.metadata = metadata;
	}
	getSettings(): unknown {
		return this.__settings;
	}
	enable(): void {}
	disable(): void {}
}
export default { Extension };
