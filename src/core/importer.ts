import AdmZip from 'adm-zip';
import { randomUUID } from 'node:crypto';
import * as mr from './modrinth';
import { entryKey } from './resolver';
import type { ContentKind, Loader, Pack, PackEntry } from '../shared/types';

function kindFromPath(p: string): ContentKind {
  if (p.startsWith('resourcepacks/')) return 'resourcepack';
  if (p.startsWith('shaderpacks/')) return 'shader';
  return 'mod';
}

export function newPack(partial: Partial<Pack> = {}): Pack {
  const now = Date.now();
  return {
    id: randomUUID(),
    name: 'Новая сборка',
    description: '',
    author: 'Guloxy',
    version: '1.0.0',
    mcVersion: '1.21.1',
    loader: 'fabric',
    loaderVersion: 'latest',
    memoryMb: 6144,
    jvmArgs: '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200',
    accent: '#a855f7',
    allowBeta: false,
    entries: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

/** Импорт .mrpack или CurseForge .zip в редактируемую сборку. */
export async function importArchive(path: string): Promise<{ pack: Pack; warnings: string[] }> {
  const zip = new AdmZip(path);
  const warnings: string[] = [];
  const mrIndex = zip.getEntry('modrinth.index.json');
  const cfManifest = zip.getEntry('manifest.json');

  if (mrIndex) {
    const idx = JSON.parse(mrIndex.getData().toString('utf8')) as {
      name: string;
      summary?: string;
      versionId: string;
      files: { path: string; hashes: { sha1: string } }[];
      dependencies: Record<string, string>;
    };
    const d = idx.dependencies;
    const loader: Loader = d['fabric-loader'] ? 'fabric' : d['quilt-loader'] ? 'quilt' : d.neoforge ? 'neoforge' : 'forge';
    const loaderVersion = d['fabric-loader'] ?? d['quilt-loader'] ?? d.neoforge ?? d.forge ?? 'latest';
    const byHash = await mr.versionsByHashes(idx.files.map((f) => f.hashes.sha1));
    const entries: PackEntry[] = [];
    for (const f of idx.files) {
      const v = byHash[f.hashes.sha1];
      if (!v) {
        warnings.push(`Не найден на Modrinth: ${f.path}`);
        continue;
      }
      entries.push({
        key: entryKey('modrinth', v.project_id),
        source: 'modrinth',
        projectId: v.project_id,
        slug: '',
        title: f.path.split('/').pop() ?? v.project_id,
        author: '',
        kind: kindFromPath(f.path),
        pinnedVersionId: v.id,
        addedBy: 'user',
        requiredBy: [],
        enabled: true,
      });
    }
    if (zip.getEntries().some((e) => e.entryName.startsWith('overrides/mods/'))) {
      warnings.push('Моды из overrides не импортируются — добавьте их через каталог.');
    }
    return {
      pack: newPack({ name: idx.name, description: idx.summary ?? '', version: idx.versionId, mcVersion: d.minecraft, loader, loaderVersion, entries }),
      warnings,
    };
  }

  if (cfManifest) {
    const m = JSON.parse(cfManifest.getData().toString('utf8')) as {
      name: string;
      version: string;
      author?: string;
      minecraft: { version: string; modLoaders: { id: string; primary: boolean }[] };
      files: { projectID: number; fileID: number; required: boolean }[];
    };
    const primary = (m.minecraft.modLoaders.find((l) => l.primary) ?? m.minecraft.modLoaders[0])?.id ?? 'fabric-latest';
    const [loaderName, ...rest] = primary.split('-');
    const loader = (['fabric', 'quilt', 'forge', 'neoforge'].includes(loaderName) ? loaderName : 'forge') as Loader;
    const entries: PackEntry[] = m.files
      .filter((f) => f.required !== false)
      .map((f) => ({
        key: entryKey('curseforge', String(f.projectID)),
        source: 'curseforge' as const,
        projectId: String(f.projectID),
        slug: '',
        title: `CurseForge #${f.projectID}`,
        author: '',
        kind: 'mod' as const,
        pinnedVersionId: String(f.fileID),
        addedBy: 'user' as const,
        requiredBy: [],
        enabled: true,
      }));
    return {
      pack: newPack({ name: m.name, version: m.version || '1.0.0', mcVersion: m.minecraft.version, loader, loaderVersion: rest.join('-') || 'latest', entries }),
      warnings,
    };
  }

  throw new Error('Это не .mrpack и не сборка CurseForge');
}
