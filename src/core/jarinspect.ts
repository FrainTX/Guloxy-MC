import AdmZip from 'adm-zip';
import { parse as parseToml } from 'smol-toml';

/** Зависимость, объявленная внутри JAR. */
export interface JarDependency {
  id: string;
  /** Предикат версии: fabric-строка/массив или maven-диапазон */
  range?: string | string[];
  rangeKind: 'fabric' | 'maven';
  kind: 'required' | 'optional' | 'incompatible';
  side?: 'BOTH' | 'CLIENT' | 'SERVER';
}

export interface JarMod {
  platform: 'fabric' | 'quilt' | 'forge' | 'neoforge';
  id: string;
  version: string;
  name?: string;
  provides: string[];
  deps: JarDependency[];
  environment?: string;
}

export interface JarInfo {
  platform: 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'unknown';
  /** Все платформы, чьи манифесты есть в JAR (мультиплатформенные файлы). */
  platforms: ('fabric' | 'quilt' | 'forge' | 'neoforge')[];
  /** Все моды в JAR, включая вложенные (jar-in-jar). */
  mods: JarMod[];
  /** Только моды самого верхнего уровня */
  topLevel: JarMod[];
}

function lenientJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Fabric разрешает «вольный» JSON: комментарии, переводы строк в строках, висячие запятые
    const cleaned = text
      .replace(/^﻿/, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:"'])\/\/.*$/gm, '$1')
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/[\u0000-\u001f]+/g, ' ');
    return JSON.parse(cleaned);
  }
}

function readEntry(zip: AdmZip, name: string): string | null {
  const e = zip.getEntry(name);
  if (!e) return null;
  return e.getData().toString('utf8');
}

function fabricMod(json: Record<string, any>): JarMod {
  const deps: JarDependency[] = [];
  for (const [id, range] of Object.entries((json.depends ?? {}) as Record<string, string | string[]>)) {
    deps.push({ id, range, rangeKind: 'fabric', kind: 'required' });
  }
  for (const [id, range] of Object.entries((json.breaks ?? {}) as Record<string, string | string[]>)) {
    deps.push({ id, range, rangeKind: 'fabric', kind: 'incompatible' });
  }
  return {
    platform: 'fabric',
    id: String(json.id),
    version: String(json.version ?? ''),
    name: json.name,
    provides: Array.isArray(json.provides) ? json.provides.map(String) : [],
    deps,
    environment: json.environment,
  };
}

function quiltMod(json: Record<string, any>): JarMod {
  const ql = json.quilt_loader ?? {};
  const deps: JarDependency[] = [];
  const pushDeps = (arr: unknown[], kind: JarDependency['kind']) => {
    for (const d of arr ?? []) {
      if (typeof d === 'string') deps.push({ id: d.split(':').pop()!, rangeKind: 'fabric', kind });
      else if (d && typeof d === 'object') {
        const o = d as Record<string, any>;
        if (Array.isArray(o.any)) continue; // «любой из» — не проверяем строго
        if (!o.id) continue;
        const k = kind === 'required' && o.optional ? 'optional' : kind;
        deps.push({ id: String(o.id).split(':').pop()!, range: o.versions, rangeKind: 'fabric', kind: k });
      }
    }
  };
  pushDeps(ql.depends, 'required');
  pushDeps(ql.breaks, 'incompatible');
  return {
    platform: 'quilt',
    id: String(ql.id),
    version: String(ql.version ?? ''),
    name: ql.metadata?.name,
    provides: (ql.provides ?? []).map((p: unknown) =>
      typeof p === 'string' ? p.split(':').pop() : String((p as { id: string }).id).split(':').pop(),
    ),
    deps,
    environment: json.minecraft?.environment,
  };
}

function tomlMods(text: string, neo: boolean): JarMod[] {
  const toml = parseToml(text) as Record<string, any>;
  const mods = (toml.mods ?? []) as Record<string, any>[];
  const depsTable = (toml.dependencies ?? {}) as Record<string, Record<string, any>[]>;
  return mods.map((m) => {
    const modId = String(m.modId);
    const deps: JarDependency[] = [];
    for (const d of depsTable[modId] ?? []) {
      let kind: JarDependency['kind'] = 'optional';
      if (typeof d.type === 'string') {
        const t = d.type.toLowerCase();
        kind = t === 'required' ? 'required' : t === 'incompatible' ? 'incompatible' : 'optional';
      } else if (d.mandatory === true) kind = 'required';
      else if (d.mandatory === undefined && !neo) kind = 'required';
      deps.push({
        id: String(d.modId),
        range: d.versionRange,
        rangeKind: 'maven',
        kind,
        side: d.side,
      });
    }
    return { platform: neo ? 'neoforge' : 'forge', id: modId, version: String(m.version ?? ''), name: m.displayName, provides: [], deps } as JarMod;
  });
}

function inspectZip(zip: AdmZip, depth: number, info: JarInfo, top: boolean) {
  const found: JarMod[] = [];
  const fabric = readEntry(zip, 'fabric.mod.json');
  const quilt = readEntry(zip, 'quilt.mod.json');
  const neoToml = readEntry(zip, 'META-INF/neoforge.mods.toml');
  const forgeToml = readEntry(zip, 'META-INF/mods.toml');

  if (quilt) {
    try {
      found.push(quiltMod(lenientJson(quilt) as Record<string, any>));
      if (top) {
        if (info.platform === 'unknown') info.platform = 'quilt';
        info.platforms.push('quilt');
      }
    } catch {
      /* битый манифест — пропускаем */
    }
  }
  if (fabric) {
    try {
      const m = fabricMod(lenientJson(fabric) as Record<string, any>);
      if (!found.some((f) => f.id === m.id)) found.push(m);
      if (top) {
        if (info.platform === 'unknown') info.platform = 'fabric';
        info.platforms.push('fabric');
      }
    } catch {
      /* ignore */
    }
  }
  if (neoToml) {
    try {
      found.push(...tomlMods(neoToml, true));
      if (top) {
        if (info.platform === 'unknown') info.platform = 'neoforge';
        info.platforms.push('neoforge');
      }
    } catch {
      /* ignore */
    }
  }
  if (forgeToml) {
    try {
      for (const m of tomlMods(forgeToml, false)) if (!found.some((f) => f.id === m.id)) found.push(m);
      if (top) {
        if (info.platform === 'unknown') info.platform = 'forge';
        info.platforms.push('forge');
      }
    } catch {
      /* ignore */
    }
  }

  info.mods.push(...found);
  if (top) info.topLevel.push(...found);

  if (depth >= 4) return;
  // jar-in-jar: Fabric (META-INF/jars), Forge/NeoForge JarJar (META-INF/jarjar)
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !e.entryName.endsWith('.jar')) continue;
    if (!/^META-INF\/(jars|jarjar)\//.test(e.entryName)) continue;
    try {
      inspectZip(new AdmZip(e.getData()), depth + 1, info, false);
    } catch {
      /* ignore */
    }
  }
}

export function inspectJar(pathOrBuffer: string | Buffer): JarInfo {
  const info: JarInfo = { platform: 'unknown', platforms: [], mods: [], topLevel: [] };
  try {
    inspectZip(new AdmZip(pathOrBuffer), 0, info, true);
  } catch {
    /* не zip */
  }
  return info;
}
