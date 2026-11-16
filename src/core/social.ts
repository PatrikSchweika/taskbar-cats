/**
 * Play between cats: who plays with whom, which game, and for how long.
 *
 * The cats themselves only read the role they were given ({@link Cat.play})
 * and steer by it. Pairing them up, running each game's clock, swapping roles
 * on a tag and resting them afterwards all live here, so no cat ever has to
 * agree anything with another.
 */
import type { Cat } from "./cat.js";

export type GameKind = "chase" | "tussle" | "groom";

/** What a cat in a game is told: the game, who with, and whether it leads. */
export interface PlayRole {
	kind: GameKind;
	partner: Cat;
	/**
	 * Chase: the one chasing. Groom: the one grooming. Tussle: no difference,
	 * both cats do the same.
	 */
	lead: boolean;
}

export interface Game {
	kind: GameKind;
	a: Cat;
	b: Cat;
	/** Seconds until the game is over. */
	left: number;
	/** Seconds until a tag counts again (chase only). */
	tagPause: number;
}

/** What one step of the play-frequency setting adds to the start rate. */
export const PLAY_RATE_STEP = 0.04;

/**
 * Chance per second that two free cats start a game, at play-frequency
 * `level` (1 to 10).
 */
export function playRate(level: number): number {
	return level * PLAY_RATE_STEP;
}

/**
 * The start rate at the default play frequency (5): about one game every five
 * seconds while a pair is ready. Most of the time no pair is (cats are busy,
 * resting or too far apart), so a colony plays every 20 s or so.
 */
export const PLAY_RATE = playRate(5);
/** How close two cats must be, in cat sizes, to start a game. */
export const PLAY_RANGE = 8;
/** Seconds a cat rests from play after a game ends. */
export const PLAY_REST = 8;
/** How close the chaser must get, in cat sizes, to tag the other cat. */
export const TAG_REACH = 0.4;
/** Seconds after a tag before the next one counts. */
export const TAG_PAUSE = 1;

export const GAME_ODDS: Record<GameKind, number> = {
	chase: 0.4,
	tussle: 0.35,
	groom: 0.25,
};

export const GAME_SECONDS: Record<GameKind, [number, number]> = {
	chase: [4, 7],
	tussle: [2.5, 4],
	groom: [4, 6],
};

const KINDS: readonly GameKind[] = ["chase", "tussle", "groom"];

/** Whether two cats are close enough to start a game. */
function inRange(a: Cat, b: Cat): boolean {
	return Math.abs(a.x - b.x) <= PLAY_RANGE * Math.max(a.size, b.size);
}

function pickKind(roll: number): GameKind {
	let sum = 0;
	for (const kind of KINDS) {
		sum += GAME_ODDS[kind];
		if (roll < sum) return kind;
	}
	return KINDS[KINDS.length - 1];
}

export class Playground {
	readonly games: Game[] = [];
	/** Seconds each cat still rests from play. */
	private readonly _rest = new Map<Cat, number>();

	/**
	 * One tick. Runs before the cats update, so it reads what each cat did on
	 * the last tick (`free`, `interrupted`) and the roles it hands out are
	 * steered by on this one.
	 *
	 * Math.random is consumed in a fixed order, which the tests rely on: the
	 * start roll, the first cat (among those with a partner in range), its
	 * partner, the kind, the duration.
	 */
	update(
		dt: number,
		cats: readonly Cat[],
		enabled: boolean,
		rate = PLAY_RATE,
	): void {
		// 1. End the games that are over.
		for (let i = this.games.length - 1; i >= 0; i--) {
			const game = this.games[i];
			const over =
				!enabled ||
				game.left <= 0 ||
				!cats.includes(game.a) ||
				!cats.includes(game.b) ||
				game.a.interrupted ||
				game.b.interrupted;
			if (!over) continue;
			this.games.splice(i, 1);
			this._end(game);
			this._rest.set(game.a, PLAY_REST);
			this._rest.set(game.b, PLAY_REST);
		}

		// 2. Chase tags: the chaser caught up, so now it runs away.
		for (const game of this.games) {
			if (game.kind !== "chase" || game.tagPause > 0) continue;
			const lead = game.a.play?.lead ? game.a : game.b;
			const other = lead === game.a ? game.b : game.a;
			if (Math.abs(lead.x - other.x) > TAG_REACH * lead.size) continue;
			if (game.a.play) game.a.play.lead = !game.a.play.lead;
			if (game.b.play) game.b.play.lead = !game.b.play.lead;
			game.tagPause = TAG_PAUSE;
		}

		// 3. Count down.
		for (const game of this.games) {
			game.left -= dt;
			game.tagPause = Math.max(0, game.tagPause - dt);
		}
		for (const [cat, left] of this._rest) {
			const now = left - dt;
			if (now <= 0 || !cats.includes(cat)) this._rest.delete(cat);
			else this._rest.set(cat, now);
		}

		// 4. Maybe start a game.
		if (!enabled || Math.random() >= rate * dt) return;
		const ready = cats.filter((cat) => cat.free && !this._rest.has(cat));
		const nearTo = (a: Cat) => ready.filter((b) => b !== a && inRange(a, b));
		// Only cats with someone to play with, so the roll is never wasted on
		// a cat off on its own while a pair elsewhere is ready.
		const firsts = ready.filter((cat) => nearTo(cat).length > 0);
		if (!firsts.length) return;
		const a = firsts[Math.floor(Math.random() * firsts.length)];
		const near = nearTo(a);
		const b = near[Math.floor(Math.random() * near.length)];
		const kind = pickKind(Math.random());
		const [min, max] = GAME_SECONDS[kind];
		const left = min + Math.random() * (max - min);
		a.play = { kind, partner: b, lead: true };
		b.play = { kind, partner: a, lead: false };
		this.games.push({ kind, a, b, left, tagPause: 0 });
	}

	/** End every game at once, without resting anyone. */
	clear(): void {
		for (const game of this.games) this._end(game);
		this.games.length = 0;
		this._rest.clear();
	}

	private _end(game: Game): void {
		if (game.a.play?.partner === game.b) game.a.play = null;
		if (game.b.play?.partner === game.a) game.b.play = null;
	}
}
