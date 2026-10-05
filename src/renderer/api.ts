import type {
  BuildLog,
  BuildProgress,
  BuildReport,
  CatalogItem,
  GuloxyApi,
  McVersionInfo,
  Pack,
  Settings,
  Showcase,
} from '../shared/types';

declare global {
  interface Window {
    guloxy?: GuloxyApi;
  }
}

/**
 * Веб-превью: когда интерфейс открыт в обычном браузере (без Electron),
 * каталог работает напрямую через Modrinth, а сборки хранятся в localStorage.
 */
function createWebApi(): GuloxyApi {
  const MR = 'https://api.modrinth.com/v2';
  const read = <T,>(k: string, d: T): T => {
    try {
      return JSON.parse(localStorage.getItem(k) ?? '') as T;
    } catch {
      return d;
    }
  };
  const write = (k: string, v: unknown) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  };
  const progressCbs = new Set<(p: BuildProgress) => void>();
  const logCbs = new Set<(l: BuildLog) => void>();
  const defaults: Settings = {
    curseforgeApiKey: '',
    preferSource: 'modrinth',
    concurrency: 6,
    minecraftDir: '~/.minecraft',
    prismInstancesDir: '',
    javaPath: '',
    defaultMemoryMb: 6144,
    reduceMotion: false,
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  return {
    window: { minimize() {}, maximize() {}, close() {} },
    settings: {
      get: async () => ({ ...defaults, ...read<Partial<Settings>>('gx.settings', {}) }),
      set: async (patch) => {
        const s = { ...defaults, ...read<Partial<Settings>>('gx.settings', {}), ...patch };
        write('gx.settings', s);
        return s;
      },
      detectPaths: async () => ({ minecraftDir: '~/.minecraft', prismInstancesDir: '', java: [] }),
    },
    meta: {
      mcVersions: async () => {
        const tags = (await (await fetch(`${MR}/tag/game_version`)).json()) as { version: string; version_type: string; date: string }[];
        return tags
          .filter((t) => t.version_type === 'release')
          .map((t) => ({ version: t.version, type: 'release', date: t.date }) as McVersionInfo);
      },
      loaderVersions: async (loader, mc) => {
        if (loader === 'fabric') {
          const r = (await (await fetch(`https://meta.fabricmc.net/v2/versions/loader/${mc}`)).json()) as { loader: { version: string; stable: boolean } }[];
          return r.map((x) => ({ version: x.loader.version, stable: x.loader.stable }));
        }
        return [{ version: 'latest', stable: true }];
      },
      showcase: async () => {
        const facets = encodeURIComponent(JSON.stringify([['project_type:shader']]));
        const r = (await (await fetch(`${MR}/search?facets=${facets}&index=downloads&limit=12`)).json()) as { hits: any[] };
        const ps = (await (await fetch(`${MR}/projects?ids=${encodeURIComponent(JSON.stringify(r.hits.map((h) => h.project_id)))}`)).json()) as any[];
        return ps
          .map((p) => {
            const g = p.gallery?.find((x: any) => x.featured) ?? p.gallery?.[0];
            return g ? { title: p.title, image: g.raw_url || g.url, thumb: g.url, url: `https://modrinth.com/shader/${p.slug}` } : null;
          })
          .filter(Boolean) as Showcase[];
      },
    },
    catalog: {
      search: async (q) => {
        if (q.source === 'curseforge') throw new Error('CurseForge доступен только в приложении');
        const facets: string[][] = [[`project_type:${q.kind}`], [`versions:${q.mcVersion}`]];
        if (q.kind === 'mod') facets.push(q.loader === 'quilt' ? ['categories:quilt', 'categories:fabric'] : [`categories:${q.loader}`]);
        const url = `${MR}/search?query=${encodeURIComponent(q.query)}&facets=${encodeURIComponent(JSON.stringify(facets))}&index=${q.sort}&offset=${q.offset}&limit=${q.limit}`;
        const r = (await (await fetch(url)).json()) as { hits: any[]; total_hits: number };
        return {
          total: r.total_hits,
          items: r.hits.map(
            (h): CatalogItem => ({
              source: 'modrinth',
              projectId: h.project_id,
              slug: h.slug,
              title: h.title,
              description: h.description,
              author: h.author,
              iconUrl: h.icon_url || undefined,
              downloads: h.downloads,
              kind: q.kind,
              categories: h.categories,
              clientSide: h.client_side,
              url: `https://modrinth.com/${h.project_type}/${h.slug}`,
              updatedAt: h.date_modified,
              cover: h.featured_gallery || h.gallery?.[0] || undefined,
            }),
          ),
        };
      },
      details: async (_s, id, mc, loader, kind) => {
        const p = (await (await fetch(`${MR}/project/${id}`)).json()) as any;
        const loaders = kind === 'mod' ? [loader] : kind === 'resourcepack' ? ['minecraft'] : ['iris', 'optifine'];
        const vs = (await (
          await fetch(`${MR}/project/${id}/version?loaders=${encodeURIComponent(JSON.stringify(loaders))}&game_versions=${encodeURIComponent(JSON.stringify([mc]))}`)
        ).json()) as any[];
        return {
          item: {
            source: 'modrinth',
            projectId: p.id,
            slug: p.slug,
            title: p.title,
            description: p.description,
            author: '',
            iconUrl: p.icon_url,
            downloads: p.downloads,
            kind,
            categories: p.categories,
            url: `https://modrinth.com/${p.project_type}/${p.slug}`,
          },
          body: p.body,
          gallery: (p.gallery ?? []).map((g: any) => g.url),
          links: [{ label: 'Modrinth', url: `https://modrinth.com/${p.project_type}/${p.slug}` }],
          versions: vs.map((v) => ({
            source: 'modrinth',
            projectId: v.project_id,
            versionId: v.id,
            versionName: v.version_number,
            fileName: v.files[0]?.filename,
            url: v.files[0]?.url,
            size: v.files[0]?.size,
            channel: v.version_type,
            gameVersions: v.game_versions,
            loaders: v.loaders,
            published: v.date_published,
            dependencies: [],
          })),
        };
      },
    },
    packs: {
      list: async () => read<Pack[]>('gx.packs', []).sort((a, b) => b.updatedAt - a.updatedAt),
      save: async (p) => {
        const all = read<Pack[]>('gx.packs', []).filter((x) => x.id !== p.id);
        p.updatedAt = Date.now();
        write('gx.packs', [...all, p]);
        return p;
      },
      remove: async (id) => write('gx.packs', read<Pack[]>('gx.packs', []).filter((x) => x.id !== id)),
      resolve: async (id) => {
        const pack = read<Pack[]>('gx.packs', []).find((p) => p.id === id)!;
        return { pack, resolved: [], issues: [], added: [] };
      },
      importFile: async () => null,
      cover: async () => null,
    },
    build: {
      start: async (req) => {
        const stages = ['resolve', 'download', 'verify', 'loader', 'install'] as const;
        const t0 = Date.now();
        const log = (level: BuildLog['level'], text: string) => logCbs.forEach((cb) => cb({ t: Date.now(), level, text }));
        log('info', 'Веб-превью: сборка симулируется. Скачайте приложение, чтобы собирать по-настоящему.');
        for (const s of stages) {
          for (let i = 0; i <= 10; i++) {
            progressCbs.forEach((cb) => cb({ stage: s, message: s, progress: i / 10, bytesDone: i * 1e6, bytesTotal: 1e7 }));
            await sleep(80);
          }
          log('ok', `Этап ${s} завершён`);
        }
        progressCbs.forEach((cb) => cb({ stage: 'done', message: 'Готово', progress: 1 }));
        const report: BuildReport = {
          ok: true,
          finishedAt: Date.now(),
          durationMs: Date.now() - t0,
          modCount: 0,
          totalBytes: 0,
          issues: [],
          outputs: req.targets.map((t) => ({ target: t, path: '(веб-превью)' })),
          loaderVersion: 'latest',
        };
        return report;
      },
      cancel() {},
      onProgress: (cb) => {
        progressCbs.add(cb);
        return () => progressCbs.delete(cb);
      },
      onLog: (cb) => {
        logCbs.add(cb);
        return () => logCbs.delete(cb);
      },
    },
    shell: {
      openPath() {},
      openExternal: (url) => window.open(url, '_blank'),
      pickDir: async () => null,
    },
  };
}

export const isElectron = typeof window !== 'undefined' && !!window.guloxy;
export const api: GuloxyApi = (typeof window !== 'undefined' && window.guloxy) || createWebApi();
