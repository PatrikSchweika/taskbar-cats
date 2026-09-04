#!/usr/bin/env node
/**
 * Build, run and package tasks for the Windows backend.
 *
 * Kept apart from tools/cli.ts, which is entirely about GNOME: installing into
 * ~/.local/share/gnome-shell/extensions, compiling GSettings schemas, talking to
 * `gnome-extensions`. None of that has a Windows counterpart, and neither
 * platform's tasks should have to grow a `if (platform)` around them.
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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "build-win32");
const NATIVE = join(ROOT, "native", "win32-shell");
const RENDERER = join("platform", "win32", "renderer");

/** Where the Electron main process is, relative to the app root. */
const ENTRY = "platform/win32/main.js";

interface RootManifest {
	name: string;
	version: string;
	description?: string;
	author?: string;
	license?: string;
	dependencies?: Record<string, string>;
}

function die(msg: string): never {
	console.error(`error: ${msg}`);
	process.exit(1);
}

function run(cmd: string, args: string[]): number {
	const r = spawnSync(cmd, args, {
		stdio: "inherit",
		cwd: ROOT,
		shell: process.platform === "win32",
	});
	if (r.error) die(`${cmd}: ${r.error.message}`);
	return r.status ?? 1;
}

/**
 * The package.json that goes *inside* the packaged app.
 *
 * The build output is its own app root rather than the repository being
 * packaged wholesale, so it needs its own manifest. Deriving it from the root
 * one keeps a single source of truth for the version, and means the app is
 * identical in `win:dev` and in an installer — including `productName`, which
 * decides `app.getName()` and therefore where settings.json lives.
 *
 * The dependencies come across for electron-builder's benefit: it reads them
 * from here to decide what goes into app.asar, and resolves them against the
 * repository's node_modules because build-win32 has none of its own. Only
 * runtime dependencies are ever listed in the root manifest — everything that
 * merely builds the app is a devDependency — so the whole set can be copied.
 */
export function appManifest(root: RootManifest): Record<string, unknown> {
	return {
		name: root.name,
		productName: "Ubuntu Cats",
		version: root.version,
		description: root.description,
		author: root.author,
		license: root.license,
		// Electron resolves the entry point from here, and "module" is what makes
		// the emitted ES modules loadable. The nested build-win32/cjs/package.json
		// overrides it back to commonjs for the preload.
		main: ENTRY,
		type: "module",
		dependencies: root.dependencies ?? {},
	};
}

function readRootManifest(): RootManifest {
	return JSON.parse(
		readFileSync(join(ROOT, "package.json"), "utf8"),
	) as RootManifest;
}

// -- build ------------------------------------------------------------------

function build(): void {
	rmSync(OUT, { recursive: true, force: true });

	if (run("npx", ["tsc", "-p", "tsconfig.win32.json"]) !== 0)
		die("compiling the overlay failed");
	if (run("npx", ["tsc", "-p", "tsconfig.win32.preload.json"]) !== 0)
		die("compiling the preload failed");

	// The repository root declares "type": "module", which would make the
	// emitted preload an ES module and Electron refuse to load it in a
	// sandboxed renderer. This marks that one directory as CommonJS.
	writeFileSync(
		join(OUT, "cjs", "package.json"),
		`${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
	);

	writeFileSync(
		join(OUT, "package.json"),
		`${JSON.stringify(appManifest(readRootManifest()), null, 2)}\n`,
	);

	// tsc only emits JavaScript; the sprite frames and the two renderer
	// documents have to be carried across by hand.
	cpSync(join(SRC, "assets"), join(OUT, "assets"), { recursive: true });
	const documents = readdirSync(join(SRC, RENDERER)).filter(
		(f) => f.endsWith(".html") || f.endsWith(".css"),
	);
	if (!documents.length) die("no renderer documents found to copy");
	for (const file of documents)
		cpSync(join(SRC, RENDERER, file), join(OUT, RENDERER, file));

	const entry = join(OUT, ENTRY);
	if (!existsSync(entry)) die(`tsc did not emit ${entry}`);
	console.log(`build: ok -> build-win32/ (${documents.join(", ")} + assets/)`);
}

// -- the native addon -------------------------------------------------------

/** Where node-gyp leaves the compiled helper. */
const ADDON = join(NATIVE, "build", "Release", "win32_shell.node");

function native(arch?: string): void {
	if (process.platform !== "win32")
		die(
			"the taskbar helper only builds on Windows.\n" +
				"       Everything else does build here, and the overlay runs without it —\n" +
				"       the cats simply cannot see your taskbar icons.",
		);
	mkdirSync(NATIVE, { recursive: true });
	const args = ["node-gyp", "rebuild", "-C", NATIVE];
	// Cross-compiling needs the matching MSVC target installed; on a runner
	// without the ARM64 toolchain this is where it fails, loudly.
	if (arch) args.push(`--arch=${arch}`);
	if (run("npx", args) !== 0)
		die("node-gyp failed. A C++ toolchain is needed: see docs/windows.md");
	console.log(`native: ok -> ${ADDON}${arch ? ` (${arch})` : ""}`);
}

function nativeIfPossible(): void {
	if (process.platform !== "win32") {
		console.warn(
			"warning: skipping the taskbar helper — it only builds on Windows.",
		);
		return;
	}
	native();
}

// -- packaging --------------------------------------------------------------

/**
 * An installer and a portable zip, in dist/win32.
 *
 * The helper must already be built: shipping a package without it would
 * produce an app that silently ignores the taskbar, which is a reasonable
 * fallback for a missing toolchain but not something to hand to a user.
 */
function pack(arch: string): void {
	if (!existsSync(ADDON))
		die(
			`the taskbar helper is missing.\n` +
				`       Run \`npm run win:native\` first — a package without it would\n` +
				`       ship cats that cannot see any icons.\n` +
				`       Expected: ${ADDON}`,
		);
	build();
	if (
		run("npx", [
			"electron-builder",
			"--win",
			`--${arch}`,
			"--publish",
			"never",
		]) !== 0
	)
		die("electron-builder failed");
	console.log(`pack: ok -> dist/win32/ (${arch})`);
}

// -- dispatch ---------------------------------------------------------------

/** `--arch=arm64` anywhere in the arguments, defaulting to x64. */
function archArg(argv: string[]): string {
	const flag = argv.find((a) => a.startsWith("--arch="));
	return flag ? flag.slice("--arch=".length) : "x64";
}

function main(argv: string[]): void {
	const command = argv[2] ?? "help";

	switch (command) {
		case "build":
			build();
			break;
		case "native":
			// Whatever was asked for, or nothing at all. `--arch=x64` on an x64
			// host is a no-op, so there is no need to special-case it.
			native(
				argv.find((a) => a.startsWith("--arch="))?.slice("--arch=".length),
			);
			break;
		case "pack":
			pack(archArg(argv));
			break;
		case "dev": {
			nativeIfPossible();
			build();
			process.exit(run("npx", ["electron", join("build-win32", ENTRY)]));
			break;
		}
		case "clean":
			rmSync(OUT, { recursive: true, force: true });
			rmSync(join(NATIVE, "build"), { recursive: true, force: true });
			rmSync(join(ROOT, "dist", "win32"), { recursive: true, force: true });
			console.log("removed build-win32/, dist/win32/ and the native build");
			break;
		default:
			console.log(
				"usage: node tools/win32.ts <build|native|pack|dev|clean> [--arch=x64|arm64]",
			);
			process.exit(1);
	}
}

// Only when run directly, so tests can import the helpers above.
const invoked = process.argv[1];
if (invoked && fileURLToPath(import.meta.url) === resolve(invoked))
	main(process.argv);
