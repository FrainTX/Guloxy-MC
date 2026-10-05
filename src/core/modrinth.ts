import { getJson, chunk } from './http';
import type {
  CatalogItem,
  ContentKind,
  FileDependency,
  Loader,
  ModFile,
  ProjectDetails,
  SearchQuery,
  SearchResult,
} from '../shared/types';

const API = 'https://api.modrinth.com/v2';

interface MrHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  icon_url?: string;
  downloads: number;
  categories: string[];
  client_side: string;
  project_type: string;
  date_modified?: string;
  featured_gallery?: string | null;
  gallery?: string[];
}

export interface MrProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  icon_url?: string;
  downloads: number;
  categories: string[];
  client_side: string;
  server_side: string;
  project_type: string;
  team: string;
  updated: string;
  gallery?: { url: string; raw_url?: string; featured: boolean }[];
  source_url?: string;
  issues_url?: string;
  wiki_url?: string;
  discord_url?: string;
}

export interface MrVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  version_type: 'release' | 'beta' | 'alpha';
  game_versions: string[];
  loaders: string[];
  date_published: string;
  files: { url: string; filename: string; primary: boolean; size: number; hashes: { sha1: string; sha512: string } }[];
  dependencies: { version_id?: string | null; project_id?: string | null; file_name?: string | null; dependency_type: FileDependency['type'] }[];
}

const KIND_TO_TYPE: Record<ContentKind, string> = { mod: 'mod', resourcepack: 'resourcepack', shader: 'shader' };
const TYPE_TO_KIND: Record<string, ContentKind> = { mod: 'mod', resourcepack: 'resourcepack', shader: 'shader' };

/** Какие загрузчики Modrinth подходят для выбранного загрузчика сборки. */
export function mrLoadersFor(loader: Loader, kind: ContentKind): string[] | undefined {
  if (kind === 'resourcepack') return ['minecraft'];
  if (kind === 'shader') return ['iris', 'optifine'];
  if (loader === 'quilt') return ['quilt', 'fabric'];
  return [loader];
}

function hitToItem(h: MrHit, kind: ContentKind): CatalogItem {
  return {
    source: 'modrinth',
    projectId: h.project_id,
    slug: h.slug,
    title: h.title,
    description: h.description,
    author: h.author,
    iconUrl: h.icon_url || undefined,
    downloads: h.downloads,
    kind: TYPE_TO_KIND[h.project_type] ?? kind,
    categories: h.categories ?? [],
    clientSide: (h.client_side as CatalogItem['clientSide']) ?? 'unknown',
    url: `https://modrinth.com/${h.project_type}/${h.slug}`,
    updatedAt: h.date_modified,
    cover: h.featured_gallery || h.gallery?.[0] || undefined,
  };
}

export function projectToItem(p: MrProject, author = ''): CatalogItem {
  const kind = TYPE_TO_KIND[p.project_type] ?? 'mod';
  return {
    source: 'modrinth',
    projectId: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    author,
    iconUrl: p.icon_url || undefined,
    downloads: p.downloads,
    kind,
    categories: p.categories ?? [],
    clientSide: (p.client_side as CatalogItem['clientSide']) ?? 'unknown',
    url: `https://modrinth.com/${p.project_type}/${p.slug}`,
    updatedAt: p.updated,
    cover: (p.gallery?.find((g) => g.featured) ?? p.gallery?.[0])?.url,
  };
}

export async function search(q: SearchQuery): Promise<SearchResult> {
  const facets: string[][] = [[`project_type:${KIND_TO_TYPE[q.kind]}`], [`versions:${q.mcVersion}`]];
  if (q.kind === 'mod') {
    facets.push((mrLoadersFor(q.loader, 'mod') ?? []).map((l) => `categories:${l}`));
  }
  const index = q.sort === 'updated' ? 'updated' : q.sort;
  const url =
    `${API}/search?query=${encodeURIComponent(q.query)}` +
    `&facets=${encodeURIComponent(JSON.stringify(facets))}` +
    `&index=${index}&offset=${q.offset}&limit=${q.limit}`;
  const res = await getJson<{ hits: MrHit[]; total_hits: number }>(url);
  return { items: res.hits.map((h) => hitToItem(h, q.kind)), total: res.total_hits };
}

export async function getProject(idOrSlug: string): Promise<MrProject | null> {
  try {
    return await getJson<MrProject>(`${API}/project/${encodeURIComponent(idOrSlug)}`, { retries: 1 });
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

export async function getProjects(ids: string[]): Promise<MrProject[]> {
  const out: MrProject[] = [];
  for (const part of chunk(ids, 80)) {
    out.push(...(await getJson<MrProject[]>(`${API}/projects?ids=${encodeURIComponent(JSON.stringify(part))}`)));
  }
  return out;
}

export async function getTeamOwner(teamId: string): Promise<string> {
  try {
    const members = await getJson<{ role: string; user: { username: string } }[]>(`${API}/team/${teamId}/members`, { retries: 1 });
    const owner = members.find((m) => m.role === 'Owner') ?? members[0];
    return owner?.user.username ?? '';
  } catch {
    return '';
  }
}

export function versionToFile(v: MrVersion): ModFile {
  const f = v.files.find((x) => x.primary) ?? v.files[0];
  return {
    source: 'modrinth',
    projectId: v.project_id,
    versionId: v.id,
    versionName: v.version_number || v.name,
    fileName: f.filename,
    url: f.url,
    sha1: f.hashes.sha1,
    sha512: f.hashes.sha512,
    size: f.size,
    channel: v.version_type,
    gameVersions: v.game_versions,
    loaders: v.loaders,
    published: v.date_published,
    dependencies: v.dependencies
      .filter((d) => d.project_id || d.version_id)
      .map((d) => ({
        source: 'modrinth' as const,
        projectId: d.project_id ?? undefined,
        versionId: d.version_id ?? undefined,
        type: d.dependency_type,
      })),
  };
}

export async function getVersions(
  projectId: string,
  opts: { loaders?: string[]; gameVersions?: string[] } = {},
): Promise<MrVersion[]> {
  const params: string[] = [];
  if (opts.loaders?.length) params.push(`loaders=${encodeURIComponent(JSON.stringify(opts.loaders))}`);
  if (opts.gameVersions?.length) params.push(`game_versions=${encodeURIComponent(JSON.stringify(opts.gameVersions))}`);
  return getJson<MrVersion[]>(`${API}/project/${encodeURIComponent(projectId)}/version${params.length ? `?${params.join('&')}` : ''}`);
}

export async function getVersion(versionId: string): Promise<MrVersion> {
  return getJson<MrVersion>(`${API}/version/${versionId}`);
}

/** Поиск версий по sha1 хешам файлов (используется для сопоставления CurseForge ↔ Modrinth). */
export async function versionsByHashes(sha1s: string[]): Promise<Record<string, MrVersion>> {
  const out: Record<string, MrVersion> = {};
  for (const part of chunk(sha1s, 500)) {
    if (!part.length) continue;
    Object.assign(
      out,
      await getJson<Record<string, MrVersion>>(`${API}/version_files`, {
        method: 'POST',
        body: { hashes: part, algorithm: 'sha1' },
      }),
    );
  }
  return out;
}

export async function details(projectId: string, mcVersion: string, loader: Loader, kind: ContentKind): Promise<ProjectDetails> {
  const p = await getProject(projectId);
  if (!p) throw new Error('Проект не найден на Modrinth');
  const [author, versions] = await Promise.all([
    getTeamOwner(p.team),
    getVersions(p.id, { loaders: mrLoadersFor(loader, kind), gameVersions: [mcVersion] }).catch(() => []),
  ]);
  const links = [
    { label: 'Modrinth', url: `https://modrinth.com/${p.project_type}/${p.slug}` },
    p.source_url && { label: 'Исходники', url: p.source_url },
    p.wiki_url && { label: 'Вики', url: p.wiki_url },
    p.issues_url && { label: 'Баг-трекер', url: p.issues_url },
    p.discord_url && { label: 'Discord', url: p.discord_url },
  ].filter(Boolean) as { label: string; url: string }[];
  return {
    item: projectToItem(p, author),
    body: p.body,
    gallery: (p.gallery ?? []).map((g) => g.url),
    links,
    versions: versions.map(versionToFile),
  };
}

/** Полноразмерная картинка проекта (для больших шапок). */
export function bigImage(p: MrProject): string | undefined {
  const g = p.gallery?.find((x) => x.featured) ?? p.gallery?.[0];
  return g ? g.raw_url || g.url : undefined;
}

let showcaseCache: { at: number; data: import('../shared/types').Showcase[] } | null = null;

/** Витрина: красивые кадры из самых популярных шейдеров. */
export async function showcase(): Promise<import('../shared/types').Showcase[]> {
  if (showcaseCache && Date.now() - showcaseCache.at < 3 * 3600_000) return showcaseCache.data;
  const facets = encodeURIComponent(JSON.stringify([['project_type:shader']]));
  const res = await getJson<{ hits: MrHit[] }>(`${API}/search?facets=${facets}&index=downloads&limit=16`);
  const projects = await getProjects(res.hits.map((h) => h.project_id));
  const data = projects
    .map((p) => {
      const g = p.gallery?.find((x) => x.featured) ?? p.gallery?.[0];
      return g ? { title: p.title, image: g.raw_url || g.url, thumb: g.url, url: `https://modrinth.com/shader/${p.slug}` } : null;
    })
    .filter((x): x is import('../shared/types').Showcase => !!x);
  showcaseCache = { at: Date.now(), data };
  return data;
}
