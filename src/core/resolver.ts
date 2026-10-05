import * as mr from './modrinth';
import * as cf from './curseforge';
import type { Issue, ModFile, Pack, PackEntry, ResolvedEntry, ResolveResult, Source } from '../shared/types';

export const entryKey = (source: Source, projectId: string) => `${source}:${projectId}`;

/** Хорошо известные проекты Modrinth, которые подтягиваются автоматически. */
export const KNOWN = {
  iris: 'YL57xq9U',
  sodium: 'AANobbMI',
  oculus: 'GchcoXML',
  fabricApi: 'P7dR8mSH',
  qfapi: 'qvIfYCYJ',
};

export interface ResolveOptions {
  preferSource: Source;
  log?: (level: 'info' | 'ok' | 'warn' | 'error', text: string) => void;
  signal?: AbortSignal;
}

/** Выбор лучшей версии: свежий релиз, иначе бета/альфа (с предупреждением). */
export function chooseFile(files: ModFile[], allowBeta: boolean, preferLoader?: string): { file?: ModFile; warning?: string } {
  if (!files.length) return {};
  const sorted = [...files].sort((a, b) => {
    if (preferLoader) {
      const pa = a.loaders.includes(preferLoader) ? 1 : 0;
      const pb = b.loaders.includes(preferLoader) ? 1 : 0;
      if (pa !== pb && a.published.slice(0, 7) === b.published.slice(0, 7)) return pb - pa;
    }
    return b.published.localeCompare(a.published);
  });
  const ok = sorted.find((f) => f.channel === 'release' || (allowBeta && f.channel === 'beta'));
  if (ok) return { file: ok };
  const beta = sorted.find((f) => f.channel === 'beta');
  if (beta) return { file: beta, warning: 'нет релизной версии — взята бета' };
  return { file: sorted[0], warning: 'нет релизной версии — взята альфа' };
}

interface Meta {
  slug: string;
  title: string;
  author: string;
  iconUrl?: string;
  clientSide?: string;
}

export class Resolver {
  private mrMeta = new Map<string, Meta>();
  private cfMeta = new Map<string, Meta>();
  private mrVersionProject = new Map<string, string>();
  /** Зависимости, которые не нужно подтягивать (метаданные указывают их для другого загрузчика). */
  readonly skip = new Set<string>();

  constructor(private opts: ResolveOptions) {}

  private log(level: 'info' | 'ok' | 'warn' | 'error', text: string) {
    this.opts.log?.(level, text);
  }

  /** Все совместимые файлы для записи. */
  async compatibleFiles(pack: Pack, entry: PackEntry): Promise<ModFile[]> {
    const { mcVersion, loader } = pack;
    if (entry.source === 'modrinth') {
      const loaders = mr.mrLoadersFor(loader, entry.kind);
      let versions = await mr.getVersions(entry.projectId, { loaders, gameVersions: [mcVersion] });
      if (!versions.length && entry.kind !== 'mod') {
        // ресурспаки и шейдеры часто не помечены точной версией игры
        versions = await mr.getVersions(entry.projectId, { loaders });
      }
      return versions.map(mr.versionToFile);
    }
    if (entry.kind === 'mod') {
      let files = await cf.getFiles(entry.projectId, mcVersion, cf.LOADER_TYPES[loader]);
      if (!files.length && loader === 'quilt') files = await cf.getFiles(entry.projectId, mcVersion, cf.LOADER_TYPES.fabric);
      const mf = files
        .filter((f) => f.isAvailable !== false)
        .map(cf.fileToModFile)
        .filter((f) => f.gameVersions.includes(mcVersion));
      // Файл должен быть помечен нашим загрузчиком (или не помечен вовсе)
      const accepted = loader === 'quilt' ? ['quilt', 'fabric'] : [loader];
      return mf.filter((f) => !f.loaders.length || f.loaders.some((l) => accepted.includes(l)));
    }
    let files = await cf.getFiles(entry.projectId, mcVersion);
    if (!files.length) files = await cf.getFiles(entry.projectId);
    return files.filter((f) => f.isAvailable !== false).map(cf.fileToModFile);
  }

  private async pinnedFile(entry: PackEntry): Promise<ModFile | undefined> {
    if (!entry.pinnedVersionId) return undefined;
    if (entry.source === 'modrinth') return mr.versionToFile(await mr.getVersion(entry.pinnedVersionId));
    return cf.fileToModFile(await cf.getFile(entry.projectId, entry.pinnedVersionId));
  }

  private async loadMeta(entries: PackEntry[]) {
    const mrIds = entries.filter((e) => e.source === 'modrinth' && !this.mrMeta.has(e.projectId)).map((e) => e.projectId);
    const cfIds = entries.filter((e) => e.source === 'curseforge' && !this.cfMeta.has(e.projectId)).map((e) => e.projectId);
    if (mrIds.length) {
      for (const p of await mr.getProjects(mrIds)) {
        this.mrMeta.set(p.id, { slug: p.slug, title: p.title, author: '', iconUrl: p.icon_url || undefined, clientSide: p.client_side });
      }
    }
    if (cfIds.length) {
      for (const m of await cf.getMods(cfIds)) {
        this.cfMeta.set(String(m.id), {
          slug: m.slug,
          title: m.name,
          author: m.authors?.[0]?.name ?? '',
          iconUrl: m.logo?.thumbnailUrl || undefined,
        });
      }
    }
  }

  private meta(e: { source: Source; projectId: string }): Meta | undefined {
    return e.source === 'modrinth' ? this.mrMeta.get(e.projectId) : this.cfMeta.get(e.projectId);
  }

  private async projectIdOfVersion(versionId: string): Promise<string> {
    let p = this.mrVersionProject.get(versionId);
    if (!p) {
      p = (await mr.getVersion(versionId)).project_id;
      this.mrVersionProject.set(versionId, p);
    }
    return p;
  }

  async resolve(input: Pack): Promise<ResolveResult> {
    const pack: Pack = structuredClone(input);
    const issues: Issue[] = [];
    const added: PackEntry[] = [];

    // Зависимости пересчитываются заново; «auto» и пользовательские записи сохраняются.
    const previousDeps = new Map(pack.entries.filter((e) => e.addedBy === 'dependency').map((e) => [e.key, e]));
    const entries = new Map<string, PackEntry>();
    for (const e of pack.entries) {
      if (e.addedBy !== 'dependency') entries.set(e.key, { ...e, requiredBy: e.addedBy === 'user' ? [] : e.requiredBy });
    }

    // Шейдеры требуют Iris/Oculus
    const hasShaders = [...entries.values()].some((e) => e.kind === 'shader' && e.enabled);
    if (hasShaders) {
      const shaderMod = pack.loader === 'forge' ? KNOWN.oculus : KNOWN.iris;
      const k = entryKey('modrinth', shaderMod);
      const alreadyIris = [...entries.values()].some((e) => /^(iris|oculus)/i.test(e.slug));
      if (!entries.has(k) && !alreadyIris) {
        const e: PackEntry = {
          key: k,
          source: 'modrinth',
          projectId: shaderMod,
          slug: pack.loader === 'forge' ? 'oculus' : 'iris',
          title: pack.loader === 'forge' ? 'Oculus' : 'Iris Shaders',
          author: '',
          kind: 'mod',
          addedBy: 'auto',
          requiredBy: [],
          reason: 'Нужен для загрузки шейдеров',
          enabled: true,
        };
        entries.set(k, e);
        added.push(e);
        this.log('info', `Добавлен ${e.title} — без него шейдеры не работают`);
      }
    }

    const resolved = new Map<string, ResolvedEntry>();
    const queue = [...entries.values()].filter((e) => e.enabled);
    const incompatible: { from: string; key: string }[] = [];

    while (queue.length) {
      if (this.opts.signal?.aborted) throw new Error('Отменено');
      const batch = queue.splice(0, queue.length);
      await this.loadMeta(batch).catch(() => undefined);

      await Promise.all(
        batch.map(async (entry) => {
          const meta = this.meta(entry);
          if (meta) {
            entry.slug = meta.slug || entry.slug;
            entry.title = meta.title || entry.title;
            entry.iconUrl = entry.iconUrl ?? meta.iconUrl;
            if (meta.author) entry.author = meta.author;
          }
          if (meta?.clientSide === 'unsupported' && entry.kind === 'mod') {
            issues.push({
              level: 'warning',
              title: `${entry.title} — только для сервера`,
              detail: 'Мод не работает на клиенте и не будет установлен в сборку.',
              entryKey: entry.key,
            });
            resolved.set(entry.key, { entry, identity: entry.key });
            return;
          }

          let file: ModFile | undefined;
          try {
            file = await this.pinnedFile(entry);
            if (!file) {
              const files = await this.compatibleFiles(pack, entry);
              const pick = chooseFile(files, pack.allowBeta, pack.loader === 'quilt' ? 'quilt' : undefined);
              file = pick.file;
              if (pick.warning && file) {
                issues.push({ level: 'info', title: `${entry.title}: ${pick.warning}`, entryKey: entry.key });
              }
            }
          } catch (e) {
            issues.push({
              level: 'error',
              title: `${entry.title}: не удалось получить версии`,
              detail: (e as Error).message,
              entryKey: entry.key,
            });
          }

          if (!file) {
            if (!issues.some((i) => i.entryKey === entry.key)) {
              issues.push({
                level: 'error',
                title: `${entry.title} — нет версии для ${pack.mcVersion} / ${pack.loader}`,
                detail: 'Удалите мод из сборки или выберите другую версию игры/загрузчика.',
                entryKey: entry.key,
                code: 'no-version',
              });
            }
            resolved.set(entry.key, { entry, identity: entry.key });
            return;
          }

          resolved.set(entry.key, { entry, file, identity: entry.source === 'modrinth' ? `mr:${entry.projectId}` : entry.key });
          this.log('info', `${entry.title} → ${file.versionName}`);

          for (const dep of file.dependencies) {
            if (dep.type === 'embedded' || dep.type === 'optional') continue;
            let projectId = dep.projectId;
            if (!projectId && dep.versionId && dep.source === 'modrinth') {
              projectId = await this.projectIdOfVersion(dep.versionId).catch(() => undefined);
            }
            if (!projectId) continue;
            const key = entryKey(dep.source, projectId);
            if (dep.type === 'incompatible') {
              incompatible.push({ from: entry.key, key });
              continue;
            }
            if (this.skip.has(key)) continue;
            const existing = entries.get(key);
            if (existing) {
              if (!existing.requiredBy.includes(entry.key)) existing.requiredBy.push(entry.key);
              if (!existing.enabled && existing.addedBy !== 'user') existing.enabled = true;
              continue;
            }
            const prev = previousDeps.get(key);
            const depEntry: PackEntry = {
              key,
              source: dep.source,
              projectId,
              slug: prev?.slug ?? '',
              title: prev?.title ?? projectId,
              author: prev?.author ?? '',
              iconUrl: prev?.iconUrl,
              kind: 'mod',
              pinnedVersionId: prev?.pinnedVersionId,
              addedBy: 'dependency',
              requiredBy: [entry.key],
              enabled: true,
            };
            entries.set(key, depEntry);
            if (!prev) added.push(depEntry);
            queue.push(depEntry);
          }
        }),
      );
    }

    await this.dedupe(entries, resolved, issues);

    for (const inc of incompatible) {
      if (!resolved.has(inc.from)) continue;
      const other = resolved.get(inc.key) ?? [...resolved.values()].find((r) => r.identity === `mr:${inc.key.split(':')[1]}`);
      if (other?.file && other.entry.enabled) {
        const a = entries.get(inc.from)!;
        issues.push({
          level: 'error',
          title: `Конфликт: ${a.title} несовместим с ${other.entry.title}`,
          detail: 'Уберите один из модов из сборки.',
          entryKey: inc.from,
        });
      }
    }

    // Подтягиваем названия для новых зависимостей
    await this.loadMeta([...entries.values()]).catch(() => undefined);
    for (const e of entries.values()) {
      const m = this.meta(e);
      if (m) {
        e.slug = m.slug || e.slug;
        e.title = m.title || e.title;
        e.iconUrl = e.iconUrl ?? m.iconUrl;
        if (m.author) e.author = m.author;
      }
    }

    // Зависимости без «родителей» (пользователь удалил мод) выкидываем
    for (const [k, e] of entries) {
      if (e.addedBy === 'dependency' && !e.requiredBy.some((r) => entries.has(r))) {
        entries.delete(k);
        resolved.delete(k);
      }
    }

    pack.entries = [...entries.values()];
    const out = [...resolved.values()].filter((r) => entries.has(r.entry.key));
    return { pack, resolved: out, issues, added: added.filter((a) => entries.has(a.key)) };
  }

  /**
   * Один и тот же мод может прийти с CurseForge и с Modrinth.
   * Сопоставляем по sha1 через Modrinth API и по slug, оставляем один экземпляр.
   */
  private async dedupe(entries: Map<string, PackEntry>, resolved: Map<string, ResolvedEntry>, issues: Issue[]) {
    const cfWithHash = [...resolved.values()].filter((r) => r.entry.source === 'curseforge' && r.file?.sha1);
    if (cfWithHash.length) {
      try {
        const byHash = await mr.versionsByHashes(cfWithHash.map((r) => r.file!.sha1!));
        for (const r of cfWithHash) {
          const v = byHash[r.file!.sha1!];
          if (v) {
            r.identity = `mr:${v.project_id}`;
            // Если предпочтителен Modrinth и это зависимость — переключаем на тот же файл с Modrinth
            if (this.opts.preferSource === 'modrinth' && r.entry.addedBy === 'dependency') {
              r.file = { ...mr.versionToFile(v), dependencies: r.file!.dependencies };
            }
          }
        }
      } catch {
        /* не критично */
      }
    }

    // запасной вариант: совпадение slug и названия у проектов из разных источников
    const withFiles = [...resolved.values()].filter((r) => r.file && r.entry.slug);
    for (const r of withFiles) {
      for (const o of withFiles) {
        if (
          o !== r &&
          o.entry.source !== r.entry.source &&
          o.identity !== r.identity &&
          o.entry.kind === r.entry.kind &&
          o.entry.slug.toLowerCase() === r.entry.slug.toLowerCase() &&
          o.entry.title.toLowerCase() === r.entry.title.toLowerCase()
        ) {
          o.identity = r.identity;
        }
      }
    }

    const groups = new Map<string, ResolvedEntry[]>();
    for (const r of resolved.values()) {
      if (!r.file) continue;
      const g = groups.get(r.identity) ?? [];
      g.push(r);
      groups.set(r.identity, g);
    }

    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const rank = (r: ResolvedEntry) =>
        (r.entry.addedBy === 'user' ? 100 : r.entry.addedBy === 'auto' ? 50 : 0) +
        (r.entry.source === this.opts.preferSource ? 10 : 0) +
        (r.entry.pinnedVersionId ? 5 : 0);
      g.sort((a, b) => rank(b) - rank(a));
      const [keep, ...drop] = g;
      for (const d of drop) {
        for (const parent of d.entry.requiredBy) {
          if (!keep.entry.requiredBy.includes(parent)) keep.entry.requiredBy.push(parent);
        }
        resolved.delete(d.entry.key);
        entries.delete(d.entry.key);
        if (d.entry.addedBy === 'user') {
          issues.push({
            level: 'fixed',
            title: `Дубликат убран: ${d.entry.title}`,
            detail: `Этот мод уже есть в сборке из ${keep.entry.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}.`,
          });
        }
      }
    }
  }
}
