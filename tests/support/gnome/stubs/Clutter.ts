import { FakeActor } from "./actor.ts";

export class FixedLayout {}
export class Actor extends FakeActor {}

export const EVENT_STOP = true;
export const EVENT_PROPAGATE = false;
export const BUTTON_PRIMARY = 1;
export const ModifierType = { BUTTON1_MASK: 1 << 8 };

export default {
	FixedLayout,
	Actor,
	EVENT_STOP,
	EVENT_PROPAGATE,
	BUTTON_PRIMARY,
	ModifierType,
};
