import { getJson, getText } from './http';
import type { Loader, LoaderVersionInfo, McVersionInfo } from '../shared/types';
import { compareVersions } from './versionrange';

const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

interface MojangManifest {
  latest: { release: string };
  versions: { id: string; type: string; url: string; releaseTime: string; sha1: string }[];
}

let manifestCache: { at: number; data: MojangManifest } | null = null;

export async function mojangManifest(): Promise<MojangManifest> {
  if (manifestCache && Date.now() - manifestCache.at < 30 * 60_000) return manifestCache.data;
  const data = await getJson<MojangManifest>(MOJANG_MANIFEST);
  manifestCache = { at: Date.now(), data };
  return data;
}

export async function mcVersions(): Promise<McVersionInfo[]> {
  const m = await mojangManifest();
  return m.versions
    .filter((v) => v.type === 'release' || v.type === 'snapshot')
    .map((v) => ({ version: v.id, type: v.type as 'release' | 'snapshot', date: v.releaseTime }));
}

export interface MojangVersionJson {
  id: string;
  javaVersion?: { component: string; majorVersion: number };
  [k: string]: unknown;
}

export async function mojangVersionJson(mc: string): Promise<{ json: MojangVersionJson; raw: string }> {
  const m = await mojangManifest();
  const entry = m.versions.find((v) => v.id === mc);
  if (!entry) throw new Error(`Версия Minecraft ${mc} не найдена в манифесте Mojang`);
  const raw = await getText(entry.url);
  return { json: JSON.parse(raw) as MojangVersionJson, raw };
}

export async function requiredJava(mc: string): Promise<number> {
  try {
    const { json } = await mojangVersionJson(mc);
    return json.javaVersion?.majorVersion ?? 8;
  } catch {
    return 21;
  }
}

/* ------------------------------ Fabric / Quilt ----------------------------- */

const FABRIC_META = 'https://meta.fabricmc.net/v2';
const QUILT_META = 'https://meta.quiltmc.org/v3';

async function fabricLike(base: string, mc: string, prismUid: string): Promise<LoaderVersionInfo[]> {
  try {
    const list = await getJson<{ loader: { version: string; stable?: boolean } }[]>(
      `${base}/versions/loader/${encodeURIComponent(mc)}`,
    );
    return list
      .map((x) => ({
        version: x.loader.version,
        stable: x.loader.stable ?? !/beta|pre|rc/i.test(x.loader.version),
      }))
      .sort((a, b) => compareVersions(b.version, a.version));
  } catch (e) {
    // запасной источник: список версий загрузчика у Prism (без привязки к версии игры)
    const idx = await getJson<PrismIndex>(`${PRISM_META}/${prismUid}/index.json`).catch(() => {
      throw e;
    });
    return idx.versions.map((v) => ({ version: v.version, stable: !/beta|pre|rc/i.test(v.version) }));
  }
}

export async function fabricProfile(loader: 'fabric' | 'quilt', mc: string, version: string): Promise<Record<string, unknown>> {
  const base = loader === 'fabric' ? FABRIC_META : QUILT_META;
  return getJson(`${base}/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(version)}/profile/json`);
}

/* ---------------------------------- Forge ---------------------------------- */

const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';

function parseMavenVersions(xml: string): string[] {
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
}

/* ------------------------- Запасной источник: Prism ------------------------ */

const PRISM_META = 'https://meta.prismlauncher.org/v1';

interface PrismIndex {
  versions: { version: string; recommended?: boolean; requires?: { uid: string; equals?: string }[] }[];
}

/**
 * Версии загрузчика для конкретной версии Minecraft из метаданных Prism Launcher.
 * Нужен, когда официальный maven временно отдаёт неполный список (так бывает у NeoForge).
 */
async function prismVersions(uid: string, mc: string): Promise<{ version: string; recommended: boolean }[]> {
  const idx = await getJson<PrismIndex>(`${PRISM_META}/${uid}/index.json`);
  return idx.versions
    .filter((v) => v.requires?.some((r) => r.uid === 'net.minecraft' && r.equals === mc))
    .map((v) => ({ version: v.version, recommended: !!v.recommended }));
}

/** Объединяет списки из нескольких источников; падает, только если упали все. */
async function mergeSources(sources: Promise<string[]>[]): Promise<string[]> {
  const results = await Promise.allSettled(sources);
  const ok = results.filter((r): r is PromiseFulfilledResult<string[]> => r.status === 'fulfilled');
  if (!ok.length) throw (results[0] as PromiseRejectedResult).reason;
  return [...new Set(ok.flatMap((r) => r.value))].sort((a, b) => compareVersions(b, a));
}

async function forgeVersions(mc: string): Promise<LoaderVersionInfo[]> {
  const promosP = getJson<{ promos: Record<string, string> }>(FORGE_PROMOS).catch(() => ({ promos: {} as Record<string, string> }));
  const all = await mergeSources([
    getText(`${FORGE_MAVEN}/maven-metadata.xml`).then((xml) =>
      parseMavenVersions(xml)
        .filter((v) => v.startsWith(`${mc}-`))
        .map((v) => v.slice(mc.length + 1)),
    ),
    prismVersions('net.minecraftforge', mc).then((l) => l.map((v) => v.version)),
  ]);
  const recommended = (await promosP).promos[`${mc}-recommended`];
  return all.map((v) => ({ version: v, stable: !recommended || compareVersions(v, recommended) <= 0 }));
}

export function forgeFullVersion(mc: string, forge: string) {
  return `${mc}-${forge}`;
}

export function forgeInstallerUrl(mc: string, forge: string) {
  const full = forgeFullVersion(mc, forge);
  return `${FORGE_MAVEN}/${full}/forge-${full}-installer.jar`;
}

/* -------------------------------- NeoForge --------------------------------- */

const NEO_API = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge';

/** Префикс версии NeoForge для версии Minecraft: 1.21.1 → "21.1.", 1.21 → "21.0.", 26.1 → "26.1.0.", 26.1.2 → "26.1.2." */
export function neoforgePrefix(mc: string): string {
  const parts = mc.split('.');
  if (parts[0] === '1') return `${parts[1]}.${parts[2] ?? '0'}.`;
  return `${parts[0]}.${parts[1] ?? '0'}.${parts[2] ?? '0'}.`;
}

async function neoforgeVersions(mc: string): Promise<LoaderVersionInfo[]> {
  const prefix = neoforgePrefix(mc);
  const all = await mergeSources([
    getJson<{ versions: string[] }>(NEO_API).then((r) => r.versions.filter((v) => v.startsWith(prefix))),
    prismVersions('net.neoforged', mc).then((l) => l.map((v) => v.version)),
  ]);
  return all.map((v) => ({ version: v, stable: !/beta|alpha/i.test(v) }));
}

export function neoforgeInstallerUrl(version: string) {
  return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`;
}

/* --------------------------------------------------------------------------- */

export async function loaderVersions(loader: Loader, mc: string): Promise<LoaderVersionInfo[]> {
  switch (loader) {
    case 'fabric':
      return fabricLike(FABRIC_META, mc, 'net.fabricmc.fabric-loader');
    case 'quilt':
      return fabricLike(QUILT_META, mc, 'org.quiltmc.quilt-loader');
    case 'forge':
      return forgeVersions(mc);
    case 'neoforge':
      return neoforgeVersions(mc);
  }
}

/** Выбирает конкретную версию загрузчика: заданную или самую свежую стабильную. */
export async function pickLoaderVersion(loader: Loader, mc: string, wanted: string): Promise<string> {
  const list = await loaderVersions(loader, mc);
  if (!list.length) throw new Error(`Загрузчик ${loader} не поддерживает Minecraft ${mc}`);
  if (wanted && wanted !== 'latest') {
    if (!list.some((v) => v.version === wanted)) {
      throw new Error(`Версия загрузчика ${wanted} не найдена для Minecraft ${mc}`);
    }
    return wanted;
  }
  return (list.find((v) => v.stable) ?? list[0]).version;
}
