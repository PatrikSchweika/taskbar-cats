/**
 * Makes GNOME Shell's module namespace resolvable under plain Node.
 *
 * The extension imports `gi://St`, `resource:///org/gnome/shell/...` and uses
 * GJS globals (`global`, `log`). None of that exists outside gnome-shell, so
 * these hooks redirect those specifiers at stubs and install the globals.
 * Registered in-thread via `module.registerHooks`, so it works with Node's
 * native TypeScript stripping and needs no build step.
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STUBS = join(HERE, "gnome", "stubs");

const RESOURCE_MAP: Record<string, string> = {
	"resource:///org/gnome/shell/ui/main.js": "shellMain.ts",
	"resource:///org/gnome/shell/extensions/extension.js": "shellExtension.ts",
	"resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js":
		"shellPrefs.ts",
};

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith("gi://")) {
			const ns = specifier.slice("gi://".length).split("?")[0];
			return {
				url: pathToFileURL(join(STUBS, `${ns}.ts`)).href,
				shortCircuit: true,
			};
		}
		const mapped = RESOURCE_MAP[specifier];
		if (mapped) {
			return {
				url: pathToFileURL(join(STUBS, mapped)).href,
				shortCircuit: true,
			};
		}
		// The extension's own imports use `.js` specifiers that TypeScript maps
		// back to `.ts` at build time. Node needs the same mapping to load the
		// sources directly.
		if (specifier.endsWith(".js") && specifier.startsWith(".")) {
			const parentDir = context.parentURL
				? dirname(fileURLToPath(context.parentURL))
				: HERE;
			const asTs = join(parentDir, specifier).replace(/\.js$/, ".ts");
			if (existsSync(asTs))
				return { url: pathToFileURL(asTs).href, shortCircuit: true };
		}
		return nextResolve(specifier, context);
	},
});

// -- GJS globals ------------------------------------------------------------
// gnome-shell puts these in the global scope; in Node we install them so the
// extension's `global.stage`, `log()` and `logError()` resolve.
import { FakeActor } from "./gnome/stubs/actor.ts";

const stage = new FakeActor({ name: "stage" });
stage.isStage = true;
stage.width = 1600;
stage.height = 900;

/** Published on globalThis so test helpers can reach it without importing. */
export interface TestEnv {
	pointer: { x: number; y: number };
	logged: string[];
	loggedErrors: string[];
}
const testEnv: TestEnv = {
	pointer: { x: 0, y: 0 },
	logged: [],
	loggedErrors: [],
};

Object.assign(globalThis, {
	stage,
	__catsTestEnv: testEnv,
	get_pointer: () => [testEnv.pointer.x, testEnv.pointer.y, 0],
	log: (msg: unknown) => {
		testEnv.logged.push(String(msg));
	},
	logError: (e: unknown, msg?: string) => {
		testEnv.loggedErrors.push(`${msg ?? ""}: ${e}`);
	},
});
