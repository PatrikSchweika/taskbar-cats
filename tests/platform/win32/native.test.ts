import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	candidatePaths,
	loadShell,
} from "../../../src/platform/win32/native.ts";

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
		assert.equal(loaded.shell.foreground(), null);
		assert.doesNotThrow(() => loaded.shell.dispose());
	});
});

describe("candidatePaths", () => {
	// Where the addon ends up in a package is the one thing about it that
	// cannot be checked by running from source, and getting it wrong produces
	// an installed app that quietly ignores the taskbar.
	const BUILT = join(
		"native",
		"win32-shell",
		"build",
		"Release",
		"win32_shell.node",
	);
	/** Where the compiled main.js sits when running from a checkout. */
	const FROM = join("C:", "repo", "build-win32", "platform", "win32");

	it("finds the checkout's own build, three directories up", () => {
		assert.equal(candidatePaths(FROM)[0], join("C:", "repo", BUILT));
	});

	it("does not guess at resources when there is no package", () => {
		// process.resourcesPath is meaningless when running from source.
		assert.equal(
			candidatePaths(FROM).some((p) => p.includes("resources")),
			false,
		);
	});

	it("looks where electron-builder.yml puts it", () => {
		// extraResources drops it straight into resources/, outside the asar
		// archive, because LoadLibrary needs a real file on disk.
		const resources = join("C:", "Program Files", "Ubuntu Cats", "resources");
		assert.equal(
			candidatePaths(FROM, resources)[2],
			join(resources, "win32_shell.node"),
		);
	});

	it("still falls back to an asar-packed layout", () => {
		// So the loader survives the packaging config changing under it.
		const resources = join("C:", "app", "resources");
		assert.ok(
			candidatePaths(FROM, resources).some((p) =>
				p.includes(join("app.asar.unpacked", "native")),
			),
		);
	});

	it("prefers a freshly built addon over a packaged one", () => {
		// A developer running from a checkout should get the binary they just
		// compiled, not one left in an installation next door.
		const paths = candidatePaths(FROM, join("C:", "app", "resources"));
		assert.equal(
			paths.findIndex((p) => p.includes("resources")),
			2,
			"the two source-tree candidates should come first",
		);
	});
});
