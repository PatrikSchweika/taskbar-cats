/**
 * How tall the overlay strip is. Kept free of Electron and DOM imports so the
 * main process can use it and tests can run it under plain Node.
 */
import { CAT_SIZE_MAX } from "../../core/config.js";

/** Head-room above the cats so a tall sprite is never clipped. */
export const STRIP_SLACK = 24;
/** Room above the tallest cat for its name tag. */
export const NAME_TAG_ROOM = 24;

/** The strip's height: the taskbar, the tallest cat, and room for a tag. */
export function stripHeight(taskbarH: number, monitorH: number): number {
	return Math.min(
		monitorH,
		Math.round(taskbarH + CAT_SIZE_MAX + STRIP_SLACK + NAME_TAG_ROOM),
	);
}
