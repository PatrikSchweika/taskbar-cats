export class ExtensionPreferences {
	path = "";
	getSettings(): unknown {
		return null;
	}
	fillPreferencesWindow(_window: unknown): Promise<void> {
		return Promise.resolve();
	}
}
export default { ExtensionPreferences };
