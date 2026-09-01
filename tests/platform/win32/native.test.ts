import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadShell } from "../../../src/platform/win32/native.ts";

describe("loadShell", () => {
	it("degrades instead of throwing when the addon is not there", () => {
		// The whole point: no taskbar helper is a working app with cats that
		// cannot see icons, not a crash on startup.
		const loaded = loadShell();
		if (process.platform === "win32" && loaded.available) return;

		assert.equal(loaded.available, false);
		assert.ok(loaded.reason, "an unavailable shell should say why");
		assert.equal(loaded.shell.taskbar(), null);
		assert.deepEqual(loaded.shell.taskbarButtons(), []);
		assert.equal(loaded.shell.notificationArea(), null);
		assert.equal(loaded.shell.cursor(), null);
		assert.equal(loaded.shell.foregroundFullscreen(), false);
		assert.doesNotThrow(() => loaded.shell.dispose());
	});
});
