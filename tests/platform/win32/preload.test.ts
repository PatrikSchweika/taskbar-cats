import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

/**
 * The preload has to be self-contained, and only the emitted file can say so.
 *
 * It runs in a sandboxed renderer, where `require` resolves Electron's own
 * allowlist and nothing else: one relative `require` and the preload throws
 * before `contextBridge.exposeInMainWorld`, leaving both windows with no `cats`
 * global. The settings window reports that as "Could not load settings:
 * ReferenceError: cats is not defined"; the overlay just shows no cats at all.
 *
 * Nothing in the TypeScript source looks wrong when that happens — the import
 * is ordinary and typechecks — so this compiles the real preload project and
 * inspects what tsc actually emitted.
 */
describe("the emitted preload", () => {
	const out = mkdtempSync(join(tmpdir(), "taskbar-cats-preload-"));
	after(() => rmSync(out, { recursive: true, force: true }));

	const tsc = spawnSync(
		"npx",
		[
			"tsc",
			"-p",
			"tsconfig.win32.preload.json",
			"--outDir",
			out,
			"--noEmitOnError",
			"false",
		],
		{ cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" },
	);

	it("compiles", () => {
		assert.equal(tsc.status, 0, tsc.stdout || tsc.stderr);
	});

	it("requires nothing but electron", () => {
		const emitted = readFileSync(
			join(out, "platform", "win32", "preload.js"),
			"utf8",
		);
		const required = [
			...emitted.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g),
		].map((m) => m[1]);
		assert.deepEqual(
			required.filter((id) => id !== "electron"),
			[],
			`a sandboxed preload can only require electron, but the emitted preload requires: ${required.join(", ")}`,
		);
	});

	it("still names the channels rather than inventing its own", () => {
		const emitted = readFileSync(
			join(out, "platform", "win32", "preload.js"),
			"utf8",
		);
		// Inlined from CHANNELS in ipc.ts. If these drifted, main would be
		// listening on channels the preload never sends on.
		for (const channel of [
			"cats:layout",
			"cats:pointer",
			"cats:settings",
			"cats:ready",
			"cats:apply",
			"cats:describe",
			"cats:manifest",
		])
			assert.match(emitted, new RegExp(channel));
	});

	it("exposes the bridge the renderers expect", () => {
		const emitted = readFileSync(
			join(out, "platform", "win32", "preload.js"),
			"utf8",
		);
		assert.match(emitted, /exposeInMainWorld\(\s*["']cats["']/);
	});
});
