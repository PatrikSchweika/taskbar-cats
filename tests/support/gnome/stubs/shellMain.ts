import { FakeActor, type SignalHandler } from "./actor.ts";

export interface FakeMonitor {
	x: number;
	y: number;
	width: number;
	height: number;
	inFullscreen: boolean;
}

class Signalled {
	private _handlers = new Map<number, { signal: string; cb: SignalHandler }>();
	private _nextId = 1;
	connect(signal: string, cb: SignalHandler): number {
		const id = this._nextId++;
		this._handlers.set(id, { signal, cb });
		return id;
	}
	disconnect(id: number): void {
		if (!this._handlers.delete(id)) throw new Error(`no handler ${id}`);
	}
	emit(signal: string): void {
		for (const h of [...this._handlers.values()])
			if (h.signal === signal) h.cb();
	}
	handlerCount(): number {
		return this._handlers.size;
	}
	clearHandlers(): void {
		this._handlers.clear();
		this._nextId = 1;
	}
}

/** The chrome parameters the extension may pass to `trackChrome`. */
export interface ChromeParams {
	affectsInputRegion?: boolean;
	affectsStruts?: boolean;
	trackFullscreen?: boolean;
}

class LayoutManager extends Signalled {
	/**
	 * Actors tracked as chrome, with the parameters they were tracked with.
	 * On X11 these are what the stage's input region covers.
	 */
	tracked = new Map<FakeActor, ChromeParams>();
	private _trackedDestroyIds = new Map<FakeActor, number>();
	uiGroup = new FakeActor({ name: "uiGroup" });
	overviewGroup = new FakeActor({ name: "overviewGroup" });
	primaryMonitor: FakeMonitor | null = {
		x: 0,
		y: 0,
		width: 1600,
		height: 900,
		inFullscreen: false,
	};
	monitorForActor: FakeMonitor | null = null;
	findMonitorForActor(_actor: FakeActor): FakeMonitor | null {
		return this.monitorForActor ?? this.primaryMonitor;
	}
	/**
	 * As in GNOME Shell's layout.js: tracking an actor twice throws, and a
	 * tracked actor is untracked by itself when it is destroyed.
	 */
	trackChrome(actor: FakeActor, params: ChromeParams = {}): void {
		if (this.tracked.has(actor))
			throw new Error("trying to re-track existing chrome actor");
		this.tracked.set(actor, { ...params });
		this._trackedDestroyIds.set(
			actor,
			actor.connect("destroy", () => this.untrackChrome(actor)),
		);
	}
	/** Untracking an actor that isn't tracked does nothing, as in GNOME. */
	untrackChrome(actor: FakeActor): void {
		const id = this._trackedDestroyIds.get(actor);
		if (id === undefined) return;
		this._trackedDestroyIds.delete(actor);
		this.tracked.delete(actor);
		actor.disconnect(id);
	}
	clearTracked(): void {
		this.tracked.clear();
		this._trackedDestroyIds.clear();
	}
}

class Overview extends Signalled {
	visible = false;
}

/** Main.wm, reduced to the keybinding registry the extension uses. */
class WindowManager {
	bindings = new Map<string, () => void>();
	addKeybinding(
		name: string,
		_settings: unknown,
		_flags: number,
		_modes: number,
		handler: () => void,
	): number {
		this.bindings.set(name, handler);
		return this.bindings.size;
	}
	removeKeybinding(name: string): void {
		this.bindings.delete(name);
	}
	/** Test control: press the shortcut bound under `name`. */
	__press(name: string): void {
		const handler = this.bindings.get(name);
		if (!handler) throw new Error(`no keybinding named ${name}`);
		handler();
	}
}

export const layoutManager = new LayoutManager();
export const overview = new Overview();
export const extensionManager = new Signalled();
export const wm = new WindowManager();
export const uiGroup = layoutManager.uiGroup;

/**
 * Reset between tests. The actors are reused rather than replaced, because
 * `uiGroup` is also exported directly and a fresh object would leave that
 * export pointing at the previous tree.
 */
export function __reset(): void {
	// These are singletons, so handlers left by one test would be counted by
	// the next.
	layoutManager.clearHandlers();
	overview.clearHandlers();
	extensionManager.clearHandlers();
	wm.bindings.clear();
	layoutManager.clearTracked();
	layoutManager.uiGroup.children = [];
	layoutManager.overviewGroup.children = [];
	layoutManager.uiGroup.add_child(layoutManager.overviewGroup);
	layoutManager.primaryMonitor = {
		x: 0,
		y: 0,
		width: 1600,
		height: 900,
		inFullscreen: false,
	};
	layoutManager.monitorForActor = null;
	overview.visible = false;
}
__reset();
