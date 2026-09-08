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

class LayoutManager extends Signalled {
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
