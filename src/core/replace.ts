import * as mr from './modrinth';
import * as cf from './curseforge';
import { entryKey, type Resolver } from './resolver';
import type { CatalogItem, Issue, Loader, Pack, PackEntry, ResolveResult } from '../shared/types';

/**
 * Библиотеки, которые существуют только для одной платформы. null — на другой платформе не нужны
 * (если они понадобятся модам, зависимости подтянут нужный аналог сами).
 */
const FABRIC_ONLY: Record<string, string | null> = {
  'fabric-api': null,
  'quilted-fabric-api': null,
  qsl: null,
  'fabric-language-kotlin': null,
  modmenu: null,
  indium: null,
};
const FORGE_ONLY: Record<string, string | null> = {
  'kotlin-for-forge': null,
  'forgified-fabric-api': null,
  catalogue: null,
  configured: null,
};

const LOADER_WORDS = /\b(fabric|forge|neoforge|neo\s*forge|quilt|port|edition|version)\b/gi;

/** Название без упоминаний загрузчика: «Create Fabric» → «create». */
export function normTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[[(].*?[\])]/g, ' ')
    .replace(LOADER_WORDS, ' ')
    .replace(/[^a-z0-9а-яё]+/gi, ' ')
    .trim();
}

function toEntry(item: CatalogItem, from: PackEntry, reason: string): PackEntry {
  return {
    key: entryKey(item.source, item.projectId),
    source: item.source,
    projectId: item.projectId,
    slug: item.slug,
    title: item.title,
    author: item.author,
    iconUrl: item.iconUrl,
    kind: from.kind,
    addedBy: from.addedBy === 'dependency' ? 'auto' : from.addedBy,
    requiredBy: [],
    reason,
    enabled: true,
  };
}

const platformOnly = (loader: Loader) => (loader === 'fabric' || loader === 'quilt' ? FORGE_ONLY : FABRIC_ONLY);

type Plan = { type: 'remove'; reason: string } | { type: 'replace'; item: CatalogItem; reason: string } | null;

async function plan(entry: PackEntry, pack: Pack, resolver: Resolver): Promise<Plan> {
  const loaderName = pack.loader === 'neoforge' ? 'NeoForge' : pack.loader[0].toUpperCase() + pack.loader.slice(1);
  const only = platformOnly(pack.loader);
  if (entry.slug in only) {
    const alt = only[entry.slug];
    if (alt) {
      const p = await mr.getProject(alt).catch(() => null);
      if (p) return { type: 'replace', item: mr.projectToItem(p), reason: `${entry.title} нужен только для другого загрузчика — заменён на ${p.title}` };
    }
    return { type: 'remove', reason: `${entry.title} нужен только для другого загрузчика, на ${loaderName} он не требуется — убран` };
  }

  const norm = normTitle(entry.title);
  const same = pack.entries.find((e) => e.key !== entry.key && e.enabled && e.kind === entry.kind && normTitle(e.title) === norm);
  if (same && norm.length >= 3) {
    return { type: 'remove', reason: `${entry.title} — версия для другого загрузчика, в сборке уже есть ${same.title}` };
  }
  if (norm.length < 3) return null;

  const q = { query: norm, kind: entry.kind, mcVersion: pack.mcVersion, loader: pack.loader, sort: 'relevance' as const, offset: 0, limit: 10 };
  const candidates: CatalogItem[] = [];
  const mrHits = await mr.search({ ...q, source: 'modrinth' }).catch(() => ({ items: [] as CatalogItem[] }));
  candidates.push(...mrHits.items);
  if (cf.hasApiKey()) {
    const cfHits = await cf.search({ ...q, source: 'curseforge' }).catch(() => ({ items: [] as CatalogItem[] }));
    candidates.push(...cfHits.items);
  }
  for (const c of candidates) {
    if (c.projectId === entry.projectId || normTitle(c.title) !== norm) continue;
    if (pack.entries.some((e) => e.key === entryKey(c.source, c.projectId))) {
      return { type: 'remove', reason: `${entry.title} — версия для другого загрузчика, в сборке уже есть ${c.title}` };
    }
    const files = await resolver.compatibleFiles(pack, toEntry(c, entry, '')).catch(() => []);
    if (files.length) return { type: 'replace', item: c, reason: `${entry.title} не работает на ${loaderName} — заменён на ${c.title}` };
  }
  return null;
}

/**
 * Разрешает зависимости и автоматически чинит моды, у которых нет версии для выбранного загрузчика:
 * заменяет их на версию для нужной платформы или убирает лишние платформенные библиотеки.
 */
export async function resolveWithFixes(
  resolver: Resolver,
  input: Pack,
  log?: (level: 'info' | 'ok' | 'warn' | 'error', text: string) => void,
): Promise<ResolveResult> {
  let res = await resolver.resolve(input);
  const fixed: Issue[] = [];
  const tried = new Set<string>();
  for (let round = 0; round < 3; round++) {
    const bad = res.issues.filter((i) => i.code === 'no-version' && i.entryKey && !tried.has(i.entryKey));
    if (!bad.length) break;
    const pack = res.pack;
    let changed = false;
    for (const issue of bad) {
      tried.add(issue.entryKey!);
      const entry = pack.entries.find((e) => e.key === issue.entryKey);
      if (!entry) continue;
      const isDep = entry.addedBy === 'dependency';
      const p = await plan(entry, pack, resolver).catch(() => null);
      if (!p) {
        if (!isDep) continue;
        // Сайт указал зависимость, которой нет для этого загрузчика (частая история у мультиплатформенных
        // модов на CurseForge). Не тянем её; если она нужна на самом деле — это покажет проверка JAR.
        resolver.skip.add(entry.key);
        pack.entries = pack.entries.filter((e) => e.key !== entry.key);
        const note = `Зависимость ${entry.title} пропущена: для ${pack.loader} её нет, сайт указал её для другого загрузчика`;
        fixed.push({ level: 'info', title: note, detail: 'Если она действительно нужна, проверка JAR это покажет.' });
        log?.('info', note);
        changed = true;
        continue;
      }
      if (isDep) resolver.skip.add(entry.key);
      pack.entries = pack.entries.filter((e) => e.key !== entry.key);
      if (p.type === 'replace' && !pack.entries.some((e) => e.key === entryKey(p.item.source, p.item.projectId))) {
        pack.entries.push(toEntry(p.item, entry, p.reason));
      }
      fixed.push({ level: 'fixed', title: p.reason });
      log?.('ok', p.reason);
      changed = true;
    }
    if (!changed) break;
    res = await resolver.resolve(pack);
  }
  res.issues = [...fixed, ...res.issues];
  return res;
}
