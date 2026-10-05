import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { Store } from '../src/core/store';
import { setFetch } from '../src/core/http';
import { effectiveCfKey } from '../src/core/builtin';
import * as mr from '../src/core/modrinth';
import * as cf from '../src/core/curseforge';
import { mcVersions, loaderVersions } from '../src/core/loaders';
import { Resolver } from '../src/core/resolver';
import { resolveWithFixes } from '../src/core/replace';
import { buildPack } from '../src/core/build';
import { importArchive } from '../src/core/importer';
import { findJavas } from '../src/core/java';
import { defaultMinecraftDir, defaultPrismInstancesDir, safeName } from '../src/core/paths';
import type { BuildRequest, ContentKind, Loader, Pack, SearchQuery, Settings, Source } from '../src/shared/types';

const isDev = !!process.env.VITE_DEV_SERVER_URL;
let win: BrowserWindow | null = null;
const store = new Store(app.getPath('userData'));
let buildAbort: AbortController | null = null;

async function applySettings(s: Settings) {
  cf.setApiKey(effectiveCfKey(s.curseforgeApiKey));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#07050d',
    show: false,
    title: 'Guloxy MC',
    icon: join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env.VITE_DEV_SERVER_URL ?? 'file://')) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  if (isDev) void win.loadURL(process.env.VITE_DEV_SERVER_URL!);
  else void win.loadFile(join(__dirname, '../dist/index.html'));
}

function handle<T extends unknown[], R>(channel: string, fn: (...args: T) => Promise<R> | R) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...(args as T)) };
    } catch (err) {
      return { ok: false, error: (err as Error).message ?? String(err) };
    }
  });
}

function registerIpc() {
  ipcMain.on('window:minimize', () => win?.minimize());
  ipcMain.on('window:maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
  ipcMain.on('window:close', () => win?.close());

  handle('settings:get', () => store.getSettings());
  handle('settings:set', async (patch: Partial<Settings>) => {
    const s = await store.setSettings(patch);
    await applySettings(s);
    return s;
  });
  handle('settings:detect', async () => ({
    minecraftDir: defaultMinecraftDir(),
    prismInstancesDir: defaultPrismInstancesDir(),
    java: (await findJavas(app.getPath('userData'))).map((j) => `${j.path} (Java ${j.major})`),
  }));

  handle('meta:mcVersions', () => mcVersions());
  handle('meta:loaderVersions', (loader: Loader, mc: string) => loaderVersions(loader, mc));
  handle('meta:showcase', () => mr.showcase());

  handle('catalog:search', (q: SearchQuery) => (q.source === 'modrinth' ? mr.search(q) : cf.search(q)));
  handle('catalog:details', (source: Source, id: string, mc: string, loader: Loader, kind: ContentKind) =>
    source === 'modrinth' ? mr.details(id, mc, loader, kind) : cf.details(id, mc, loader, kind),
  );

  handle('packs:list', () => store.listPacks());
  handle('packs:save', (p: Pack) => store.savePack(p));
  handle('packs:remove', (id: string) => store.removePack(id));
  handle('packs:resolve', async (id: string) => {
    const settings = await store.getSettings();
    await applySettings(settings);
    const pack = await store.getPack(id);
    const res = await resolveWithFixes(new Resolver({ preferSource: settings.preferSource }), pack);
    await store.savePack(res.pack);
    return res;
  });
  handle('packs:cover', async (id: string, next?: boolean) => {
    const pack = await store.getPack(id);
    if (pack.cover && !next) return pack.cover;
    const kindRank = { shader: 0, resourcepack: 1, mod: 2 } as const;
    const entries = [...pack.entries].sort(
      (a, b) => kindRank[a.kind] - kindRank[b.kind] || (a.addedBy === 'user' ? 0 : 1) - (b.addedBy === 'user' ? 0 : 1),
    );
    const candidates: string[] = [];
    const mrIds = entries.filter((e) => e.source === 'modrinth').map((e) => e.projectId).slice(0, 30);
    if (mrIds.length) {
      const projects = await mr.getProjects(mrIds).catch(() => []);
      const order = new Map(mrIds.map((x, i) => [x, i]));
      projects.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      for (const p of projects) {
        const img = mr.bigImage(p);
        if (img) candidates.push(img);
      }
    }
    const cfIds = entries.filter((e) => e.source === 'curseforge').map((e) => e.projectId).slice(0, 30);
    if (cfIds.length && (next || !candidates.length)) {
      for (const m of await cf.getMods(cfIds).catch(() => [])) if (m.screenshots?.[0]?.url) candidates.push(m.screenshots[0].url);
    }
    if (!candidates.length) return null;
    const cur = pack.cover ? candidates.indexOf(pack.cover) : -1;
    const cover = next ? candidates[(cur + 1) % candidates.length] : candidates[0];
    const fresh = await store.getPack(id);
    fresh.cover = cover;
    await store.savePack(fresh);
    return cover;
  });
  handle('packs:import', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Импорт сборки',
      filters: [{ name: 'Сборки Minecraft', extensions: ['mrpack', 'zip'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const { pack, warnings } = await importArchive(r.filePaths[0]);
    if (warnings.length) {
      void dialog.showMessageBox(win!, { type: 'info', title: 'Импорт', message: 'Импорт завершён', detail: warnings.slice(0, 15).join('\n') });
    }
    return store.savePack(pack);
  });

  handle('build:start', async (req: BuildRequest) => {
    if (buildAbort) throw new Error('Сборка уже идёт');
    buildAbort = new AbortController();
    try {
      const settings = await store.getSettings();
      await applySettings(settings);
      const pack = await store.getPack(req.packId);
      const exportDir = req.exportDir || join(app.getPath('documents'), 'Guloxy MC', safeName(pack.name));
      if (req.targets.some((t) => t !== 'official')) await mkdir(exportDir, { recursive: true });
      const report = await buildPack({
        pack,
        settings,
        targets: req.targets,
        appDir: app.getPath('userData'),
        cacheDir: store.cacheDir,
        exportDir,
        signal: buildAbort.signal,
        onProgress: (p) => win?.webContents.send('build:progress', p),
        onLog: (l) => win?.webContents.send('build:log', l),
        savePack: async (p) => {
          await store.savePack(p);
        },
      });
      const fresh = await store.getPack(req.packId);
      fresh.lastBuild = report;
      await store.savePack(fresh);
      return report;
    } finally {
      buildAbort = null;
    }
  });
  ipcMain.on('build:cancel', () => buildAbort?.abort());

  ipcMain.on('shell:openPath', (_e, p: string) => {
    if (existsSync(p)) void shell.openPath(p);
  });
  ipcMain.on('shell:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  handle('shell:pickDir', async (title: string) => {
    const r = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
}

app.whenReady().then(async () => {
  // Сетевой стек Chromium: системный прокси, системные сертификаты
  setFetch((input, init) => net.fetch(input as string, init));
  await applySettings(await store.getSettings());
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
