import { getJson, HttpError } from './http';
import type {
  CatalogItem,
  ContentKind,
  FileDependency,
  Loader,
  ModFile,
  ProjectDetails,
  ReleaseChannel,
  SearchQuery,
  SearchResult,
} from '../shared/types';

const API = 'https://api.curseforge.com/v1';
const GAME_ID = 432;

let apiKey = '';
export function setApiKey(key: string) {
  apiKey = key.trim();
}
export function hasApiKey() {
  return apiKey.length > 0;
}

export const CLASS_IDS: Record<ContentKind, number> = { mod: 6, resourcepack: 12, shader: 6552 };
const CLASS_TO_KIND: Record<number, ContentKind> = { 6: 'mod', 12: 'resourcepack', 6552: 'shader' };

export const LOADER_TYPES: Record<Loader, number> = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };

const SORT_FIELDS: Record<SearchQuery['sort'], number> = { relevance: 2, downloads: 6, updated: 3, newest: 11 };

export interface CfMod {
  id: number;
  name: string;
  slug: string;
  summary: string;
  downloadCount: number;
  classId?: number;
  logo?: { thumbnailUrl?: string; url?: string };
  authors: { name: string }[];
  links?: { websiteUrl?: string; wikiUrl?: string; issuesUrl?: string; sourceUrl?: string };
  categories?: { name: string }[];
  screenshots?: { url: string; thumbnailUrl?: string }[];
  dateModified?: string;
  allowModDistribution?: boolean | null;
}

export interface CfFile {
  id: number;
  modId: number;
  displayName: string;
  fileName: string;
  releaseType: 1 | 2 | 3;
  fileDate: string;
  fileLength: number;
  downloadUrl: string | null;
  gameVersions: string[];
  hashes: { value: string; algo: number }[];
  dependencies: { modId: number; relationType: number }[];
  isAvailable?: boolean;
}

function headers() {
  if (!apiKey) {
    throw new Error('Не задан API-ключ CurseForge. Откройте «Настройки» и вставьте ключ с console.curseforge.com');
  }
  return { 'x-api-key': apiKey };
}

async function cf<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  try {
    const res = await getJson<{ data: T }>(`${API}${path}`, { ...init, headers: headers() });
    return res.data;
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
      throw new Error('CurseForge отклонил API-ключ (403). Проверьте ключ в настройках.');
    }
    throw e;
  }
}

export function modToItem(m: CfMod, fallbackKind: ContentKind = 'mod'): CatalogItem {
  const kind = (m.classId && CLASS_TO_KIND[m.classId]) || fallbackKind;
  const typePath = kind === 'mod' ? 'mc-mods' : kind === 'resourcepack' ? 'texture-packs' : 'shaders';
  return {
    source: 'curseforge',
    projectId: String(m.id),
    slug: m.slug,
    title: m.name,
    description: m.summary,
    author: m.authors?.[0]?.name ?? '',
    iconUrl: m.logo?.thumbnailUrl || m.logo?.url || undefined,
    downloads: m.downloadCount,
    kind,
    categories: (m.categories ?? []).map((c) => c.name),
    url: m.links?.websiteUrl || `https://www.curseforge.com/minecraft/${typePath}/${m.slug}`,
    updatedAt: m.dateModified,
    cover: m.screenshots?.[0]?.thumbnailUrl || m.screenshots?.[0]?.url,
  };
}

export async function search(q: SearchQuery): Promise<SearchResult> {
  const p = new URLSearchParams({
    gameId: String(GAME_ID),
    classId: String(CLASS_IDS[q.kind]),
    searchFilter: q.query,
    gameVersion: q.mcVersion,
    sortField: String(SORT_FIELDS[q.sort]),
    sortOrder: 'desc',
    index: String(q.offset),
    pageSize: String(Math.min(q.limit, 50)),
  });
  if (q.kind === 'mod') p.set('modLoaderType', String(LOADER_TYPES[q.loader]));
  const res = await getJson<{ data: CfMod[]; pagination: { totalCount: number } }>(`${API}/mods/search?${p}`, {
    headers: headers(),
  });
  return { items: res.data.map((m) => modToItem(m, q.kind)), total: Math.min(res.pagination.totalCount, 10000) };
}

export async function getMod(id: number | string): Promise<CfMod> {
  return cf<CfMod>(`/mods/${id}`);
}

export async function getMods(ids: (number | string)[]): Promise<CfMod[]> {
  if (!ids.length) return [];
  return cf<CfMod[]>(`/mods`, { method: 'POST', body: { modIds: ids.map(Number), filterPcOnly: true } });
}

export async function getFile(modId: number | string, fileId: number | string): Promise<CfFile> {
  return cf<CfFile>(`/mods/${modId}/files/${fileId}`);
}

export async function getFiles(modId: number | string, gameVersion?: string, loaderType?: number): Promise<CfFile[]> {
  const out: CfFile[] = [];
  for (let index = 0; index < 400; index += 50) {
    const p = new URLSearchParams({ pageSize: '50', index: String(index) });
    if (gameVersion) p.set('gameVersion', gameVersion);
    if (loaderType !== undefined) p.set('modLoaderType', String(loaderType));
    const res = await getJson<{ data: CfFile[]; pagination: { totalCount: number } }>(`${API}/mods/${modId}/files?${p}`, {
      headers: headers(),
    });
    out.push(...res.data);
    if (out.length >= res.pagination.totalCount || res.data.length < 50) break;
  }
  return out;
}

/** Прямая ссылка на CDN — работает и для файлов, у которых автор запретил стороннюю раздачу через API. */
export function edgeUrl(file: { id: number; fileName: string }): string {
  return `https://edge.forgecdn.net/files/${Math.floor(file.id / 1000)}/${file.id % 1000}/${encodeURIComponent(file.fileName)}`;
}

const RELATION: Record<number, FileDependency['type'] | undefined> = {
  1: 'embedded',
  2: 'optional',
  3: 'required',
  5: 'incompatible',
};
const CHANNEL: Record<number, ReleaseChannel> = { 1: 'release', 2: 'beta', 3: 'alpha' };
const LOADER_TAGS = ['forge', 'fabric', 'quilt', 'neoforge'];

export function fileToModFile(f: CfFile): ModFile {
  return {
    source: 'curseforge',
    projectId: String(f.modId),
    versionId: String(f.id),
    versionName: f.displayName || f.fileName,
    fileName: f.fileName,
    url: f.downloadUrl || edgeUrl(f),
    sha1: f.hashes.find((h) => h.algo === 1)?.value,
    size: f.fileLength,
    channel: CHANNEL[f.releaseType] ?? 'release',
    gameVersions: f.gameVersions.filter((g) => /^\d/.test(g)),
    loaders: f.gameVersions.map((g) => g.toLowerCase()).filter((g) => LOADER_TAGS.includes(g)),
    published: f.fileDate,
    dependencies: f.dependencies
      .filter((d) => RELATION[d.relationType])
      .map((d) => ({ source: 'curseforge' as const, projectId: String(d.modId), type: RELATION[d.relationType]! })),
  };
}

export async function details(projectId: string, mcVersion: string, loader: Loader, kind: ContentKind): Promise<ProjectDetails> {
  const [mod, body, files] = await Promise.all([
    getMod(projectId),
    cf<string>(`/mods/${projectId}/description`).catch(() => ''),
    getFiles(projectId, mcVersion, kind === 'mod' ? LOADER_TYPES[loader] : undefined).catch(() => []),
  ]);
  const item = modToItem(mod, kind);
  const links = [
    { label: 'CurseForge', url: item.url },
    mod.links?.sourceUrl && { label: 'Исходники', url: mod.links.sourceUrl },
    mod.links?.wikiUrl && { label: 'Вики', url: mod.links.wikiUrl },
    mod.links?.issuesUrl && { label: 'Баг-трекер', url: mod.links.issuesUrl },
  ].filter(Boolean) as { label: string; url: string }[];
  return {
    item,
    body,
    gallery: (mod.screenshots ?? []).map((s) => s.url),
    links,
    versions: files.filter((f) => f.isAvailable !== false).map(fileToModFile),
  };
}
