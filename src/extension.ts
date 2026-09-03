/**
 * GNOME Shell entry point.
 *
 * The shell loads `extension.js` from the extension's root and expects a
 * default-exported class, so this file exists to keep that contract while the
 * implementation lives with the rest of the GNOME backend.
 */
export { default } from "./platform/gnome/extension.js";
