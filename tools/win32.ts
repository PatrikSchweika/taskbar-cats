#!/usr/bin/env node
/**
 * Build and run tasks for the Windows backend.
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
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "build-win32");
const NATIVE = join(ROOT, "native", "win32-shell");
const RENDERER = join("platform", "win32", "renderer");

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

	// tsc only emits JavaScript; the sprite frames and the two renderer
	// documents have to be carried across by hand.
	cpSync(join(SRC, "assets"), join(OUT, "assets"), { recursive: true });
	const documents = readdirSync(join(SRC, RENDERER)).filter(
		(f) => f.endsWith(".html") || f.endsWith(".css"),
	);
	if (!documents.length) die("no renderer documents found to copy");
	for (const file of documents)
		cpSync(join(SRC, RENDERER, file), join(OUT, RENDERER, file));

	const entry = join(OUT, "platform", "win32", "main.js");
	if (!existsSync(entry)) die(`tsc did not emit ${entry}`);
	console.log(`build: ok -> build-win32/ (${documents.join(", ")} + assets/)`);
}

// -- the native addon -------------------------------------------------------

function native(): void {
	if (process.platform !== "win32")
		die(
			"the taskbar helper only builds on Windows.\n" +
				"       Everything else does build here, and the overlay runs without it —\n" +
				"       the cats simply cannot see your taskbar icons.",
		);
	mkdirSync(NATIVE, { recursive: true });
	if (run("npx", ["node-gyp", "rebuild", "-C", NATIVE]) !== 0)
		die("node-gyp failed. A C++ toolchain is needed: see docs/windows.md");
	console.log(
		"native: ok -> native/win32-shell/build/Release/win32_shell.node",
	);
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

// -- dispatch ---------------------------------------------------------------

const command = process.argv[2] ?? "help";

switch (command) {
	case "build":
		build();
		break;
	case "native":
		native();
		break;
	case "dev": {
		nativeIfPossible();
		build();
		const entry = join("build-win32", "platform", "win32", "main.js");
		process.exit(run("npx", ["electron", entry]));
		break;
	}
	case "clean":
		rmSync(OUT, { recursive: true, force: true });
		rmSync(join(NATIVE, "build"), { recursive: true, force: true });
		console.log("removed build-win32/ and the native build directory");
		break;
	default:
		console.log("usage: node tools/win32.ts <build|native|dev|clean>");
		process.exit(1);
}
