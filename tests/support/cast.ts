/**
 * The one place tests are allowed to lie to the type checker.
 *
 * The stubs stand in for GObject types at runtime, but they cannot *implement*
 * them: `Clutter.Actor` alone declares some 400 members. Rather than sprinkle
 * `as unknown as` around, every stub-for-GI substitution goes through these two
 * named helpers, so the boundary is greppable.
 */
import type Clutter from "gi://Clutter";
import type { FakeActor } from "./stubs/actor.ts";

/** Pass a stub where production code expects a real actor. */
export function asActor(fake: FakeActor): Clutter.Actor {
	return fake as unknown as Clutter.Actor;
}

/** Read a stub's test-only fields back off something typed as a real actor. */
export function asFake(actor: unknown): FakeActor {
	return actor as FakeActor;
}
