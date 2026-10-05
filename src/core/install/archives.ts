import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import type { ModFile, Pack } from '../../shared/types';

export interface ArchiveFile {
  path: string;
  src: string;
  file: ModFile;
}

const MRPACK_HOSTS = ['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com'];

const MR_LOADER_KEY = { fabric: 'fabric-loader', quilt: 'quilt-loader', forge: 'forge', neoforge: 'neoforge' } as const;

function readme(pack: Pack) {
  return `${pack.name}\n${pack.description}\n\nСобрано в Guloxy MC — ${pack.author}\n`;
}

/** Экспорт в формат Modrinth (.mrpack). Файлы с CurseForge кладутся в overrides. */
export async function exportMrpack(dest: string, pack: Pack, loaderVersion: string, files: ArchiveFile[]) {
  const zip = new AdmZip();
  const index = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: pack.version,
    name: pack.name,
    summary: pack.description || undefined,
    files: [] as unknown[],
    dependencies: { minecraft: pack.mcVersion, [MR_LOADER_KEY[pack.loader]]: loaderVersion },
  };
  for (const f of files) {
    const host = (() => {
      try {
        return new URL(f.file.url).hostname;
      } catch {
        return '';
      }
    })();
    const buf = await readFile(f.src);
    if (MRPACK_HOSTS.includes(host)) {
      index.files.push({
        path: f.path,
        hashes: {
          sha1: f.file.sha1 ?? createHash('sha1').update(buf).digest('hex'),
          sha512: f.file.sha512 ?? createHash('sha512').update(buf).digest('hex'),
        },
        downloads: [f.file.url],
        fileSize: buf.length,
      });
    } else {
      zip.addFile(`overrides/${f.path}`, buf);
    }
  }
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(index, null, 2)));
  if (pack.icon?.startsWith('data:image/png;base64,')) {
    zip.addFile('overrides/icon.png', Buffer.from(pack.icon.split(',')[1], 'base64'));
  }
  await zip.writeZipPromise(dest);
}

/** Экспорт в формат CurseForge (.zip c manifest.json). Файлы с Modrinth кладутся в overrides. */
export async function exportCurseforgeZip(dest: string, pack: Pack, loaderVersion: string, files: ArchiveFile[]) {
  const zip = new AdmZip();
  const manifest = {
    minecraft: {
      version: pack.mcVersion,
      modLoaders: [{ id: `${pack.loader}-${loaderVersion}`, primary: true }],
    },
    manifestType: 'minecraftModpack',
    manifestVersion: 1,
    name: pack.name,
    version: pack.version,
    author: pack.author,
    files: [] as unknown[],
    overrides: 'overrides',
  };
  const list: string[] = [];
  for (const f of files) {
    if (f.file.source === 'curseforge') {
      manifest.files.push({ projectID: Number(f.file.projectId), fileID: Number(f.file.versionId), required: true });
      list.push(`<li>${f.file.fileName}</li>`);
    } else {
      zip.addFile(`overrides/${f.path}`, await readFile(f.src));
    }
  }
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  zip.addFile('modlist.html', Buffer.from(`<ul>\n${list.join('\n')}\n</ul>\n`));
  zip.addFile('overrides/README-guloxy.txt', Buffer.from(readme(pack)));
  await zip.writeZipPromise(dest);
}

function libPath(lib: { name: string; downloads?: { artifact?: { path?: string } } }): string | null {
  if (lib.downloads?.artifact?.path) return lib.downloads.artifact.path;
  const [group, artifact, version, classifier] = lib.name.split(':');
  if (!group || !artifact || !version) return null;
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.jar`;
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`;
}

/**
 * Готовая папка .minecraft одним ZIP: загрузчик (versions + локальные библиотеки, которые создаёт
 * установщик Forge/NeoForge), моды, ресурспаки и шейдеры. Распаковал в .minecraft — выбрал версию — играешь.
 */
export async function exportMinecraftZip(
  dest: string,
  pack: Pack,
  mcDir: string,
  versionId: string,
  files: { path: string; src: string }[],
  /** Forge/NeoForge: установщик кладёт пропатченный клиент в libraries по путям, которых нет в списке версии. */
  allLibraries = false,
) {
  const { existsSync } = await import('node:fs');
  const { readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const zip = new AdmZip();

  // Версия загрузчика и её родители (кроме самой ванильной jar — лаунчер скачает её сам)
  let id: string | undefined = versionId;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const dir = join(mcDir, 'versions', id);
    const jsonPath = join(dir, `${id}.json`);
    if (!existsSync(jsonPath)) break;
    const json = JSON.parse(await readFile(jsonPath, 'utf8')) as {
      inheritsFrom?: string;
      libraries?: { name: string; downloads?: { artifact?: { path?: string; url?: string } } }[];
    };
    const vanilla = !json.inheritsFrom && id === pack.mcVersion;
    for (const f of await readdir(dir)) {
      if (vanilla && f.endsWith('.jar')) continue;
      zip.addFile(`versions/${id}/${f}`, await readFile(join(dir, f)));
    }
    if (!vanilla) {
      for (const lib of json.libraries ?? []) {
        const p = libPath(lib);
        if (!p) continue;
        const local = join(mcDir, 'libraries', p);
        if (existsSync(local) && !zip.getEntry(`libraries/${p}`)) zip.addFile(`libraries/${p}`, await readFile(local));
      }
    }
    id = json.inheritsFrom;
  }

  if (allLibraries) {
    const root = join(mcDir, 'libraries');
    const walk = async (dir: string, rel: string): Promise<void> => {
      if (!existsSync(dir)) return;
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(join(dir, e.name), r);
        else if (!e.name.endsWith('.cache') && !zip.getEntry(`libraries/${r}`)) zip.addFile(`libraries/${r}`, await readFile(join(dir, e.name)));
      }
    };
    await walk(root, '');
  }

  for (const f of files) zip.addFile(f.path, await readFile(f.src));

  const howto = [
    `${pack.name} ${pack.version}`,
    `Minecraft ${pack.mcVersion} · ${pack.loader} · версия для запуска: ${versionId}`,
    '',
    'Как установить:',
    '1. Закройте лаунчер.',
    '2. Распакуйте содержимое этого архива в папку .minecraft',
    '   (Windows: нажмите Win+R, введите %appdata%\\.minecraft и нажмите Enter).',
    '   Если в папке mods уже есть моды — лучше перенесите их в другую папку.',
    `3. Откройте лаунчер и выберите в списке версию «${versionId}».`,
    `4. Выделите игре не меньше ${Math.round(pack.memoryMb / 1024)} ГБ памяти.`,
    '',
    'Сборка собрана и проверена в Guloxy MC — github.com/FrainTX/Guloxy-MC',
    'Сделано командой Guloxy',
    '',
  ].join('\r\n');
  zip.addFile('README.txt', Buffer.from('﻿' + howto, 'utf8'));
  await zip.writeZipPromise(dest);
}
