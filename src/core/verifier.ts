import { inspectJar, type JarDependency, type JarInfo } from './jarinspect';
import { matchesFabric, matchesMaven } from './versionrange';
import type { Issue, Loader } from '../shared/types';

export interface JarInput {
  key: string;
  title: string;
  path: string;
  addedBy: 'user' | 'dependency' | 'auto';
}

export interface VerifyContext {
  mcVersion: string;
  loader: Loader;
  loaderVersion: string;
  javaMajor: number;
}

export interface MissingDep {
  id: string;
  range?: string | string[];
  neededBy: string[];
}

/**
 * Конфликт версий, который можно попробовать исправить подбором другой версии
 * одного из участников: `a` (с проверкой okA для файла-кандидата) или `b`.
 */
export interface Conflict {
  title: string;
  a: string;
  okA: (info: JarInfo) => boolean;
  b?: string;
  okB?: (info: JarInfo) => boolean;
  /** С какой стороны пробовать сначала */
  preferB?: boolean;
}

export interface VerifyResult {
  issues: Issue[];
  conflicts: Conflict[];
  missing: MissingDep[];
  /** Ключи записей, которые нужно убрать (дубликаты одного и того же мода). */
  duplicates: string[];
  infos: Map<string, JarInfo>;
}

/** Идентификаторы, которые предоставляет сам загрузчик/игра. */
export function builtinIds(loader: Loader): Set<string> {
  const base = ['minecraft', 'java', 'mixinextras'];
  switch (loader) {
    case 'fabric':
      return new Set([...base, 'fabricloader', 'fabric-loader']);
    case 'quilt':
      return new Set([...base, 'fabricloader', 'fabric-loader', 'quilt_loader']);
    case 'forge':
      return new Set([...base, 'forge', 'fml', 'javafml', 'lowcodefml', 'mcp']);
    case 'neoforge':
      return new Set([...base, 'neoforge', 'forge', 'fml', 'javafml', 'lowcodefml']);
  }
}

const PLATFORM_OK: Record<Loader, JarInfo['platform'][]> = {
  fabric: ['fabric'],
  quilt: ['quilt', 'fabric'],
  forge: ['forge'],
  neoforge: ['neoforge', 'forge'],
};

function rangeOk(version: string, dep: JarDependency): boolean {
  if (!dep.range || !version) return true;
  return dep.rangeKind === 'fabric'
    ? matchesFabric(version, dep.range)
    : matchesMaven(version, dep.range as string, { lenientUpper: true });
}

function fmtRange(r?: string | string[]) {
  if (!r) return '';
  return Array.isArray(r) ? r.join(' | ') : r;
}

function ours(info: JarInfo, loader: Loader) {
  return info.topLevel.filter((m) => PLATFORM_OK[loader].includes(m.platform));
}

/** Версия мода с данным id (или provides) внутри JAR, если он там есть. */
export function versionOf(info: JarInfo, id: string, loader: Loader): string | undefined {
  const m = info.mods.find((x) => PLATFORM_OK[loader].includes(x.platform) && (x.id === id || x.provides.includes(id)));
  return m?.version;
}

export function verifyJars(jars: JarInput[], ctx: VerifyContext): VerifyResult {
  const issues: Issue[] = [];
  const conflicts: Conflict[] = [];
  const infos = new Map<string, JarInfo>();
  const builtin = builtinIds(ctx.loader);

  // id -> версия и откуда
  const provided = new Map<string, { version: string; key: string }>();
  const topOwner = new Map<string, JarInput[]>();

  for (const jar of jars) {
    const info = inspectJar(jar.path);
    infos.set(jar.key, info);
    if (info.platform === 'unknown' && info.mods.length) {
      // «Контейнер»: снаружи нет манифеста, моды лежат во вложенных JAR (так устроен Kotlin for Forge)
    } else if (info.platform === 'unknown') {
      issues.push({
        level: 'info',
        title: `${jar.title}: не найден манифест мода`,
        detail: 'Возможно, это библиотека или мод старого формата. Проверка зависимостей для него пропущена.',
        entryKey: jar.key,
      });
      continue;
    }
    const hasOurs =
      info.platforms.some((p) => PLATFORM_OK[ctx.loader].includes(p)) ||
      (info.platform === 'unknown' && info.mods.some((m) => PLATFORM_OK[ctx.loader].includes(m.platform)));
    if (!hasOurs) {
      issues.push({
        level: 'error',
        title: `${jar.title} собран под ${info.platforms.join('/')}, а сборка на ${ctx.loader}`,
        detail: 'Файл помечен на сайте неправильно. Выберите другую версию мода или удалите его.',
        entryKey: jar.key,
      });
      conflicts.push({
        title: `${jar.title}: файл не для ${ctx.loader}`,
        a: jar.key,
        okA: (i) => i.platforms.some((p) => PLATFORM_OK[ctx.loader].includes(p)),
      });
    }
    for (const m of info.mods) {
      if (!PLATFORM_OK[ctx.loader].includes(m.platform)) continue;
      if (!provided.has(m.id)) provided.set(m.id, { version: m.version, key: jar.key });
      for (const p of m.provides) if (!provided.has(p)) provided.set(p, { version: m.version, key: jar.key });
    }
    for (const m of info.topLevel) {
      if (!PLATFORM_OK[ctx.loader].includes(m.platform)) continue;
      const list = topOwner.get(m.id) ?? [];
      list.push(jar);
      topOwner.set(m.id, list);
    }
  }

  // Дубликаты: один и тот же modId на верхнем уровне в разных файлах — игра упадёт
  const duplicates: string[] = [];
  for (const [id, owners] of topOwner) {
    if (owners.length < 2 || builtin.has(id)) continue;
    const rank = (j: JarInput) => (j.addedBy === 'user' ? 2 : j.addedBy === 'auto' ? 1 : 0);
    const sorted = [...owners].sort((a, b) => rank(b) - rank(a));
    for (const d of sorted.slice(1)) {
      if (!duplicates.includes(d.key)) duplicates.push(d.key);
    }
    issues.push({
      level: 'fixed',
      title: `Мод «${id}» был в сборке дважды`,
      detail: `Оставлен ${sorted[0].title}, лишние копии убраны.`,
    });
  }

  const missing = new Map<string, MissingDep>();
  for (const jar of jars) {
    if (duplicates.includes(jar.key)) continue;
    const info = infos.get(jar.key);
    if (!info) continue;
    for (const m of info.topLevel) {
      if (!PLATFORM_OK[ctx.loader].includes(m.platform)) continue;
      for (const dep of m.deps) {
        if (dep.side === 'SERVER') continue;
        const id = dep.id;
        if (dep.kind === 'incompatible') {
          const other = provided.get(id);
          if (other && other.key !== jar.key && rangeOk(other.version, { ...dep, range: dep.range ?? '*' })) {
            const otherTitle = jars.find((j) => j.key === other.key)?.title ?? id;
            issues.push({
              level: 'error',
              title: `Конфликт: ${jar.title} несовместим с ${otherTitle} ${other.version}`,
              detail: `${jar.title} запрещает «${id}» ${fmtRange(dep.range)}. Удалите один из модов.`,
              entryKey: jar.key,
            });
            const breaksOk = (i: JarInfo) =>
              !ours(i, ctx.loader).some((mm) =>
                mm.deps.some((d) => d.kind === 'incompatible' && d.id === id && rangeOk(other.version, { ...d, range: d.range ?? '*' })),
              );
            conflicts.push({
              title: `${jar.title} ↔ ${otherTitle}`,
              a: jar.key,
              okA: breaksOk,
              b: other.key,
              okB: (i) => {
                const v = versionOf(i, id, ctx.loader);
                return !!v && !rangeOk(v, { ...dep, range: dep.range ?? '*' });
              },
            });
          }
          continue;
        }
        if (dep.kind !== 'required') continue;

        if (id === 'minecraft') {
          if (!rangeOk(ctx.mcVersion, dep)) {
            issues.push({
              level: 'error',
              title: `${jar.title} требует Minecraft ${fmtRange(dep.range)}`,
              detail: `В сборке Minecraft ${ctx.mcVersion}. Выберите другую версию мода.`,
              entryKey: jar.key,
            });
            conflicts.push({
              title: `${jar.title}: версия Minecraft`,
              a: jar.key,
              okA: (i) =>
                !ours(i, ctx.loader).some((mm) => mm.deps.some((d) => d.kind === 'required' && d.id === 'minecraft' && !rangeOk(ctx.mcVersion, d))),
            });
          }
          continue;
        }
        if (id === 'java') {
          const ok = rangeOk(String(ctx.javaMajor), dep);
          if (!ok) {
            issues.push({
              level: 'warning',
              title: `${jar.title} требует Java ${fmtRange(dep.range)}`,
              detail: `Minecraft ${ctx.mcVersion} по умолчанию запускается на Java ${ctx.javaMajor}. В профиле лаунчера может понадобиться другая Java.`,
              entryKey: jar.key,
            });
          }
          continue;
        }
        if (['fabricloader', 'fabric-loader', 'quilt_loader', 'forge', 'neoforge'].includes(id)) {
          const relevant =
            (ctx.loader === 'fabric' && id.startsWith('fabric')) ||
            (ctx.loader === 'quilt' && id === 'quilt_loader') ||
            (ctx.loader === 'forge' && id === 'forge') ||
            (ctx.loader === 'neoforge' && id === 'neoforge');
          if (relevant && !rangeOk(ctx.loaderVersion, dep)) {
            issues.push({
              level: 'error',
              title: `${jar.title} требует ${id} ${fmtRange(dep.range)}`,
              detail: `Выбран загрузчик ${ctx.loaderVersion}. Поставьте «последняя версия» загрузчика в настройках сборки.`,
              entryKey: jar.key,
            });
          }
          continue;
        }
        if (builtin.has(id)) continue;

        const have = provided.get(id) ?? (id === 'fabric' ? provided.get('fabric-api') : undefined);
        if (have) {
          if (!rangeOk(have.version, dep) && !/\$\{/.test(have.version)) {
            const provTitle = jars.find((j) => j.key === have.key)?.title ?? id;
            issues.push({
              level: 'error',
              title: `${jar.title} требует ${provTitle} ${fmtRange(dep.range)}, а в сборке ${have.version}`,
              detail: 'Игра не запустится с такими версиями. Закрепите подходящую версию одного из модов.',
              entryKey: jar.key,
            });
            if (have.key !== jar.key) {
              conflicts.push({
                title: `${jar.title} → ${provTitle}`,
                a: jar.key,
                okA: (i) =>
                  !ours(i, ctx.loader).some((mm) => mm.deps.some((d) => d.kind === 'required' && d.id === id && !rangeOk(have.version, d))),
                b: have.key,
                okB: (i) => {
                  const v = versionOf(i, id, ctx.loader);
                  return !!v && rangeOk(v, dep);
                },
                preferB: true,
              });
            }
          }
          continue;
        }
        const md = missing.get(id) ?? { id, range: dep.range, neededBy: [] };
        if (!md.neededBy.includes(jar.title)) md.neededBy.push(jar.title);
        missing.set(id, md);
      }
    }
  }

  return { issues, conflicts, missing: [...missing.values()], duplicates, infos };
}

/** Псевдонимы mod id → slug на Modrinth для частых библиотек. */
export const MODID_ALIASES: Record<string, string[]> = {
  fabric: ['fabric-api'],
  'fabric-api': ['fabric-api'],
  'fabric-api-base': ['fabric-api'],
  'fabric-language-kotlin': ['fabric-language-kotlin'],
  kotlinforforge: ['kotlin-for-forge'],
  sophisticatedbackpacks: ['sophisticated-backpacks'],
  sophisticatedstorage: ['sophisticated-storage'],
  sophisticatedcore: ['sophisticated-core'],
  'cloth-config': ['cloth-config'],
  'cloth-config2': ['cloth-config'],
  cloth_config: ['cloth-config'],
  architectury: ['architectury-api'],
  owo: ['owo-lib'],
  yet_another_config_lib_v3: ['yacl'],
  yet_another_config_lib: ['yacl'],
  modmenu: ['modmenu'],
  geckolib: ['geckolib'],
  geckolib3: ['geckolib'],
  playeranimator: ['playeranimator'],
  player_animator: ['playeranimator'],
  bookshelf: ['bookshelf-lib'],
  balm: ['balm'],
  puzzleslib: ['puzzles-lib'],
  forgeconfigapiport: ['forge-config-api-port'],
  cardinal_components: ['cardinal-components-api'],
  'cardinal-components': ['cardinal-components-api'],
  trinkets: ['trinkets'],
  curios: ['curios'],
  resourcefullib: ['resourceful-lib'],
  resourcefulconfig: ['resourceful-config'],
  lithostitched: ['lithostitched'],
  terrablender: ['terrablender'],
  cristellib: ['cristel-lib'],
  midnightlib: ['midnightlib'],
  collective: ['collective'],
  jei: ['jei'],
  rei: ['rei'],
  roughlyenoughitems: ['rei'],
  sodium: ['sodium'],
  iris: ['iris'],
  indium: ['indium'],
  supermartijn642corelib: ['supermartijn642s-core-lib'],
  supermartijn642configlib: ['supermartijn642s-config-lib'],
  creativecore: ['creativecore'],
  moonlight: ['moonlight'],
  zeta: ['zeta'],
  fzzy_config: ['fzzy-config'],
  libipn: ['libipn'],
  azurelib: ['azurelib'],
  citadel: ['citadel'],
  quilted_fabric_api: ['qsl'],
  qsl: ['qsl'],
  ftblibrary: ['ftb-library'],
  ftbteams: ['ftb-teams'],
  placeholder_api: ['placeholder-api'],
  'placeholder-api': ['placeholder-api'],
  kirin: ['kirin'],
  coroutil: ['coroutil'],
  silk: ['silk'],
  libjf: ['libjf'],
  completeconfig: ['completeconfig'],
  'reach-entity-attributes': ['reach-entity-attributes'],
  structure_gel: ['structure-gel-api'],
  prism: ['prism-lib'],
  attributefix: ['attributefix'],
  smartbrainlib: ['smartbrainlib'],
  framework: ['framework'],
  configured: ['configured'],
  catalogue: ['catalogue'],
  uranus: ['uranus'],
  cobblemon: ['cobblemon'],
  iceberg: ['iceberg'],
  fabric_language_kotlin: ['fabric-language-kotlin'],
};

/** Кандидаты slug/запросов для поиска отсутствующего мода по его mod id. */
export function candidateSlugs(id: string): string[] {
  const out = new Set<string>(MODID_ALIASES[id] ?? []);
  out.add(id);
  out.add(id.replace(/_/g, '-'));
  out.add(id.replace(/-/g, '_'));
  out.add(id.replace(/_/g, ''));
  // слитные id («sophisticatedbackpacks») — пробуем все разбиения на два слова через дефис
  if (/^[a-z0-9]+$/.test(id) && id.length >= 8) {
    for (let i = 3; i <= id.length - 3; i++) out.add(`${id.slice(0, i)}-${id.slice(i)}`);
  }
  return [...out];
}
