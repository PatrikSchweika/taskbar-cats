#!/usr/bin/env node
/**
 * Build and install tasks for taskbar-cats.
 *
 * Written in TypeScript and run directly by Node's native type stripping, so
 * the tooling itself needs no build step. Invoked through `npm run …`.
 */
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { writeZipFromDirectory } from "./zip.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "src");
const BUILD = join(ROOT, "build");
const DIST = join(ROOT, "dist");

interface Metadata {
	uuid: string;
	name: string;
	description: string;
	"shell-version": string[];
	"settings-schema"?: string;
	/** GNOME compares this integer to decide which copy of an extension is newer. */
	version?: number;
	/** Displayed, never compared. Filled in from package.json at build time. */
	"version-name"?: string;
}

/**
 * The metadata.json that goes into the built extension.
 *
 * The only thing added to the committed file is `version-name`, so the
 * Extensions app shows the same version as the release it came from without
 * that version having to be written down in two places. `version` stays as
 * committed: it is the integer GNOME orders releases by, and bumping it is a
 * deliberate act, not something a build should guess from a semver string.
 */
export function extensionMetadata(
	source: Metadata,
	packageVersion: string,
): Metadata {
	return { ...source, "version-name": packageVersion };
}

/**
 * metadata.json is the single source of truth for the UUID and schema id —
 * nothing else in the build restates them, or they drift.
 */
const metadata = JSON.parse(
	readFileSync(join(SRC, "metadata.json"), "utf8"),
) as Metadata;
const UUID = metadata.uuid;
const SCHEMA = metadata["settings-schema"] ?? "";
const INSTALLDIR = join(homedir(), ".local/share/gnome-shell/extensions", UUID);

/**
 * Everything that is copied into the extension verbatim.
 *
 * metadata.json is not among them: build() writes a derived copy carrying the
 * release version. See extensionMetadata.
 */
const STATIC_SOURCES = ["stylesheet.css", "schemas", "assets"];

/** The release version, which only package.json states. */
function packageVersion(): string {
	const manifest = JSON.parse(
		readFileSync(join(ROOT, "package.json"), "utf8"),
	) as { version: string };
	return manifest.version;
}

function run(
	cmd: string,
	args: string[],
	opts: { quiet?: boolean } = {},
): number {
	const r = spawnSync(cmd, args, {
		stdio: opts.quiet ? "pipe" : "inherit",
		cwd: ROOT,
		encoding: "utf8",
	});
	if (r.error) die(`${cmd}: ${r.error.message}`);
	return r.status ?? 1;
}

/**
 * Whether the *running* shell knows about this uuid.
 *
 * `gnome-extensions` talks to the shell over D-Bus, and GNOME only scans the
 * extensions directory at startup. A freshly installed extension is therefore
 * invisible until the shell restarts, which produces a bewildering
 * "Extension ... does not exist" from an extension that plainly does exist.
 */
function shellKnows(uuid: string): boolean {
	const r = spawnSync("gnome-extensions", ["list"], { encoding: "utf8" });
	if (r.status !== 0) return false;
	return String(r.stdout)
		.split("\n")
		.map((l) => l.trim())
		.includes(uuid);
}

function requireShellKnows(): void {
	if (!existsSync(INSTALLDIR))
		die(`${UUID} is not installed. Run: npm run ext:install`);
	if (shellKnows(UUID)) return;
	console.error(`error: ${UUID} is installed at`);
	console.error(`       ${INSTALLDIR}`);
	console.error("       but the running GNOME Shell has not scanned it yet.");
	console.error("");
	console.error(
		"GNOME only looks for new extensions when it starts. Restart the",
	);
	console.error("shell, then run this command again:");
	console.error("  X11:      Alt+F2, type 'r', Enter");
	console.error("  Wayland:  log out and back in");
	process.exit(1);
}

function die(msg: string): never {
	console.error(`error: ${msg}`);
	process.exit(1);
}

// -- validate ---------------------------------------------------------------

function validate(): boolean {
	let ok = true;
	const fail = (m: string) => {
		console.error(`  ✗ ${m}`);
		ok = false;
	};

	for (const key of ["uuid", "name", "description", "shell-version"] as const) {
		if (!metadata[key]) fail(`metadata.json is missing "${key}"`);
	}
	if (
		!Array.isArray(metadata["shell-version"]) ||
		!metadata["shell-version"].length
	)
		fail('metadata.json "shell-version" must be a non-empty array');
	// GNOME's convention is name@domain and extensions.gnome.org requires it,
	// but the shell itself only requires that the uuid match the directory
	// name. A bare name is fine for a locally installed extension.
	if (UUID && !/^[A-Za-z0-9._@-]+$/.test(UUID))
		fail(
			`metadata.json uuid "${UUID}" has characters that cannot appear in a directory name`,
		);
	if (ok) console.log("metadata: ok");

	// GSettings schema, and its id agreeing with metadata.json
	const schemaDir = join(SRC, "schemas");
	if (
		run("glib-compile-schemas", ["--strict", "--dry-run", schemaDir], {
			quiet: true,
		}) !== 0
	) {
		run("glib-compile-schemas", ["--strict", "--dry-run", schemaDir]);
		fail("schema failed to compile");
	} else if (SCHEMA) {
		const file = join(schemaDir, `${SCHEMA}.gschema.xml`);
		if (!existsSync(file))
			fail(
				`metadata declares settings-schema "${SCHEMA}" but ${file} is missing`,
			);
		else if (!readFileSync(file, "utf8").includes(`id="${SCHEMA}"`))
			fail(`${file} does not declare id="${SCHEMA}"`);
		else console.log("schema: ok");
	}

	// Every frame the manifest promises actually exists
	const catsDir = join(SRC, "assets", "cats");
	const manifestPath = join(catsDir, "manifest.json");
	if (!existsSync(manifestPath)) {
		fail("assets/cats/manifest.json is missing — run `npm run sprites`");
	} else {
		const {
			palettes,
			animations,
			props = {},
		} = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			palettes: string[];
			animations: Record<string, number>;
			props?: Record<string, number>;
		};
		let count = 0;
		let missing = 0;
		const expect = (relative: string): void => {
			count++;
			if (!existsSync(join(catsDir, relative))) {
				fail(`missing sprite ${relative}`);
				missing++;
			}
		};
		for (const palette of palettes)
			for (const [anim, frames] of Object.entries(animations))
				for (let i = 0; i < frames; i++) expect(`${palette}/${anim}_${i}.svg`);
		for (const [prop, frames] of Object.entries(props))
			for (let i = 0; i < frames; i++) expect(`props/${prop}_${i}.svg`);
		if (!missing)
			console.log(
				`sprites: ok (${count} frames, ${palettes.length} palettes, ${Object.keys(props).length} props)`,
			);
	}
	return ok;
}

// -- build ------------------------------------------------------------------

function typecheck(): void {
	if (run("npx", ["tsc", "--noEmit"]) !== 0) die("typecheck failed");
	console.log("types: ok");
}

function build(): void {
	rmSync(BUILD, { recursive: true, force: true });
	if (run("npx", ["tsc"]) !== 0) die("compile failed");
	for (const entry of STATIC_SOURCES) {
		const from = join(SRC, entry);
		if (existsSync(from)) cpSync(from, join(BUILD, entry), { recursive: true });
	}
	writeFileSync(
		join(BUILD, "metadata.json"),
		`${JSON.stringify(extensionMetadata(metadata, packageVersion()), null, 2)}\n`,
	);
	const emitted = readdirSync(BUILD).filter((f) => f.endsWith(".js"));
	if (!emitted.includes("extension.js"))
		die("tsc did not emit extension.js — check tsconfig rootDir/outDir");
	console.log(
		`build: ok -> build/ (${emitted.join(", ")} + core/, platform/, assets/, schemas/)`,
	);
}

// -- extension lifecycle ----------------------------------------------------

function install(): void {
	build();
	rmSync(INSTALLDIR, { recursive: true, force: true });
	mkdirSync(INSTALLDIR, { recursive: true });
	cpSync(BUILD, INSTALLDIR, { recursive: true });
	run("glib-compile-schemas", [join(INSTALLDIR, "schemas")]);
	console.log(`installed -> ${INSTALLDIR}`);
	console.log("");
	console.log(
		"Restart the shell FIRST, then enable — the running shell only scans",
	);
	console.log(
		"the extensions directory at startup, so enabling before a restart fails.",
	);
	console.log(
		"  1. Alt+F2, type 'r', Enter     (X11; on Wayland log out and back in)",
	);
	console.log("  2. npm run ext:enable");
	console.log("");
	console.log("Or test without touching your desktop:  npm run test:shell");
}

/**
 * The installable zip, in dist/.
 *
 * `gnome-extensions pack` would do this, but it lives inside gnome-shell — so
 * using it meant the zip could only be built on a machine that already had
 * GNOME, which is the opposite of what the zip is for. Packing it here needs
 * nothing but Node, so CI can attach one to a release and a developer on any
 * platform can build one.
 *
 * The whole build directory goes in, which is also one fewer thing to keep in
 * step: the old invocation had to name each directory tsc emits.
 */
function pack(): void {
	build();
	mkdirSync(DIST, { recursive: true });
	const out = join(DIST, `${UUID}.shell-extension.zip`);
	const files = writeZipFromDirectory(BUILD, out);
	console.log(`packed ${files} files -> dist/${UUID}.shell-extension.zip`);
	console.log("");
	console.log("Install it with:");
	console.log(`  gnome-extensions install --force ${UUID}.shell-extension.zip`);
}

// -- dispatch ---------------------------------------------------------------

function main(argv: string[]): void {
	const command = argv[2] ?? "help";

	switch (command) {
		case "validate":
			process.exit(validate() ? 0 : 1);
			break;
		case "check":
			typecheck();
			process.exit(validate() ? 0 : 1);
			break;
		case "build":
			build();
			break;
		case "install":
			if (!validate()) die("validation failed");
			install();
			break;
		case "uninstall":
			run("gnome-extensions", ["disable", UUID], { quiet: true });
			rmSync(INSTALLDIR, { recursive: true, force: true });
			console.log(`removed ${INSTALLDIR}`);
			break;
		case "enable":
			requireShellKnows();
			process.exit(run("gnome-extensions", ["enable", UUID]));
			break;
		case "disable":
			process.exit(run("gnome-extensions", ["disable", UUID]));
			break;
		case "prefs":
			requireShellKnows();
			process.exit(run("gnome-extensions", ["prefs", UUID]));
			break;
		case "pack":
			pack();
			break;
		case "clean":
			rmSync(BUILD, { recursive: true, force: true });
			rmSync(DIST, { recursive: true, force: true });
			console.log("removed build/ and dist/");
			break;
		default:
			console.log(
				"usage: node tools/cli.ts <check|validate|build|install|uninstall|" +
					"enable|disable|prefs|pack|clean>",
			);
			process.exit(1);
	}
}

// Only when run directly, so tests can import the helpers above.
const invoked = process.argv[1];
if (invoked && fileURLToPath(import.meta.url) === resolve(invoked))
	main(process.argv);
