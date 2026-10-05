import { create } from 'zustand';
import { api } from './api';
import { generatePackIcon, paletteFor } from './util';
import type { BuildLog, BuildProgress, BuildReport, Pack, Settings, Showcase } from '../shared/types';

export type View = { name: 'home' } | { name: 'pack'; id: string } | { name: 'settings' };

export interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  title: string;
  detail?: string;
}

interface BuildState {
  packId: string;
  running: boolean;
  progress: BuildProgress | null;
  logs: BuildLog[];
  report: BuildReport | null;
  stagesDone: string[];
}

interface State {
  ready: boolean;
  view: View;
  packs: Pack[];
  settings: Settings | null;
  toasts: Toast[];
  build: BuildState | null;
  newPackOpen: boolean;
  backdrop: string | null;
  showcase: Showcase[];
  setBackdrop(src: string | null): void;
  loadShowcase(): Promise<Showcase[]>;
  init(): Promise<void>;
  go(v: View): void;
  setNewPackOpen(v: boolean): void;
  savePack(p: Pack): Promise<Pack>;
  updatePack(id: string, fn: (p: Pack) => Pack): Promise<void>;
  removePack(id: string): Promise<void>;
  refreshPacks(): Promise<void>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  toast(t: Omit<Toast, 'id'>): void;
  dismiss(id: number): void;
  setBuild(b: BuildState | null | ((b: BuildState | null) => BuildState | null)): void;
}

let toastId = 0;

export const useStore = create<State>((set, get) => ({
  ready: false,
  view: { name: 'home' },
  packs: [],
  settings: null,
  toasts: [],
  build: null,
  newPackOpen: false,
  backdrop: null,
  showcase: [],
  setBackdrop(src) {
    if (get().backdrop !== src) set({ backdrop: src });
  },
  async loadShowcase() {
    if (get().showcase.length) return get().showcase;
    const list = await api.meta.showcase().catch(() => [] as Showcase[]);
    set({ showcase: list });
    return list;
  },

  async init() {
    const [loaded, settings] = await Promise.all([api.packs.list(), api.settings.get()]);
    // Сборки из прошлых версий дизайна: перегенерируем иконку профиля в новом стиле
    const packs = await Promise.all(
      loaded.map(async (p) => {
        if (p.accent === '#8fd3ff') return p;
        return api.packs.save({ ...p, icon: generatePackIcon(p.name, paletteFor(p.id)), accent: '#8fd3ff' }).catch(() => p);
      }),
    );
    set({ packs, settings, ready: true });
  },
  go(view) {
    set({ view });
  },
  setNewPackOpen(v) {
    set({ newPackOpen: v });
  },
  async savePack(p) {
    const saved = await api.packs.save(p);
    set({ packs: [saved, ...get().packs.filter((x) => x.id !== saved.id)] });
    return saved;
  },
  async updatePack(id, fn) {
    const cur = get().packs.find((p) => p.id === id);
    if (!cur) return;
    const next = fn(structuredClone(cur));
    set({ packs: get().packs.map((p) => (p.id === id ? next : p)) });
    await api.packs.save(next);
  },
  async removePack(id) {
    await api.packs.remove(id);
    set({ packs: get().packs.filter((p) => p.id !== id), view: { name: 'home' } });
  },
  async refreshPacks() {
    set({ packs: await api.packs.list() });
  },
  async saveSettings(patch) {
    set({ settings: await api.settings.set(patch) });
  },
  toast(t) {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-2), { ...t, id }] });
    setTimeout(() => get().dismiss(id), t.kind === 'error' ? 7000 : 3800);
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
  setBuild(b) {
    set({ build: typeof b === 'function' ? b(get().build) : b });
  },
}));
