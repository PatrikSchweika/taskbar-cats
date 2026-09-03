#!/usr/bin/env node
/**
 * Generate pixel-art cat sprite frames as SVG.
 *
 * Cats are drawn parametrically onto a 32x32 character grid, then emitted as
 * run-length-merged SVG rects. Poses are data (see POSES); anatomy is code (see
 * the draw* functions), so tweaking the art means editing numbers, not 100+
 * hand-authored files.
 *
 * Output: src/assets/cats/<palette>/<anim>_<n>.svg
 * Run:    npm run sprites
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 32; // grid is SIZE x SIZE, viewBox is 0 0 SIZE SIZE
const BASELINE = 31; // y of the ground; the cat's feet rest here

/**
 * Grid cell -> semantic role. Palettes map these to hex colours.
 *   '.' transparent   'B' body fur      'D' dark fur/stripes/points
 *   'L' light fur     'K' outline       'E' eye      'P' pink (nose/ears/paws)
 *   'W' eye highlight
 */
export type Cell = "." | "B" | "D" | "L" | "K" | "E" | "P" | "W";
const TRANSPARENT: Cell = ".";

// -- numeric semantics -------------------------------------------------------
// This began life in Python, and the committed frames were produced by it.
// Two of its numeric conventions differ from JavaScript's and must be kept, or
// pixels shift by one and every frame churns.

/** Python's round(): half rounds to even, so round(2.5) is 2, not 3. */
export function pyRound(x: number): number {
	const floor = Math.floor(x);
	const frac = x - floor;
	if (frac > 0.5) return floor + 1;
	if (frac < 0.5) return floor;
	return floor % 2 === 0 ? floor : floor + 1;
}

/** Python's int(): truncates towards zero, unlike Math.floor. */
export function pyInt(x: number): number {
	return Math.trunc(x);
}

const radians = (deg: number): number => (deg * Math.PI) / 180;

// -- canvas ------------------------------------------------------------------

type Point = [number, number];

export class Canvas {
	readonly size: number;
	readonly g: Cell[][];

	constructor(size = SIZE) {
		this.size = size;
		this.g = Array.from({ length: size }, () =>
			Array.from({ length: size }, () => TRANSPARENT),
		);
	}

	put(x: number, y: number, ch: Cell): void {
		const px = pyRound(x);
		const py = pyRound(y);
		if (px >= 0 && px < this.size && py >= 0 && py < this.size)
			(this.g[py] as Cell[])[px] = ch;
	}

	get(x: number, y: number): Cell {
		const px = pyRound(x);
		const py = pyRound(y);
		if (px >= 0 && px < this.size && py >= 0 && py < this.size)
			return (this.g[py] as Cell[])[px] as Cell;
		return TRANSPARENT;
	}

	/** Filled ellipse. `onlyOver` restricts painting to existing cells. */
	ellipse(
		cx: number,
		cy: number,
		rx: number,
		ry: number,
		ch: Cell,
		onlyOver?: Cell[],
	): void {
		for (let y = pyInt(cy - ry) - 1; y < pyInt(cy + ry) + 2; y++) {
			for (let x = pyInt(cx - rx) - 1; x < pyInt(cx + rx) + 2; x++) {
				const dx = (x - cx) / Math.max(rx, 0.001);
				const dy = (y - cy) / Math.max(ry, 0.001);
				if (dx * dx + dy * dy <= 1.0)
					if (!onlyOver || onlyOver.includes(this.get(x, y)))
						this.put(x, y, ch);
			}
		}
	}

	rect(
		x0: number,
		y0: number,
		w: number,
		h: number,
		ch: Cell,
		onlyOver?: Cell[],
	): void {
		for (let y = pyRound(y0); y < pyRound(y0 + h); y++)
			for (let x = pyRound(x0); x < pyRound(x0 + w); x++)
				if (!onlyOver || onlyOver.includes(this.get(x, y))) this.put(x, y, ch);
	}

	/** Line drawn with a square brush of width w. */
	thickLine(
		x0: number,
		y0: number,
		x1: number,
		y1: number,
		ch: Cell,
		w = 2,
	): void {
		const steps = pyInt(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2) + 1;
		for (let i = 0; i <= steps; i++) {
			const t = i / steps;
			const x = x0 + (x1 - x0) * t;
			const y = y0 + (y1 - y0) * t;
			const half = (w - 1) / 2.0;
			for (let oy = 0; oy < w; oy++)
				for (let ox = 0; ox < w; ox++)
					this.put(x - half + ox, y - half + oy, ch);
		}
	}

	triangle(p0: Point, p1: Point, p2: Point, ch: Cell): void {
		const xs = [p0[0], p1[0], p2[0]];
		const ys = [p0[1], p1[1], p2[1]];
		for (let y = pyInt(Math.min(...ys)); y <= pyInt(Math.max(...ys)); y++)
			for (let x = pyInt(Math.min(...xs)); x <= pyInt(Math.max(...xs)); x++)
				if (inTriangle(x, y, p0, p1, p2)) this.put(x, y, ch);
	}

	/** Add a 1px outline around every opaque cell. */
	outline(ch: Cell = "K"): void {
		const over: Cell[] = ["B", "D", "L", "P", "W"];
		const add: Point[] = [];
		for (let y = 0; y < this.size; y++) {
			for (let x = 0; x < this.size; x++) {
				if ((this.g[y] as Cell[])[x] !== TRANSPARENT) continue;
				for (const [dx, dy] of [
					[1, 0],
					[-1, 0],
					[0, 1],
					[0, -1],
				] as Point[]) {
					if (over.includes(this.get(x + dx, y + dy))) {
						add.push([x, y]);
						break;
					}
				}
			}
		}
		for (const [x, y] of add) this.put(x, y, ch);
	}
}

function sign(
	ax: number,
	ay: number,
	bx: number,
	by: number,
	cx: number,
	cy: number,
): number {
	return (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
}

function inTriangle(
	x: number,
	y: number,
	p0: Point,
	p1: Point,
	p2: Point,
): boolean {
	const d1 = sign(x, y, p0[0], p0[1], p1[0], p1[1]);
	const d2 = sign(x, y, p1[0], p1[1], p2[0], p2[1]);
	const d3 = sign(x, y, p2[0], p2[1], p0[0], p0[1]);
	const neg = d1 < 0 || d2 < 0 || d3 < 0;
	const pos = d1 > 0 || d2 > 0 || d3 > 0;
	return !(neg && pos);
}

// -- palettes ----------------------------------------------------------------
// `points` draws extremities (ears/muzzle/legs/tail) in D, siamese-style.
// `patches` paints fixed calico-style blotches over the body.

export interface Palette {
	B: string;
	D: string;
	L: string;
	K: string;
	E: string;
	P: string;
	W: string;
	stripes?: boolean;
	points?: boolean;
	patches?: boolean;
}

export const PALETTES: Record<string, Palette> = {
	"tabby-orange": {
		B: "#e8913c",
		D: "#c26a1e",
		L: "#ffe0b5",
		K: "#6b3d13",
		E: "#3f7a44",
		P: "#f2939f",
		W: "#ffffff",
		stripes: true,
	},
	"grey-tabby": {
		B: "#98a0ab",
		D: "#6f7883",
		L: "#d6dce3",
		K: "#414952",
		E: "#5aa06a",
		P: "#e79dab",
		W: "#ffffff",
		stripes: true,
	},
	black: {
		B: "#3c3c46",
		D: "#292930",
		L: "#57576a",
		K: "#15151a",
		E: "#e2bd3f",
		P: "#c97f8d",
		W: "#ffffff",
	},
	white: {
		B: "#f4f2ee",
		D: "#dedad2",
		L: "#ffffff",
		K: "#9c958a",
		E: "#4d84bb",
		P: "#f2a3b2",
		W: "#ffffff",
	},
	siamese: {
		B: "#e6d8c0",
		D: "#5b4335",
		L: "#f7efe0",
		K: "#43301f",
		E: "#4fb0d6",
		P: "#dba0aa",
		W: "#ffffff",
		points: true,
	},
	calico: {
		B: "#f7f1e6",
		D: "#e07f31",
		L: "#ffffff",
		K: "#5b4a3c",
		E: "#6ea24f",
		P: "#f397a5",
		W: "#ffffff",
		patches: true,
	},
};

/** Paint order, back to front. */
export const ORDER: Cell[] = ["K", "D", "B", "L", "P", "E", "W"];

// -- anatomy -----------------------------------------------------------------

type Eye = "open" | "closed" | "half";

export interface Pose {
	phase?: number;
	swing?: number;
	crouch?: number;
	bob?: number;
	bodyDx?: number;
	tailAngle?: number;
	tailCurl?: number;
	tailLen?: number;
	headDx?: number;
	headDy?: number;
	lookUp?: number;
	eye?: Eye;
	earPerk?: number;
	reach?: number;
	breathe?: number;
}

/** Base colour for a part; siamese points use D on extremities. */
function fur(pal: Palette, extremity = false): Cell {
	return extremity && pal.points ? "D" : "B";
}

interface HeadOptions {
	r?: number;
	lookUp?: number;
	eye?: Eye;
	earPerk?: number;
}

/** Head centred at (hx, hy), facing right. */
function drawHead(
	c: Canvas,
	pal: Palette,
	hx: number,
	hy: number,
	{ r = 5.4, lookUp = 0.0, eye = "open", earPerk = 0.0 }: HeadOptions = {},
): void {
	const ec = fur(pal, true);

	// Ears: triangles rooted on the skull, tips leaning back when not perked.
	const lean = 1.4 * (1.0 - earPerk);
	for (const [baseX, tipDx] of [
		[hx - 3.4, -1.0],
		[hx + 2.2, 1.0],
	] as Point[]) {
		const tip: Point = [
			baseX + tipDx * 0.6 - lean * 0.6,
			hy - r - 3.4 + lean * 0.8,
		];
		c.triangle(
			[baseX - 1.4, hy - r + 1.2],
			[baseX + 2.0, hy - r + 0.4],
			tip,
			ec,
		);
		// inner ear
		c.triangle(
			[baseX - 0.2, hy - r + 0.6],
			[baseX + 1.2, hy - r + 0.2],
			[tip[0] + tipDx * 0.2, tip[1] + 1.6],
			"P",
		);
	}

	c.ellipse(hx, hy, r, r * 0.92, fur(pal));
	// muzzle / cheek
	c.ellipse(
		hx + r * 0.55,
		hy + r * 0.42,
		r * 0.52,
		r * 0.4,
		pal.points ? "D" : "L",
	);

	if (pal.stripes)
		for (let i = 0; i < 3; i++)
			c.rect(hx - 2.5 + i * 2, hy - r * 0.95, 1, 2.4, "D", ["B"]);

	// Eye. Sits forward on the skull; rides up a little when looking up.
	const ey = hy - 0.6 - lookUp * 1.4;
	const ex = hx + 1.7;
	if (eye === "closed") {
		c.rect(ex - 1.2, ey, 3, 1, "K");
	} else {
		const h = eye === "open" ? 2 : 1;
		c.rect(ex - 1, ey - h / 2.0, 2, h + 1, "E");
		c.put(ex + 0.5, ey - h / 2.0, "W");
	}

	// Nose + mouth
	c.put(hx + r * 0.92, hy + r * 0.3, "P");
	c.put(hx + r * 0.92, hy + r * 0.3 + 1, "K");
}

/**
 * Tail as a quadratic bezier rooted at (x, y) and extending outward.
 *
 * angle in degrees: 180 = straight back, 90 = straight up. `curl` bends the
 * tip perpendicular to that direction.
 */
function drawTail(
	c: Canvas,
	pal: Palette,
	x: number,
	y: number,
	angle: number,
	curl = 1.0,
	length = 9,
): void {
	const tc = fur(pal, true);
	const a = radians(angle);
	const dx = Math.cos(a);
	const dy = -Math.sin(a);
	const tipx = x + dx * length;
	const tipy = y + dy * length;
	// control point pushed perpendicular to the tail's axis
	const mx = x + dx * length * 0.5;
	const my = y + dy * length * 0.5;
	const ctrlx = mx + -dy * curl * 4.0;
	const ctrly = my + dx * curl * 4.0;

	const at = (t: number): Point => {
		const u = 1 - t;
		return [
			u * u * x + 2 * u * t * ctrlx + t * t * tipx,
			u * u * y + 2 * u * t * ctrly + t * t * tipy,
		];
	};

	let prev: Point | null = null;
	const steps = 14;
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		const [px, py] = at(t);
		// taper: thick at the root, thinner at the tip
		if (prev) c.thickLine(prev[0], prev[1], px, py, tc, t < 0.65 ? 3 : 2);
		prev = [px, py];
	}

	if (pal.stripes)
		for (const t of [0.45, 0.72, 0.95]) {
			const [px, py] = at(t);
			c.thickLine(px, py, px, py, "D", 2);
		}
}

/** One leg from `top` down to `bottom`, optionally lifted and swung. */
function drawLeg(
	c: Canvas,
	pal: Palette,
	x: number,
	top: number,
	bottom: number,
	lift = 0.0,
	forward = 0.0,
): void {
	const lc = fur(pal, true);
	const bx = x + forward;
	const by = bottom - lift;
	c.thickLine(x, top, bx, by, lc, 3);
	c.rect(bx - 1.5, by - 1, 4, 2, pal.points ? "D" : "L"); // paw
}

function applyBodyPattern(
	c: Canvas,
	pal: Palette,
	cx: number,
	cy: number,
	rx: number,
	ry: number,
): void {
	if (pal.stripes)
		for (let i = 0; i < 4; i++) {
			const sx = cx - rx * 0.6 + i * (rx * 0.42);
			c.ellipse(sx, cy - ry * 0.25, 1.0, ry * 0.75, "D", ["B"]);
		}
	if (pal.patches) {
		c.ellipse(cx - rx * 0.45, cy - ry * 0.3, rx * 0.42, ry * 0.62, "D", ["B"]);
		c.ellipse(cx + rx * 0.4, cy + ry * 0.1, rx * 0.3, ry * 0.45, "K", [
			"B",
			"L",
		]);
	}
}

// -- body plans --------------------------------------------------------------

/** Standing / walking / running: horizontal body on four legs. */
function drawQuadruped(c: Canvas, pal: Palette, p: Pose): void {
	const crouch = p.crouch ?? 0.0;
	const bob = p.bob ?? 0.0;

	const cx = 13.8 + (p.bodyDx ?? 0.0);
	const cy = 21.0 + crouch * 2.0 + bob;
	const rx = 7.6;
	const ry = 5.0 - crouch * 0.6;
	const bodyBottom = cy + ry * 0.8;
	const ph = p.phase ?? 0.0;
	const swing = p.swing ?? 0.0;

	drawTail(
		c,
		pal,
		cx - rx + 0.5,
		cy - 1.5,
		p.tailAngle ?? 118,
		p.tailCurl ?? 1.0,
		p.tailLen ?? 8,
	);

	// Back legs first (far side), then front, so the near pair overlaps.
	for (const [lx, off] of [
		[7.0, 0.0],
		[9.5, 0.5],
		[18.0, 0.25],
		[20.5, 0.75],
	] as Point[]) {
		const a = (ph + off) * 2 * Math.PI;
		const lift = Math.max(0.0, Math.sin(a)) * swing;
		const fwd = Math.cos(a) * swing * 0.9;
		drawLeg(c, pal, lx, bodyBottom - 1, BASELINE, lift, fwd);
	}

	c.ellipse(cx, cy, rx, ry, fur(pal));
	c.ellipse(cx + 1, cy + ry * 0.55, rx * 0.7, ry * 0.45, "L");
	applyBodyPattern(c, pal, cx, cy, rx, ry);

	drawHead(
		c,
		pal,
		cx + rx + 1.5 + (p.headDx ?? 0.0),
		cy - 4.0 + crouch * 1.5 + (p.headDy ?? 0.0),
		{
			lookUp: p.lookUp ?? 0.0,
			eye: p.eye ?? "open",
			earPerk: p.earPerk ?? 0.4,
		},
	);
}

/** Haunches down, front legs straight, tail curled up behind. */
function drawSitting(c: Canvas, pal: Palette, p: Pose): void {
	const cx = 14.0;
	const cy = 24.0;
	const rx = 7.0;
	const ry = 6.2;

	// Haunch, then chest rising to the shoulders
	c.ellipse(cx - 2.5, cy + 1.0, 5.4, 5.0, fur(pal));
	c.ellipse(cx + 2.0, cy - 1.0, rx * 0.8, ry, fur(pal));
	c.ellipse(cx + 4.0, cy + 1.5, 3.4, 4.4, "L");
	applyBodyPattern(c, pal, cx, cy, rx, ry);

	// Tail drawn AFTER the haunch, or the haunch buries it.
	drawTail(
		c,
		pal,
		cx - rx + 1,
		BASELINE - 4,
		p.tailAngle ?? 138,
		p.tailCurl ?? 1.2,
		p.tailLen ?? 8,
	);

	// Front legs straight down to the floor
	for (const lx of [17.5, 20.0]) drawLeg(c, pal, lx, cy + 0.5, BASELINE);

	drawHead(c, pal, cx + 7.0 + (p.headDx ?? 0.0), cy - 8.0 + (p.headDy ?? 0.0), {
		lookUp: p.lookUp ?? 0.0,
		eye: p.eye ?? "open",
		earPerk: p.earPerk ?? 0.8,
	});
}

/**
 * Reared onto the hind legs, both front paws clawing forward and up.
 *
 * The head sits high and to the LEFT of the strike zone so the forelegs read
 * as limbs rather than merging into the muzzle.
 */
function drawScratching(c: Canvas, pal: Palette, p: Pose): void {
	const reach = p.reach ?? 0.0; // 0 = wound up, 1 = fully extended
	const hx = 10.5;
	const hy = 24.5;

	drawTail(c, pal, hx - 2.5, hy + 2.0, 118 + reach * 12, 1.1, 7);

	// Hind legs planted on the ground
	for (const lx of [8.5, 11.5]) drawLeg(c, pal, lx, hy + 2.0, BASELINE);

	// Rump -> waist -> chest, leaning forward. Three ellipses of shrinking
	// radius give an arched back instead of one rectangular slab.
	c.ellipse(hx, hy + 1.5, 5.6, 4.8, fur(pal));
	c.ellipse(hx + 1.8, hy - 3.5, 4.4, 4.8, fur(pal));
	c.ellipse(hx + 3.4, hy - 8.0, 3.8, 4.0, fur(pal));
	c.ellipse(hx + 4.6, hy - 5.0, 2.4, 4.2, "L");
	applyBodyPattern(c, pal, hx + 1.0, hy - 2.0, 5.2, 6.5);

	drawHead(c, pal, hx + 2.5 + (p.headDx ?? 0.0), hy - 13.0, {
		lookUp: 0.25,
		eye: p.eye ?? "open",
		earPerk: 0.3,
	});

	// Forelegs LAST so they sit above the torso. They reach out to the RIGHT
	// and BELOW the head, into the strike zone.
	const pawc: Cell = pal.points ? "D" : "L";
	const sx = hx + 5.0;
	const sy = hy - 8.0;
	for (const dy of [0.0, 3.5]) {
		const px = sx + 5.0 + reach * 4.5;
		const py = sy + dy - reach * 1.5;
		c.thickLine(sx, sy + dy, px, py, fur(pal, true), 3);
		c.rect(px - 1, py - 1.5, 3, 3, pawc);
		if (reach > 0.4)
			for (let i = 0; i < 3; i++) c.put(px + 2, py - 2.0 + i * 1.5, "W");
	}
}

/** Curled into a loaf, tail wrapped round the front. */
function drawSleeping(c: Canvas, pal: Palette, p: Pose): void {
	const breathe = p.breathe ?? 0.0;
	const cx = 15.0;
	const cy = 25.0 - breathe;
	const rx = 9.5;
	const ry = 5.4 + breathe;

	drawTail(c, pal, cx + rx - 2, cy + ry - 2, 340, 1.5, 11);

	c.ellipse(cx, cy, rx, ry, fur(pal));
	c.ellipse(cx, cy + ry * 0.5, rx * 0.85, ry * 0.5, "L");
	applyBodyPattern(c, pal, cx, cy, rx, ry);

	// Head tucked down against the body
	drawHead(c, pal, cx + 6.0, cy - 1.5, { r: 4.6, eye: "closed", earPerk: 0.0 });

	// zzz
	const zs: Point[] = [
		[24, 9],
		[27, 5],
	];
	zs.forEach(([zx, zy], i) => {
		if (breathe > 0 || i === 0) {
			c.rect(zx, zy, 3, 1, "W");
			c.rect(zx, zy + 2, 3, 1, "W");
			c.put(zx + 2, zy + 1, "W");
			c.put(zx + 1, zy + 1, "W");
		}
	});
}

// -- poses: animation name -> frames -----------------------------------------

export type PlanName = "quad" | "sit" | "scratch" | "sleep";

const PLANS: Record<PlanName, (c: Canvas, pal: Palette, p: Pose) => void> = {
	quad: drawQuadruped,
	sit: drawSitting,
	scratch: drawScratching,
	sleep: drawSleeping,
};

export const POSES: Record<string, [PlanName, Pose[]]> = {
	idle: [
		"quad",
		[
			{ phase: 0.0, swing: 0.0, tailAngle: 108, tailCurl: 1.0, earPerk: 0.5 },
			{
				phase: 0.0,
				swing: 0.0,
				tailAngle: 96,
				tailCurl: 1.2,
				bob: 1,
				earPerk: 0.5,
			},
		],
	],
	walk: [
		"quad",
		[0, 1, 2, 3].map((p) => ({
			phase: p / 4.0,
			swing: 2.0,
			tailAngle: 104 + (p % 2) * 10,
			tailCurl: 1.0,
			bob: (p % 2) * 0.6,
			earPerk: 0.5,
		})),
	],
	// Running: body shifted right so the streaming tail still fits the frame.
	run: [
		"quad",
		[0, 1, 2, 3].map((p) => ({
			phase: p / 4.0,
			swing: 3.4,
			crouch: 1.0,
			tailAngle: 128,
			tailCurl: 0.5,
			tailLen: 6,
			bob: p % 2 ? 1 : 0,
			earPerk: 0.15,
		})),
	],
	sit: [
		"sit",
		[
			{ tailAngle: 124, tailCurl: 1.2, earPerk: 0.8 },
			{ tailAngle: 116, tailCurl: 1.4, earPerk: 0.8, headDy: 0.6 },
		],
	],
	alert: [
		"sit",
		[
			{
				tailAngle: 128,
				tailCurl: 0.9,
				earPerk: 1.0,
				lookUp: 1.0,
				headDy: -1.2,
				headDx: 0.6,
			},
		],
	],
	scratch: [
		"scratch",
		[{ reach: 0.0 }, { reach: 0.55 }, { reach: 1.0 }, { reach: 0.4 }],
	],
	sleep: ["sleep", [{ breathe: 0.0 }, { breathe: 1.0 }]],
};

// -- SVG emission ------------------------------------------------------------

/** Run-length merge each row into <rect> elements, grouped by colour. */
function toSvg(c: Canvas, pal: Palette): string {
	const runs = new Map<Cell, [number, number, number][]>();
	for (let y = 0; y < c.size; y++) {
		let x = 0;
		while (x < c.size) {
			const ch = (c.g[y] as Cell[])[x] as Cell;
			if (ch === TRANSPARENT) {
				x += 1;
				continue;
			}
			let w = 1;
			while (x + w < c.size && (c.g[y] as Cell[])[x + w] === ch) w += 1;
			const list = runs.get(ch) ?? [];
			list.push([x, y, w]);
			runs.set(ch, list);
			x += w;
		}
	}

	const out = [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${c.size} ${c.size}" ` +
			`width="${c.size}" height="${c.size}" shape-rendering="crispEdges">`,
	];
	for (const ch of ORDER) {
		const cells = runs.get(ch);
		const colour = pal[ch as keyof Palette];
		if (!cells || typeof colour !== "string") continue;
		out.push(`<g fill="${colour}">`);
		for (const [x, y, w] of cells)
			out.push(`<rect x="${x}" y="${y}" width="${w}" height="1"/>`);
		out.push("</g>");
	}
	out.push("</svg>");
	return `${out.join("\n")}\n`;
}

export function buildFrame(pal: Palette, plan: PlanName, params: Pose): Canvas {
	const c = new Canvas();
	PLANS[plan](c, pal, params);
	c.outline("K");
	return c;
}

/**
 * Art must not touch the left/right/top border. The bottom row is where the
 * feet legitimately sit, so it is exempt.
 */
function checkFrame(c: Canvas, label: string): void {
	const bad: string[] = [];
	const col = (x: number) =>
		c.g.some((row) => (row as Cell[])[x] !== TRANSPARENT);
	if (col(0)) bad.push("left");
	if (col(c.size - 1)) bad.push("right");
	if ((c.g[0] as Cell[]).some((cell) => cell !== TRANSPARENT)) bad.push("top");
	if (bad.length) {
		console.error(`${label}: art clipped at ${bad.join("+")} edge(s)`);
		process.exit(1);
	}
}

function main(): void {
	const here = dirname(dirname(fileURLToPath(import.meta.url)));
	const root = join(here, "src", "assets", "cats");
	rmSync(root, { recursive: true, force: true });

	let total = 0;
	for (const [name, pal] of Object.entries(PALETTES)) {
		const dir = join(root, name);
		mkdirSync(dir, { recursive: true });
		for (const [anim, [plan, frames]] of Object.entries(POSES)) {
			frames.forEach((params, i) => {
				const c = buildFrame(pal, plan, params);
				checkFrame(c, `${name}/${anim}_${i}`);
				writeFileSync(join(dir, `${anim}_${i}.svg`), toSvg(c, pal));
				total += 1;
			});
		}
	}
	const palettes = Object.keys(PALETTES).length;
	console.log(`wrote ${total} frames for ${palettes} palettes into ${root}`);

	// A manifest the extension reads so it never has to guess frame counts.
	const names = Object.keys(PALETTES).sort();
	const anims = Object.entries(POSES).sort(([a], [b]) => (a < b ? -1 : 1));
	const manifest =
		"{\n" +
		`  "palettes": [${names.map((p) => `"${p}"`).join(", ")}],\n` +
		'  "animations": {\n' +
		`${anims.map(([a, [, fr]]) => `    "${a}": ${fr.length}`).join(",\n")}` +
		"\n  }\n}\n";
	const manifestPath = join(root, "manifest.json");
	writeFileSync(manifestPath, manifest);
	console.log(`wrote ${manifestPath}`);
}

// Only when run directly, so tests can import the helpers above.
const invoked = process.argv[1];
if (invoked && fileURLToPath(import.meta.url) === resolve(invoked)) main();
