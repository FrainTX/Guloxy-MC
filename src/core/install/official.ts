import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import AdmZip from 'adm-zip';
import { downloadFile } from '../http';
import {
  fabricProfile,
  forgeFullVersion,
  forgeInstallerUrl,
  mojangVersionJson,
  neoforgeInstallerUrl,
} from '../loaders';
import { safeName } from '../paths';
import type { Pack } from '../../shared/types';

export interface InstallFile {
  /** Путь внутри папки игры, например mods/sodium.jar */
  path: string;
  /** Источник в кэше */
  src: string;
}

export interface OfficialInstallOpts {
  mcDir: string;
  pack: Pack;
  loaderVersion: string;
  files: InstallFile[];
  cacheDir: string;
  java: () => Promise<string>;
  log: (level: 'info' | 'ok' | 'warn' | 'error', text: string) => void;
  signal?: AbortSignal;
}

const MARKER = '.guloxy-pack.json';

export async function ensureLauncherProfiles(mcDir: string) {
  await mkdir(mcDir, { recursive: true });
  const p = join(mcDir, 'launcher_profiles.json');
  if (!existsSync(p)) {
    await writeFile(p, JSON.stringify({ profiles: {}, settings: {}, version: 3 }, null, 2));
  }
}

async function ensureVanilla(mcDir: string, mc: string) {
  const dir = join(mcDir, 'versions', mc);
  const jsonPath = join(dir, `${mc}.json`);
  if (existsSync(jsonPath)) return;
  const { raw } = await mojangVersionJson(mc);
  await mkdir(dir, { recursive: true });
  await writeFile(jsonPath, raw);
}

async function installFabricLike(mcDir: string, loader: 'fabric' | 'quilt', mc: string, lv: string): Promise<string> {
  const profile = (await fabricProfile(loader, mc, lv)) as { id: string };
  const dir = join(mcDir, 'versions', profile.id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${profile.id}.json`), JSON.stringify(profile, null, 2));
  // Официальный лаунчер ожидает jar рядом с json — как и установщик Fabric, кладём пустой архив
  const jar = join(dir, `${profile.id}.jar`);
  if (!existsSync(jar)) await writeFile(jar, new AdmZip().toBuffer());
  return profile.id;
}

function runJava(java: string, args: string[], cwd: string, log: OfficialInstallOpts['log'], signal?: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(java, args, { cwd, windowsHide: true });
    const onAbort = () => child.kill();
    signal?.addEventListener('abort', onAbort, { once: true });
    let lastLine = '';
    const onData = (b: Buffer) => {
      for (const line of b.toString().split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t === lastLine) continue;
        lastLine = t;
        if (/^(Downloading|Extracting|Processor|Task|Installing|Considering|Successfully|Injecting|Copying|Writing)/i.test(t)) {
          log('info', t.length > 160 ? `${t.slice(0, 157)}…` : t);
        }
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      resolve(code ?? 1);
    });
  });
}

async function installForgeLike(opts: OfficialInstallOpts): Promise<string> {
  const { mcDir, pack, loaderVersion, cacheDir, log } = opts;
  const neo = pack.loader === 'neoforge';
  const url = neo ? neoforgeInstallerUrl(loaderVersion) : forgeInstallerUrl(pack.mcVersion, loaderVersion);
  const installer = join(cacheDir, 'installers', neo ? `neoforge-${loaderVersion}-installer.jar` : `forge-${forgeFullVersion(pack.mcVersion, loaderVersion)}-installer.jar`);
  if (!existsSync(installer)) {
    log('info', `Скачиваю установщик ${neo ? 'NeoForge' : 'Forge'} ${loaderVersion}…`);
    await downloadFile(url, installer, { signal: opts.signal });
  }
  const zip = new AdmZip(installer);
  const vj = zip.getEntry('version.json');
  const versionId: string = vj ? JSON.parse(vj.getData().toString('utf8')).id : neo ? `neoforge-${loaderVersion}` : `${pack.mcVersion}-forge-${loaderVersion}`;
  if (existsSync(join(mcDir, 'versions', versionId, `${versionId}.json`))) {
    log('ok', `${versionId} уже установлен`);
    return versionId;
  }
  const java = await opts.java();
  log('info', `Запускаю установщик ${neo ? 'NeoForge' : 'Forge'} (Java: ${java})…`);
  const flag = neo ? '--install-client' : '--installClient';
  const code = await runJava(java, ['-jar', installer, flag, mcDir], dirname(installer), log, opts.signal);
  if (code !== 0 || !existsSync(join(mcDir, 'versions', versionId, `${versionId}.json`))) {
    throw new Error(
      `Установщик ${neo ? 'NeoForge' : 'Forge'} завершился с ошибкой (код ${code}). ` +
        `Попробуйте запустить его вручную: ${installer}`,
    );
  }
  log('ok', `${versionId} установлен`);
  return versionId;
}

export async function installLoaderOfficial(opts: OfficialInstallOpts): Promise<string> {
  const { mcDir, pack, loaderVersion } = opts;
  await ensureLauncherProfiles(mcDir);
  await ensureVanilla(mcDir, pack.mcVersion);
  if (pack.loader === 'fabric' || pack.loader === 'quilt') {
    return installFabricLike(mcDir, pack.loader, pack.mcVersion, loaderVersion);
  }
  return installForgeLike(opts);
}

/** Копирует файлы сборки в папку игры, убирая моды прошлой сборки. */
export async function syncGameDir(gameDir: string, files: InstallFile[], pack: Pack) {
  await mkdir(gameDir, { recursive: true });
  const markerPath = join(gameDir, MARKER);
  let previous: string[] = [];
  if (existsSync(markerPath)) {
    try {
      previous = JSON.parse(await readFile(markerPath, 'utf8')).files ?? [];
    } catch {
      /* ignore */
    }
  }
  const next = new Set(files.map((f) => f.path));
  for (const old of previous) {
    if (!next.has(old)) await rm(join(gameDir, old), { force: true });
  }
  // Посторонние jar в mods (из прошлых ручных установок) тоже мешают запуску — переносим в отдельную папку
  const modsDir = join(gameDir, 'mods');
  if (existsSync(modsDir)) {
    for (const f of await readdir(modsDir)) {
      const rel = `mods/${f}`;
      if (f.endsWith('.jar') && !next.has(rel) && !previous.includes(rel)) {
        await mkdir(join(gameDir, 'mods-disabled'), { recursive: true });
        await copyFile(join(modsDir, f), join(gameDir, 'mods-disabled', f));
        await rm(join(modsDir, f), { force: true });
      }
    }
  }
  for (const f of files) {
    const dest = join(gameDir, f.path);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(f.src, dest);
  }
  await writeFile(markerPath, JSON.stringify({ packId: pack.id, name: pack.name, files: [...next], by: 'Guloxy MC' }, null, 2));
}

export async function writeLauncherProfile(mcDir: string, pack: Pack, versionId: string, gameDir: string) {
  await ensureLauncherProfiles(mcDir);
  const p = join(mcDir, 'launcher_profiles.json');
  const data = JSON.parse(await readFile(p, 'utf8')) as { profiles?: Record<string, unknown> };
  data.profiles ??= {};
  const now = new Date().toISOString();
  const key = `guloxy-${pack.id}`;
  const prev = data.profiles[key] as { created?: string } | undefined;
  const minMem = Math.min(1024, pack.memoryMb);
  data.profiles[key] = {
    name: pack.name,
    type: 'custom',
    created: prev?.created ?? now,
    lastUsed: now,
    lastVersionId: versionId,
    gameDir,
    icon: pack.icon && pack.icon.startsWith('data:image/png') ? pack.icon : 'Grass',
    javaArgs: `-Xmx${pack.memoryMb}M -Xms${minMem}M ${pack.jvmArgs}`.trim(),
  };
  await writeFile(p, JSON.stringify(data, null, 2));
}

export async function installOfficial(opts: OfficialInstallOpts): Promise<{ gameDir: string; versionId: string }> {
  const versionId = await installLoaderOfficial(opts);
  const gameDir = join(opts.mcDir, 'guloxy', safeName(opts.pack.name));
  opts.log('info', `Копирую файлы в ${gameDir}`);
  await syncGameDir(gameDir, opts.files, opts.pack);
  await writeLauncherProfile(opts.mcDir, opts.pack, versionId, gameDir);
  opts.log('ok', `Профиль «${opts.pack.name}» добавлен в официальный лаунчер`);
  return { gameDir, versionId };
}
