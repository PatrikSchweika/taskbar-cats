import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { extensionMetadata } from "../../tools/cli.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

/**
 * The metadata.json that goes into the built extension.
 *
 * `version-name` is the string GNOME displays and is all the build fills in.
 * The integer `version` GNOME orders releases by is deliberately absent from
 * the committed file: extensions.gnome.org assigns it on upload.
 */
describe("extensionMetadata", () => {
	const source = {
		uuid: "taskbar-cats@patrikschweika.github.io",
		name: "Taskbar Cats",
		description: "cats",
		"shell-version": ["45", "46", "47", "48", "49", "50"],
		url: "https://github.com/PatrikSchweika/taskbar-cats",
		"settings-schema": "org.gnome.shell.extensions.taskbar-cats",
	};

	it("shows the release version people recognise", () => {
		// The tag is v1.1.0, so that is what the Extensions app should say.
		assert.equal(extensionMetadata(source, "1.1.0")["version-name"], "1.1.0");
	});

	it("leaves the uuid and schema alone, which settings depend on", () => {
		const built = extensionMetadata(source, "9.9.9");
		assert.equal(built.uuid, "taskbar-cats@patrikschweika.github.io");
		assert.equal(
			built["settings-schema"],
			"org.gnome.shell.extensions.taskbar-cats",
		);
	});

	it("does not mutate the source metadata", () => {
		// src/metadata.json is committed; a build that rewrote it in place would
		// show up as a dirty working tree and eventually get committed.
		extensionMetadata(source, "1.1.0");
		assert.equal("version-name" in source, false);
	});
});

/**
 * The committed metadata, against what extensions.gnome.org will accept.
 *
 * These are the rules the site rejects an upload over rather than warns about,
 * and every one of them is a single line in a file nothing else validates.
 */
describe("src/metadata.json", () => {
	const metadata = JSON.parse(
		readFileSync(join(SRC, "metadata.json"), "utf8"),
	) as Record<string, unknown>;

	it("has a uuid of the form name@namespace", () => {
		const uuid = String(metadata.uuid);
		assert.match(uuid, /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/);
		// The site reserves its own domain, so an extension cannot claim it.
		assert.equal(uuid.endsWith("@gnome.org"), false);
	});

	it("links to the repository", () => {
		assert.match(String(metadata.url), /^https:\/\//);
	});

	it("leaves the deprecated version key to the site", () => {
		assert.equal("version" in metadata, false);
	});

	it("ships the schema it declares", () => {
		const schema = String(metadata["settings-schema"]);
		assert.ok(existsSync(join(SRC, "schemas", `${schema}.gschema.xml`)));
	});
});
