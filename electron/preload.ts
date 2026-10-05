import { contextBridge, ipcRenderer } from 'electron';
import type { BuildLog, BuildProgress, GuloxyApi } from '../src/shared/types';

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as { ok: boolean; value?: T; error?: string };
  if (!r.ok) throw new Error(r.error);
  return r.value as T;
}

const api: GuloxyApi = {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
  settings: {
    get: () => call('settings:get'),
    set: (patch) => call('settings:set', patch),
    detectPaths: () => call('settings:detect'),
  },
  meta: {
    mcVersions: () => call('meta:mcVersions'),
    loaderVersions: (loader, mc) => call('meta:loaderVersions', loader, mc),
    showcase: () => call('meta:showcase'),
  },
  catalog: {
    search: (q) => call('catalog:search', q),
    details: (source, id, mc, loader, kind) => call('catalog:details', source, id, mc, loader, kind),
  },
  packs: {
    list: () => call('packs:list'),
    save: (p) => call('packs:save', p),
    remove: (id) => call('packs:remove', id),
    resolve: (id) => call('packs:resolve', id),
    importFile: () => call('packs:import'),
    cover: (id, next) => call('packs:cover', id, next),
  },
  build: {
    start: (req) => call('build:start', req),
    cancel: () => ipcRenderer.send('build:cancel'),
    onProgress: (cb) => {
      const fn = (_: unknown, p: BuildProgress) => cb(p);
      ipcRenderer.on('build:progress', fn);
      return () => ipcRenderer.removeListener('build:progress', fn);
    },
    onLog: (cb) => {
      const fn = (_: unknown, l: BuildLog) => cb(l);
      ipcRenderer.on('build:log', fn);
      return () => ipcRenderer.removeListener('build:log', fn);
    },
  },
  shell: {
    openPath: (p) => ipcRenderer.send('shell:openPath', p),
    openExternal: (url) => ipcRenderer.send('shell:openExternal', url),
    pickDir: (title) => call('shell:pickDir', title),
  },
};

contextBridge.exposeInMainWorld('guloxy', api);
