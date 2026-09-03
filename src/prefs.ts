/**
 * GNOME Shell preferences entry point.
 *
 * The shell loads `prefs.js` from the extension's root; the implementation
 * lives with the rest of the GNOME backend.
 */
export { default } from "./platform/gnome/prefs.js";
