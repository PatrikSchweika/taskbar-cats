import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Cat } from "../../src/core/cat.ts";
import {
	type GameKind,
	PLAY_REST,
	Playground,
	TAG_PAUSE,
} from "../../src/core/social.ts";
import {
	FakeCatView,
	fakeSprites,
	makeContext,
	makeMouse,
	run,
	withRandom,
} from "../support/core/harness.ts";

const DT = 1 / 30;

function makeCat(x: number, index = 0): Cat {
	return new Cat({
		view: new FakeCatView(),
		sprites: fakeSprites(),
		palette: "tabby-orange",
		size: 48,
		x,
		index,
	});
}

/**
 * Cats that have had a few ticks, so `free` says what it means. 0.9 gives
 * each a long first wander timer, so none is already on the move.
 */
function settledCats(...xs: number[]): Cat[] {
	return withRandom([0.9], () => {
		const cats = xs.map((x, i) => makeCat(x, i));
		run(cats, makeContext({ neighbours: cats }), 0.1);
		return cats;
	});
}

/** Update the playground alone for `seconds`, the cats standing still. */
function tick(pg: Playground, cats: Cat[], seconds: number, enabled = true) {
	for (let t = 0; t < seconds; t += DT) pg.update(DT, cats, enabled);
}

/** Start a game of `kind` between the first two cats (a leads). */
function startGame(pg: Playground, cats: Cat[], kind: GameKind = "chase") {
	const roll = { chase: 0, tussle: 0.5, groom: 0.9 }[kind];
	withRandom([0, 0, 0, roll, 0], () => pg.update(DT, cats, true));
	assert.equal(pg.games.length, 1, "a game started");
	return pg.games[0];
}

describe("Playground", () => {
	it("starts no game when play is off", () => {
		const cats = settledCats(400, 500);
		const pg = new Playground();
		withRandom([0], () => pg.update(DT, cats, false));
		assert.equal(pg.games.length, 0);
		assert.equal(cats[0].play, null);
	});

	it("pairs two free cats within four sizes", () => {
		const [a, b] = settledCats(400, 500);
		const pg = new Playground();
		withRandom([0, 0, 0, 0, 0.5], () => pg.update(DT, [a, b], true));
		assert.equal(pg.games.length, 1);
		const game = pg.games[0];
		assert.equal(game.kind, "chase");
		assert.equal(game.left, 5.5);
		assert.deepEqual(a.play, { kind: "chase", partner: b, lead: true });
		assert.deepEqual(b.play, { kind: "chase", partner: a, lead: false });
	});

	it("never pairs cats more than four sizes apart", () => {
		const cats = settledCats(400, 700);
		const pg = new Playground();
		withRandom([0], () => tick(pg, cats, 1));
		assert.equal(pg.games.length, 0);
	});

	it("picks tussle and groom by the odds", () => {
		const kindFor = (roll: number): string => {
			const cats = settledCats(400, 500);
			const pg = new Playground();
			withRandom([0, 0, 0, roll, 0], () => pg.update(DT, cats, true));
			return pg.games[0]?.kind;
		};
		assert.equal(kindFor(0.39), "chase");
		assert.equal(kindFor(0.5), "tussle");
		assert.equal(kindFor(0.9), "groom");
	});

	it("gives each kind a duration within its range", () => {
		const cats = settledCats(400, 500);
		const pg = new Playground();
		withRandom([0, 0, 0, 0.5, 1], () => pg.update(DT, cats, true));
		assert.equal(pg.games[0].kind, "tussle");
		assert.equal(pg.games[0].left, 4);
	});

	it("a lone cat never plays", () => {
		const cats = settledCats(400);
		const pg = new Playground();
		assert.doesNotThrow(() => withRandom([0], () => tick(pg, cats, 2)));
		assert.equal(pg.games.length, 0);
		assert.equal(cats[0].play, null);
	});

	it("never puts a cat in two games", () => {
		const cats = settledCats(
			...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => 600 + i * 20),
		);
		const ctx = makeContext({ neighbours: cats });
		const pg = new Playground();
		let most = 0;
		withRandom([0], () => {
			for (let t = 0; t < 5; t += DT) {
				pg.update(DT, cats, true);
				const seen = new Map<Cat, number>();
				for (const game of pg.games)
					for (const cat of [game.a, game.b])
						seen.set(cat, (seen.get(cat) ?? 0) + 1);
				for (const [cat, n] of seen) {
					assert.equal(n, 1, `cat ${cat.index} is in ${n} games`);
				}
				for (const game of pg.games) {
					assert.equal(game.a.play?.partner, game.b);
					assert.equal(game.b.play?.partner, game.a);
				}
				most = Math.max(most, pg.games.length);
				for (const cat of cats) cat.update(DT, ctx);
			}
		});
		assert.ok(most >= 2, `only ever ${most} games at once`);
	});

	it("ends the game when either cat is interrupted, and rests both for 15 s", () => {
		const cats = settledCats(400, 500);
		const [a, b] = cats;
		const pg = new Playground();
		startGame(pg, cats);

		b.update(DT, makeContext({ neighbours: cats, mouse: makeMouse(900) }));
		assert.equal(b.interrupted, true);
		pg.update(DT, cats, true);
		assert.equal(pg.games.length, 0);
		assert.equal(a.play, null);
		assert.equal(b.play, null);

		run(cats, makeContext({ neighbours: cats }), DT);
		assert.equal(a.free, true, "a is free again");
		assert.equal(b.free, true, "b is free again");

		withRandom([0, 0, 0, 0, 0], () => {
			tick(pg, cats, PLAY_REST - 0.1 - DT);
			assert.equal(pg.games.length, 0, "still resting");
			tick(pg, cats, 0.2);
		});
		assert.equal(pg.games.length, 1, "rested and playing again");
	});

	it("ends a game whose cat is gone", () => {
		const cats = settledCats(400, 500);
		const [a, b] = cats;
		const pg = new Playground();
		startGame(pg, cats);
		assert.doesNotThrow(() => pg.update(DT, [a], true));
		assert.equal(pg.games.length, 0);
		assert.equal(a.play, null);
		assert.equal(b.play, null);
	});

	it("swaps chase roles on a tag, at most once a second", () => {
		const cats = settledCats(400, 500);
		const [a, b] = cats;
		const pg = new Playground();
		startGame(pg, cats);
		assert.equal(a.play?.lead, true);

		b.x = a.x + 10;
		pg.update(DT, cats, true);
		assert.equal(a.play?.lead, false, "tagged: a now flees");
		assert.equal(b.play?.lead, true, "tagged: b now chases");

		tick(pg, cats, 0.5);
		assert.equal(b.play?.lead, true, "no second tag within the pause");

		tick(pg, cats, TAG_PAUSE - 0.5 + 2 * DT);
		assert.equal(a.play?.lead, true, "tagged back after the pause");
		assert.equal(b.play?.lead, false);
	});

	it("a chaser catches up and tags in open ground", () => {
		// Far from either edge, so a tag can only come from the chase itself.
		const cats = settledCats(760, 840);
		const [a, b] = cats;
		const pg = new Playground();
		startGame(pg, cats);
		const ctx = makeContext({ neighbours: cats });
		let tagged = false;
		for (let t = 0; t < 4 && !tagged; t += DT) {
			pg.update(DT, cats, true);
			if (b.play?.lead === true) tagged = true;
			for (const cat of cats) cat.update(DT, ctx);
			assert.ok(
				Math.min(a.x, b.x) > 200 && Math.max(a.x, b.x) < 1400,
				"reached an edge first",
			);
		}
		assert.ok(tagged, "the chaser never caught up");
	});

	it("ends every game when switched off", () => {
		const cats = settledCats(400, 500);
		const pg = new Playground();
		startGame(pg, cats, "tussle");
		pg.update(DT, cats, false);
		assert.equal(pg.games.length, 0);
		assert.equal(cats[0].play, null);
		assert.equal(cats[1].play, null);
	});

	it("ends a game when its time is up", () => {
		const cats = settledCats(400, 500);
		const pg = new Playground();
		const game = startGame(pg, cats, "groom");
		tick(pg, cats, game.left + 2 * DT);
		assert.equal(pg.games.length, 0);
		assert.equal(cats[0].play, null);
	});

	it("clear ends every game without a rest", () => {
		const cats = settledCats(400, 500);
		const pg = new Playground();
		startGame(pg, cats);
		pg.clear();
		assert.equal(pg.games.length, 0);
		assert.equal(cats[0].play, null);
		withRandom([0, 0, 0, 0, 0], () => pg.update(DT, cats, true));
		assert.equal(pg.games.length, 1, "no rest after a clear");
	});
});
