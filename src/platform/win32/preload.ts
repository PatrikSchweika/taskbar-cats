/**
 * The only bridge between the renderers and Node.
 *
 * Both windows run with context isolation on and node integration off, so this
 * exposes exactly the six messages in ipc.ts and nothing else.
 */
import { contextBridge, ipcRenderer } from "electron";

import type { Settings } from "../../core/config.js";
import {
	CHANNELS,
	type Layout,
	type SettingsDescription,
	type SpriteManifest,
} from "./ipc.js";

const api = {
	onLayout: (fn: (layout: Layout | null) => void): void => {
		ipcRenderer.on(CHANNELS.layout, (_event, layout: Layout | null) =>
			fn(layout),
		);
	},
	onPointer: (fn: (pointer: { x: number; y: number }) => void): void => {
		ipcRenderer.on(CHANNELS.pointer, (_event, pointer) => fn(pointer));
	},
	onSettings: (fn: (settings: Settings) => void): void => {
		ipcRenderer.on(CHANNELS.settings, (_event, settings: Settings) =>
			fn(settings),
		);
	},
	ready: (): void => {
		ipcRenderer.send(CHANNELS.ready);
	},
	apply: (patch: Partial<Settings>): void => {
		ipcRenderer.send(CHANNELS.apply, patch);
	},
	describe: (): Promise<SettingsDescription> =>
		ipcRenderer.invoke(CHANNELS.describe) as Promise<SettingsDescription>,
	manifest: (): Promise<SpriteManifest> =>
		ipcRenderer.invoke(CHANNELS.manifest) as Promise<SpriteManifest>,
};

export type CatsApi = typeof api;

contextBridge.exposeInMainWorld("cats", api);
