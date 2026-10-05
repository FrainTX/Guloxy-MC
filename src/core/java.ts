import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join, delimiter } from 'node:path';
import { homedir, platform, arch } from 'node:os';
import AdmZip from 'adm-zip';
import { downloadFile } from './http';
import { defaultMinecraftDir } from './paths';

const exe = platform() === 'win32' ? 'java.exe' : 'java';

export interface JavaInstall {
  path: string;
  major: number;
}

export function javaMajorOf(path: string): Promise<number> {
  return new Promise((resolve) => {
    execFile(path, ['-version'], { timeout: 15000, windowsHide: true }, (err, stdout, stderr) => {
      const out = `${stdout}\n${stderr}`;
      const m = /version "(\d+)(?:\.(\d+))?/.exec(out);
      if (!m) return resolve(0);
      const first = Number(m[1]);
      resolve(first === 1 ? Number(m[2]) : first);
    });
  });
}

async function findIn(dir: string, depth: number, out: string[]) {
  if (depth < 0 || !existsSync(dir)) return;
  let items: string[] = [];
  try {
    items = await readdir(dir);
  } catch {
    return;
  }
  if (items.includes('bin') && existsSync(join(dir, 'bin', exe))) out.push(join(dir, 'bin', exe));
  for (const i of items) {
    if (i === 'bin' || i.startsWith('.')) continue;
    const p = join(dir, i);
    try {
      if ((await stat(p)).isDirectory()) await findIn(p, depth - 1, out);
    } catch {
      /* ignore */
    }
  }
}

/** Ищет установленные Java: JAVA_HOME, PATH, рантаймы официального лаунчера, свои загрузки. */
export async function findJavas(appDataDir?: string): Promise<JavaInstall[]> {
  const candidates: string[] = [];
  if (process.env.JAVA_HOME) candidates.push(join(process.env.JAVA_HOME, 'bin', exe));
  for (const p of (process.env.PATH ?? '').split(delimiter)) if (p) candidates.push(join(p, exe));

  const roots: [string, number][] = [[join(defaultMinecraftDir(), 'runtime'), 5]];
  if (appDataDir) roots.push([join(appDataDir, 'java'), 4]);
  if (platform() === 'win32') {
    const la = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    roots.push(
      [join(la, 'Packages', 'Microsoft.4297127D64EC6_8wekyb3d8bbwe', 'LocalCache', 'Local', 'runtime'), 5],
      ['C:\\Program Files (x86)\\Minecraft Launcher\\runtime', 5],
      ['C:\\Program Files\\Eclipse Adoptium', 2],
      ['C:\\Program Files\\Java', 2],
      ['C:\\Program Files\\Microsoft', 2],
      ['C:\\Program Files\\Zulu', 2],
    );
  } else if (platform() === 'darwin') {
    roots.push(['/Library/Java/JavaVirtualMachines', 4]);
  } else {
    roots.push(['/usr/lib/jvm', 2]);
  }
  for (const [r, d] of roots) await findIn(r, d, candidates);

  const seen = new Set<string>();
  const out: JavaInstall[] = [];
  for (const c of candidates) {
    if (seen.has(c) || !existsSync(c)) continue;
    seen.add(c);
    const major = await javaMajorOf(c);
    if (major > 0) out.push({ path: c, major });
  }
  return out.sort((a, b) => b.major - a.major);
}

/** Скачивает Eclipse Temurin JRE нужной версии в папку приложения. */
export async function downloadJava(major: number, appDataDir: string, onBytes?: (n: number) => void): Promise<string> {
  const os = platform() === 'win32' ? 'windows' : platform() === 'darwin' ? 'mac' : 'linux';
  const a = arch() === 'arm64' ? 'aarch64' : 'x64';
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/${os}/${a}/jre/hotspot/normal/eclipse`;
  const root = join(appDataDir, 'java', `temurin-${major}`);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const archive = join(appDataDir, 'java', `temurin-${major}.${os === 'windows' ? 'zip' : 'tar.gz'}`);
  await downloadFile(url, archive, { onBytes });
  if (os === 'windows') {
    new AdmZip(archive).extractAllTo(root, true);
  } else {
    await new Promise<void>((resolve, reject) =>
      execFile('tar', ['-xzf', archive, '-C', root], (err) => (err ? reject(err) : resolve())),
    );
  }
  await rm(archive, { force: true });
  const found: string[] = [];
  await findIn(root, 4, found);
  if (!found.length) throw new Error('Не удалось распаковать Java');
  return found[0];
}

/** Возвращает путь к подходящей Java, при необходимости скачивая её. */
export async function ensureJava(
  major: number,
  appDataDir: string,
  preferred?: string,
  onBytes?: (n: number) => void,
): Promise<string> {
  if (preferred && existsSync(preferred) && (await javaMajorOf(preferred)) >= major) return preferred;
  const all = await findJavas(appDataDir);
  const exact = all.find((j) => j.major === major) ?? all.find((j) => j.major >= major);
  if (exact) return exact.path;
  return downloadJava(major, appDataDir, onBytes);
}
