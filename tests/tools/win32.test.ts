import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { appManifest } from "../../tools/win32.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The manifest that goes inside the packaged app.
 *
 * Small, but two of its fields decide whether an installed app works at all:
 * `main` is the only thing telling Electron where to start, and `type` is what
 * makes the emitted ES modules loadable. Neither can be checked without
 * building an installer, so they are checked here.
 */
describe("the product name", () => {
	it("is the same in package.json and electron-builder.yml", () => {
		// electron-builder names the installer, the Start-menu entry and the
		// install directory from its own copy; app.getName() comes from the
		// packaged manifest, which takes package.json's. If they drifted, the
		// app would write settings.json under a name the installer never used.
		const manifest = JSON.parse(
			readFileSync(join(ROOT, "package.json"), "utf8"),
		) as { productName: string };
		const yml = readFileSync(join(ROOT, "electron-builder.yml"), "utf8");
		const declared = /^productName: (.+)$/m.exec(yml)?.[1].trim();
		assert.equal(declared, manifest.productName);
	});
});

describe("appManifest", () => {
	const root = {
		name: "taskbar-cats",
		productName: "Cats of Some Kind",
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
		// It comes from the repository manifest rather than a literal here, so
		// there is one place to change it.
		assert.equal(appManifest(root).productName, "Cats of Some Kind");
	});

	it("keeps the npm name, which is not the product name", () => {
		assert.equal(appManifest(root).name, "taskbar-cats");
	});

	it("carries the author through for the installer's publisher field", () => {
		assert.equal(appManifest(root).author, "Someone");
	});

	it("declares the runtime dependencies, so they are packaged", () => {
		// electron-builder reads dependencies from *this* manifest to decide what
		// to put in app.asar, resolving them from the repository's node_modules.
		// Without them the packaged app throws on `require("electron-updater")`
		// at startup — which nothing before the first release would catch.
		assert.deepEqual(
			appManifest({ ...root, dependencies: { "electron-updater": "^6.8.9" } })
				.dependencies,
			{ "electron-updater": "^6.8.9" },
		);
	});

	it("declares no dependencies when the repository has none", () => {
		assert.deepEqual(appManifest(root).dependencies, {});
	});
});
