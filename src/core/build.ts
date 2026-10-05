import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { downloadFile, pool } from './http';
import * as mr from './modrinth';
import * as cf from './curseforge';
import { Resolver, chooseFile, entryKey } from './resolver';
import { verifyJars, candidateSlugs, type JarInput } from './verifier';
import { inspectJar, type JarInfo } from './jarinspect';
import { pickLoaderVersion, requiredJava } from './loaders';
import { ensureJava } from './java';
import { installOfficial, type InstallFile } from './install/official';
import { installPrism, exportPrismZip } from './install/prism';
import { exportMrpack, exportCurseforgeZip, type ArchiveFile } from './install/archives';
import { safeName } from './paths';
import { resolveWithFixes } from './replace';
import { effectiveCfKey } from './builtin';
import { KIND_DIRS } from '../shared/types';
import type {
  BuildLog,
  BuildOutput,
  BuildProgress,
  BuildReport,
  BuildTarget,
  Issue,
  ModFile,
  Pack,
  PackEntry,
  ResolvedEntry,
  Settings,
} from '../shared/types';

export interface BuildContext {
  pack: Pack;
  settings: Settings;
  targets: BuildTarget[];
  appDir: string;
  cacheDir: string;
  exportDir: string;
  onProgress: (p: BuildProgress) => void;
  onLog: (l: BuildLog) => void;
  savePack: (p: Pack) => Promise<void>;
  signal: AbortSignal;
}

interface Local {
  entry: PackEntry;
  file: ModFile;
  src: string;
}

export function cachePath(cacheDir: string, file: ModFile) {
  const id = file.sha1 ?? createHash('sha1').update(file.url).digest('hex');
  return join(cacheDir, 'files', id.slice(0, 2), id, file.fileName);
}

export async function buildPack(ctx: BuildContext): Promise<BuildReport> {
  const started = Date.now();
  const issues: Issue[] = [];
  const outputs: BuildOutput[] = [];
  const log = (level: BuildLog['level'], text: string) => ctx.onLog({ t: Date.now(), level, text });
  const progress = (p: BuildProgress) => ctx.onProgress(p);
  const check = () => {
    if (ctx.signal.aborted) throw new Error('Сборка отменена');
  };
  let pack = ctx.pack;
  let totalBytes = 0;
  let loaderVersion = pack.loaderVersion;

  const fail = (): BuildReport => ({
    ok: false,
    finishedAt: Date.now(),
    durationMs: Date.now() - started,
    modCount: pack.entries.filter((e) => e.enabled).length,
    totalBytes,
    issues,
    outputs,
    loaderVersion,
  });

  cf.setApiKey(effectiveCfKey(ctx.settings.curseforgeApiKey));
  const resolver = new Resolver({
    preferSource: ctx.settings.preferSource,
    log: (l, t) => log(l, t),
    signal: ctx.signal,
  });

  /* 1. Разрешение зависимостей */
  progress({ stage: 'resolve', message: 'Проверяю версии и зависимости', progress: 0 });
  log('info', `Сборка «${pack.name}»: Minecraft ${pack.mcVersion}, ${pack.loader}`);
  const [lv, javaMajor] = await Promise.all([
    pickLoaderVersion(pack.loader, pack.mcVersion, pack.loaderVersion),
    requiredJava(pack.mcVersion),
  ]);
  loaderVersion = lv;
  log('ok', `Загрузчик: ${pack.loader} ${loaderVersion} · Java ${javaMajor}`);

  let res = await resolveWithFixes(resolver, pack, (l, t) => log(l, t));
  pack = res.pack;
  await ctx.savePack(pack);
  for (const a of res.added) log('info', `+ ${a.title} (${a.reason ?? 'зависимость'})`);
  issues.push(...res.issues);
  if (res.issues.some((i) => i.level === 'error')) {
    log('error', 'Есть моды без подходящих версий или конфликты — исправьте их и запустите сборку снова');
    return fail();
  }
  progress({ stage: 'resolve', message: 'Зависимости разрешены', progress: 1 });

  /* 2. Загрузка */
  const locals = new Map<string, Local>();
  const download = async (list: ResolvedEntry[]) => {
    const todo = list.filter((r) => r.file && locals.get(r.entry.key)?.file.versionId !== r.file.versionId) as (ResolvedEntry & { file: ModFile })[];
    const bytesTotal = todo.reduce((s, r) => s + r.file.size, 0);
    let bytesDone = 0;
    let done = 0;
    progress({ stage: 'download', message: `Скачиваю ${todo.length} файлов`, progress: 0, bytesDone, bytesTotal });
    await pool(todo, ctx.settings.concurrency || 6, async (r) => {
      check();
      const dest = cachePath(ctx.cacheDir, r.file);
      if (!existsSync(dest)) {
        try {
          await downloadFile(r.file.url, dest, {
            sha1: r.file.sha1,
            signal: ctx.signal,
            onBytes: (n) => {
              bytesDone += n;
              progress({
                stage: 'download',
                message: r.entry.title,
                progress: bytesTotal ? bytesDone / bytesTotal : done / todo.length,
                bytesDone,
                bytesTotal,
              });
            },
          });
        } catch (e) {
          // запасной CDN для CurseForge
          if (r.file.source === 'curseforge' && !r.file.url.includes('edge.forgecdn.net')) {
            const alt = cf.edgeUrl({ id: Number(r.file.versionId), fileName: r.file.fileName });
            await downloadFile(alt, dest, { sha1: r.file.sha1, signal: ctx.signal });
          } else throw e;
        }
      } else {
        bytesDone += r.file.size;
      }
      done++;
      locals.set(r.entry.key, { entry: r.entry, file: r.file, src: dest });
      progress({
        stage: 'download',
        message: r.entry.title,
        progress: bytesTotal ? bytesDone / bytesTotal : done / todo.length,
        bytesDone,
        bytesTotal,
      });
    });
    totalBytes += bytesTotal;
  };
  await download(res.resolved);
  log('ok', `Файлы загружены (${locals.size})`);

  /* 3. Проверка JAR */
  const tried = new Set<string>();
  const triedFix = new Set<string>();
  let verified = false;
  const ROUNDS = 8;
  for (let round = 0; round < ROUNDS; round++) {
    check();
    progress({ stage: 'verify', message: 'Проверяю, что все моды запустятся вместе', progress: round / ROUNDS });
    const jars: JarInput[] = [...locals.values()]
      .filter((l) => l.entry.kind === 'mod' && pack.entries.some((e) => e.key === l.entry.key && e.enabled))
      .map((l) => ({ key: l.entry.key, title: l.entry.title, path: l.src, addedBy: l.entry.addedBy }));
    const vr = verifyJars(jars, { mcVersion: pack.mcVersion, loader: pack.loader, loaderVersion, javaMajor });

    for (const dup of vr.duplicates) {
      locals.delete(dup);
      const e = pack.entries.find((x) => x.key === dup);
      if (e && e.addedBy !== 'user') pack.entries = pack.entries.filter((x) => x.key !== dup);
      else if (e) e.enabled = false;
    }

    const missing = vr.missing.filter((m) => !tried.has(m.id));
    const conflicts = vr.conflicts.filter((c) => !triedFix.has(c.title));
    const isLast = round === ROUNDS - 1;
    if ((!missing.length && !conflicts.length) || isLast) {
      issues.push(...vr.issues.filter((i) => !issues.some((x) => x.title === i.title)));
      for (const m of vr.missing) {
        issues.push({
          level: 'error',
          title: `Не найдена зависимость «${m.id}»`,
          detail: `Нужна для: ${m.neededBy.join(', ')}. Найдите и добавьте её вручную или уберите эти моды.`,
        });
      }
      verified = !isLast || (!missing.length && !conflicts.length);
      break;
    }

    let changed = false;
    if (missing.length) {
      log('warn', `В JAR найдены незаявленные зависимости: ${missing.map((m) => m.id).join(', ')} — ищу и докачиваю`);
      for (const m of missing) {
        tried.add(m.id);
        const found = await findProvider(m.id, pack, resolver, ctx.cacheDir, ctx.signal).catch(() => null);
        if (!found) continue;
        if (pack.entries.some((e) => e.key === found.key)) continue;
        found.reason = `Требуется для ${m.neededBy.slice(0, 3).join(', ')}`;
        pack.entries.push(found);
        log('ok', `+ ${found.title} — ${found.reason}`);
        issues.push({ level: 'fixed', title: `Докачан ${found.title}`, detail: found.reason });
        changed = true;
      }
    }

    // Конфликты версий: подбираем другую версию одного из участников
    const touched = new Set<string>();
    for (const c of conflicts) {
      if (touched.has(c.a) || (c.b && touched.has(c.b))) continue;
      triedFix.add(c.title);
      log('warn', `Конфликт версий: ${c.title} — подбираю совместимую версию`);
      const sides: [string, (i: JarInfo) => boolean][] = [[c.a, c.okA]];
      if (c.b && c.okB) {
        if (c.preferB) sides.unshift([c.b, c.okB]);
        else sides.push([c.b, c.okB]);
      }
      for (const [key, ok] of sides) {
        const entry = pack.entries.find((e) => e.key === key);
        if (!entry || (entry.pinnedVersionId && !entry.autoPinned)) continue;
        const current = locals.get(key)?.file.versionId;
        const alt = await findAlternative(pack, entry, current, ok, resolver, ctx.cacheDir, ctx.signal).catch(() => null);
        if (!alt) continue;
        entry.pinnedVersionId = alt.versionId;
        entry.autoPinned = true;
        touched.add(key);
        log('ok', `${entry.title}: выбрана версия ${alt.versionName}`);
        issues.push({
          level: 'fixed',
          title: `${entry.title} → ${alt.versionName}`,
          detail: `Версия подобрана автоматически, чтобы устранить конфликт (${c.title}).`,
        });
        changed = true;
        break;
      }
    }

    if (changed) {
      res = await resolver.resolve(pack);
      pack = res.pack;
      for (const i of res.issues) if (i.level === 'error') issues.push(i);
      await download(res.resolved);
    }
  }
  await ctx.savePack(pack);
  if (!verified) issues.push({ level: 'warning', title: 'Проверка зависимостей не завершилась полностью' });

  if (issues.some((i) => i.level === 'error')) {
    log('error', 'Проверка нашла проблемы, из-за которых игра не запустится');
    return fail();
  }
  log('ok', 'Проверка пройдена: все зависимости на месте');
  progress({ stage: 'verify', message: 'Проверка пройдена', progress: 1 });

  /* Список файлов для установки */
  const usedNames = new Set<string>();
  const finalFiles: (InstallFile & { file: ModFile })[] = [];
  for (const l of locals.values()) {
    if (!pack.entries.some((e) => e.key === l.entry.key && e.enabled)) continue;
    let name = l.file.fileName;
    const dir = KIND_DIRS[l.entry.kind];
    if (usedNames.has(`${dir}/${name}`)) name = `${l.entry.slug || l.entry.projectId}-${name}`;
    usedNames.add(`${dir}/${name}`);
    finalFiles.push({ path: `${dir}/${name}`, src: l.src, file: l.file });
  }

  /* 4–5. Установка */
  const javaFor = () =>
    ensureJava(javaMajor, ctx.appDir, ctx.settings.javaPath || undefined, () => undefined).then((p) => {
      log('info', `Java: ${p}`);
      return p;
    });

  const steps = ctx.targets.length;
  let step = 0;
  for (const target of ctx.targets) {
    check();
    const stepProgress = (msg: string) =>
      progress({ stage: target === 'official' ? 'loader' : 'install', message: msg, progress: step / steps });
    try {
      if (target === 'official') {
        stepProgress('Устанавливаю загрузчик в официальный лаунчер');
        const r = await installOfficial({
          mcDir: ctx.settings.minecraftDir,
          pack,
          loaderVersion,
          files: finalFiles,
          cacheDir: ctx.cacheDir,
          java: javaFor,
          log,
          signal: ctx.signal,
        });
        outputs.push({ target, path: r.gameDir, note: `Профиль «${pack.name}» · ${r.versionId}` });
      } else if (target === 'prism') {
        stepProgress('Создаю инстанс Prism Launcher');
        if (ctx.settings.prismInstancesDir && existsSync(ctx.settings.prismInstancesDir)) {
          const dir = await installPrism(ctx.settings.prismInstancesDir, pack, loaderVersion, finalFiles);
          outputs.push({ target, path: dir, note: 'Перезапустите Prism, если он открыт' });
          log('ok', `Инстанс Prism создан: ${dir}`);
        } else {
          const dest = join(ctx.exportDir, `${safeName(pack.name)}-prism.zip`);
          await exportPrismZip(dest, pack, loaderVersion, finalFiles);
          outputs.push({ target, path: dest, note: 'Prism не найден — импортируйте zip: «Добавить экземпляр → Импорт»' });
          log('ok', `Архив для Prism: ${dest}`);
        }
      } else if (target === 'mrpack') {
        stepProgress('Упаковываю .mrpack');
        const dest = join(ctx.exportDir, `${safeName(pack.name)}-${pack.version}.mrpack`);
        await exportMrpack(dest, pack, loaderVersion, finalFiles as ArchiveFile[]);
        outputs.push({ target, path: dest });
        log('ok', `Сохранено: ${dest}`);
      } else if (target === 'cfzip') {
        stepProgress('Упаковываю архив CurseForge');
        const dest = join(ctx.exportDir, `${safeName(pack.name)}-${pack.version}-curseforge.zip`);
        await exportCurseforgeZip(dest, pack, loaderVersion, finalFiles as ArchiveFile[]);
        outputs.push({ target, path: dest });
        log('ok', `Сохранено: ${dest}`);
      }
    } catch (e) {
      issues.push({ level: 'error', title: `Не удалось: ${targetName(target)}`, detail: (e as Error).message });
      log('error', (e as Error).message);
    }
    step++;
  }

  const ok = !issues.some((i) => i.level === 'error');
  progress({ stage: 'done', message: ok ? 'Сборка готова к запуску' : 'Сборка завершена с ошибками', progress: 1 });
  log(ok ? 'ok' : 'error', ok ? `Готово за ${((Date.now() - started) / 1000).toFixed(1)} с` : 'Сборка завершена с ошибками');
  return {
    ok,
    finishedAt: Date.now(),
    durationMs: Date.now() - started,
    modCount: finalFiles.length,
    totalBytes: finalFiles.reduce((s, f) => s + f.file.size, 0),
    issues,
    outputs,
    loaderVersion,
  };
}

function targetName(t: BuildTarget) {
  return { official: 'официальный лаунчер', prism: 'Prism Launcher', mrpack: '.mrpack', cfzip: 'архив CurseForge' }[t];
}

/**
 * Ищет мод, который предоставляет нужный mod id: сначала по известным slug на Modrinth,
 * затем поиском. Кандидата скачиваем и проверяем его манифест — берём только точное совпадение.
 */
export async function findProvider(
  modId: string,
  pack: Pack,
  resolver: Resolver,
  cacheDir: string,
  signal?: AbortSignal,
): Promise<PackEntry | null> {
  const candidates: { source: 'modrinth' | 'curseforge'; projectId: string; slug: string; title: string; iconUrl?: string }[] = [];
  const bySlug = await pool(candidateSlugs(modId), 8, (slug) => mr.getProject(slug).catch(() => null));
  for (const p of bySlug) {
    if (p && p.project_type === 'mod' && !candidates.some((c) => c.projectId === p.id)) {
      candidates.push({ source: 'modrinth', projectId: p.id, slug: p.slug, title: p.title, iconUrl: p.icon_url });
    }
  }
  const q = modId.replace(/[_-]+/g, ' ');
  const hits = await mr
    .search({ source: 'modrinth', query: q, kind: 'mod', mcVersion: pack.mcVersion, loader: pack.loader, sort: 'relevance', offset: 0, limit: 5 })
    .catch(() => ({ items: [] }));
  for (const h of hits.items) {
    if (!candidates.some((c) => c.projectId === h.projectId)) candidates.push(h);
  }
  if (cf.hasApiKey()) {
    const cfHits = await cf
      .search({ source: 'curseforge', query: q, kind: 'mod', mcVersion: pack.mcVersion, loader: pack.loader, sort: 'relevance', offset: 0, limit: 5 })
      .catch(() => ({ items: [] }));
    candidates.push(...cfHits.items);
  }

  for (const c of candidates.slice(0, 10)) {
    if (signal?.aborted) return null;
    const entry: PackEntry = {
      key: entryKey(c.source, c.projectId),
      source: c.source,
      projectId: c.projectId,
      slug: c.slug,
      title: c.title,
      author: '',
      iconUrl: c.iconUrl,
      kind: 'mod',
      addedBy: 'auto',
      requiredBy: [],
      enabled: true,
    };
    const files = await resolver.compatibleFiles(pack, entry).catch(() => []);
    const { file } = chooseFile(files, pack.allowBeta, pack.loader === 'quilt' ? 'quilt' : undefined);
    if (!file) continue;
    const dest = cachePath(cacheDir, file);
    if (!existsSync(dest)) {
      try {
        await downloadFile(file.url, dest, { sha1: file.sha1, signal });
      } catch {
        continue;
      }
    }
    const info = inspectJar(dest);
    if (info.mods.some((m) => m.id === modId || m.provides.includes(modId))) return entry;
  }
  return null;
}

/**
 * Перебирает другие совместимые версии мода (от новых к старым) и возвращает первую,
 * JAR которой проходит проверку `ok`.
 */
export async function findAlternative(
  pack: Pack,
  entry: PackEntry,
  currentVersionId: string | undefined,
  ok: (info: JarInfo) => boolean,
  resolver: Resolver,
  cacheDir: string,
  signal?: AbortSignal,
): Promise<ModFile | null> {
  const files = (await resolver.compatibleFiles(pack, entry))
    .filter((f) => f.versionId !== currentVersionId)
    .sort((a, b) => b.published.localeCompare(a.published));
  const ordered = [
    ...files.filter((f) => f.channel === 'release' || (pack.allowBeta && f.channel === 'beta')),
    ...files.filter((f) => !(f.channel === 'release' || (pack.allowBeta && f.channel === 'beta'))),
  ];
  for (const f of ordered.slice(0, 15)) {
    if (signal?.aborted) return null;
    const dest = cachePath(cacheDir, f);
    if (!existsSync(dest)) {
      try {
        await downloadFile(f.url, dest, { sha1: f.sha1, signal });
      } catch {
        continue;
      }
    }
    if (ok(inspectJar(dest))) return f;
  }
  return null;
}
