import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appManifest } from "../../tools/win32.ts";

/**
 * The manifest that goes inside the packaged app.
 *
 * Small, but two of its fields decide whether an installed app works at all:
 * `main` is the only thing telling Electron where to start, and `type` is what
 * makes the emitted ES modules loadable. Neither can be checked without
 * building an installer, so they are checked here.
 */
describe("appManifest", () => {
	const root = {
		name: "taskbar-cats",
		version: "2.3.4",
		description: "cats",
		author: "Someone",
		license: "MIT",
	};

	it("points Electron at the compiled main process", () => {
		assert.equal(appManifest(root).main, "platform/win32/main.js");
	});

	it("declares the app an ES module", () => {
		// The preload's own directory overrides this back to commonjs.
		assert.equal(appManifest(root).type, "module");
	});

	it("takes the version from the repository, so there is one source", () => {
		assert.equal(appManifest(root).version, "2.3.4");
	});

	it("names the app the same way in development and in a package", () => {
		// productName decides app.getName(), and so where settings.json lives.
		// A package that disagreed with `npm run win:dev` would read a
		// different settings file from the one the developer had been editing.
		assert.equal(appManifest(root).productName, "Ubuntu Cats");
	});

	it("keeps the npm name, which is not the product name", () => {
		assert.equal(appManifest(root).name, "taskbar-cats");
	});

	it("carries the author through for the installer's publisher field", () => {
		assert.equal(appManifest(root).author, "Someone");
	});
});
