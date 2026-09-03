import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extensionMetadata } from "../../tools/cli.ts";

/**
 * The metadata.json that goes into the built extension.
 *
 * GNOME reads two different versions out of it and they are not
 * interchangeable: `version` is an integer it compares to decide whether one
 * copy of an extension is newer than another, and `version-name` is a string
 * it only ever displays. Getting them the wrong way round produces an
 * extension that either will not update or reports a nonsense version.
 */
describe("extensionMetadata", () => {
	const source = {
		uuid: "ubuntu-cats",
		name: "Ubuntu Cats",
		description: "cats",
		"shell-version": ["45", "46", "47", "48"],
		"settings-schema": "org.gnome.shell.extensions.ubuntu-cats",
		version: 2,
	};

	it("shows the release version people recognise", () => {
		// The tag is v1.1.0, so that is what the Extensions app should say —
		// not the "2" that GNOME orders releases by.
		assert.equal(extensionMetadata(source, "1.1.0")["version-name"], "1.1.0");
	});

	it("keeps the integer version GNOME compares releases with", () => {
		const built = extensionMetadata(source, "1.1.0");
		assert.equal(built.version, 2);
		assert.equal(typeof built.version, "number");
	});

	it("leaves the uuid and schema alone, which settings depend on", () => {
		const built = extensionMetadata(source, "9.9.9");
		assert.equal(built.uuid, "ubuntu-cats");
		assert.equal(
			built["settings-schema"],
			"org.gnome.shell.extensions.ubuntu-cats",
		);
	});

	it("does not mutate the source metadata", () => {
		// src/metadata.json is committed; a build that rewrote it in place would
		// show up as a dirty working tree and eventually get committed.
		extensionMetadata(source, "1.1.0");
		assert.equal("version-name" in source, false);
	});
});
