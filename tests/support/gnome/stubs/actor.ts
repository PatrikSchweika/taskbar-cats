/** A signal callback. */
export type SignalHandler = (...args: unknown[]) => void;

/** A Clutter.Actor stand-in: just enough tree, signals and geometry. */
export class FakeActor {
	name = "";
	style_class = "";
	visible = true;
	mapped = true;
	opacity = 255;
	reactive = false;
	rotation_angle_z = 0;
	pivot_point: { x: number; y: number } = { x: 0, y: 0 };
	scale_x = 1;
	x = 0;
	y = 0;
	width = 0;
	height = 0;
	icon_size = 0;
	destroyed = false;
	isStage = false;

	children: FakeActor[] = [];
	parent: FakeActor | null = null;

	/**
	 * The duck-typed fields the dock exposes and dockTracker reads. Declaring
	 * them here keeps the tests free of casts; none of them are Clutter API.
	 */
	_box?: FakeActor;
	child?: FakeActor;
	icon?: { icon?: FakeActor };
	app?: unknown;
	animatingOut?: boolean;

	/** What get_transformed_position/size report, in stage pixels. */
	transformed: [number, number, number, number] = [0, 0, 0, 0];
	/** What get_preferred_height reports; defaults to icon_size. */
	naturalHeight: number | null = null;

	private _handlers = new Map<number, { signal: string; cb: SignalHandler }>();
	private _nextId = 1;

	constructor(props: Record<string, unknown> = {}) {
		Object.assign(this, props);
	}

	get_children(): FakeActor[] {
		return this.children;
	}
	add_child(child: FakeActor): void {
		child.parent = this;
		this.children.push(child);
	}
	remove_child(child: FakeActor): void {
		this.children = this.children.filter((c) => c !== child);
		child.parent = null;
	}
	insert_child_at_index(child: FakeActor, index: number): void {
		child.parent = this;
		this.children.splice(index, 0, child);
	}
	set_child_above_sibling(child: FakeActor, _sibling: FakeActor | null): void {
		this.remove_child(child);
		this.add_child(child);
	}
	get_stage(): FakeActor | null {
		if (this.destroyed) return null;
		let node: FakeActor | null = this;
		while (node) {
			if (node.isStage) return node;
			node = node.parent;
		}
		return null;
	}
	get_transformed_position(): [number, number] {
		return [this.transformed[0], this.transformed[1]];
	}
	get_transformed_size(): [number, number] {
		return [this.transformed[2], this.transformed[3]];
	}
	get_preferred_height(_forWidth: number): [number, number] {
		const nat = this.naturalHeight ?? this.icon_size;
		return [nat, nat];
	}
	set_position(x: number, y: number): void {
		this.x = x;
		this.y = y;
	}
	set_size(w: number, h: number): void {
		this.width = w;
		this.height = h;
	}
	set_pivot_point(x: number, y: number): void {
		this.pivot_point = { x, y };
	}
	show(): void {
		this.visible = true;
	}
	hide(): void {
		this.visible = false;
	}
	connect(signal: string, cb: SignalHandler): number {
		const id = this._nextId++;
		this._handlers.set(id, { signal, cb });
		return id;
	}
	disconnect(id: number): void {
		if (!this._handlers.delete(id))
			throw new Error(`no handler ${id} to disconnect`);
	}
	/** How many handlers are still attached — a leak check for tests. */
	handlerCount(): number {
		return this._handlers.size;
	}
	emit(signal: string, ...args: unknown[]): void {
		for (const h of [...this._handlers.values()])
			if (h.signal === signal) h.cb(this, ...args);
	}
	destroy(): void {
		this.destroyed = true;
		this.emit("destroy");
		this.parent?.remove_child(this);
	}
}
