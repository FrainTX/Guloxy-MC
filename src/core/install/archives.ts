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
