/**
 * The slice of GJS/GNOME Shell's global scope that `src/` relies on.
 *
 * `@girs/gnome-shell/extensions/global` declares `const global: Shell.Global`,
 * which collides with `@types/node`'s `var global: typeof globalThis` — and the
 * test program needs Node's types for `node:test`. Declaring these as `var` and
 * `function` instead puts them on `globalThis`, so `global.stage` resolves
 * through Node's declaration and both can coexist.
 */
import type Clutter from "gi://Clutter";

declare global {
	var stage: Clutter.Stage;
	function get_pointer(): [number, number, Clutter.ModifierType];
	function log(message: unknown): void;
	function logError(error: unknown, message?: string): void;
}
