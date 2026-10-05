import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { safeName } from '../paths';
import { syncGameDir, type InstallFile } from './official';
import type { Pack } from '../../shared/types';

export function mmcPack(pack: Pack, loaderVersion: string) {
  const components: Record<string, unknown>[] = [{ uid: 'net.minecraft', version: pack.mcVersion, important: true }];
  switch (pack.loader) {
    case 'fabric':
      components.push(
        { uid: 'net.fabricmc.intermediary', version: pack.mcVersion, dependencyOnly: true },
        { uid: 'net.fabricmc.fabric-loader', version: loaderVersion },
      );
      break;
    case 'quilt':
      components.push(
        { uid: 'net.fabricmc.intermediary', version: pack.mcVersion, dependencyOnly: true },
        { uid: 'org.quiltmc.quilt-loader', version: loaderVersion },
      );
      break;
    case 'forge':
      components.push({ uid: 'net.minecraftforge', version: loaderVersion });
      break;
    case 'neoforge':
      components.push({ uid: 'net.neoforged', version: loaderVersion });
      break;
  }
  return { components, formatVersion: 1 };
}

export function instanceCfg(pack: Pack): string {
  const esc = (s: string) => s.replace(/\r?\n/g, ' ');
  return [
    '[General]',
    'ConfigVersion=1.2',
    'InstanceType=OneSix',
    `name=${esc(pack.name)}`,
    'iconKey=default',
    'OverrideMemory=true',
    `MaxMemAlloc=${pack.memoryMb}`,
    `MinMemAlloc=${Math.min(1024, pack.memoryMb)}`,
    `OverrideJavaArgs=${pack.jvmArgs ? 'true' : 'false'}`,
    `JvmArgs=${esc(pack.jvmArgs)}`,
    'AutomaticJava=true',
    `notes=${esc(`Сборка «${pack.name}» создана в Guloxy MC`)}`,
    '',
  ].join('\n');
}

async function freeInstanceDir(root: string, pack: Pack): Promise<string> {
  const base = safeName(pack.name);
  for (let i = 0; i < 100; i++) {
    const dir = join(root, i ? `${base} (${i + 1})` : base);
    if (!existsSync(dir)) return dir;
    const marker = join(dir, '.minecraft', '.guloxy-pack.json');
    if (existsSync(marker)) {
      try {
        if (JSON.parse(await readFile(marker, 'utf8')).packId === pack.id) return dir;
      } catch {
        /* ignore */
      }
    }
  }
  return join(root, `${base}-${Date.now()}`);
}

/** Создаёт (или обновляет) инстанс Prism Launcher / MultiMC. */
export async function installPrism(instancesDir: string, pack: Pack, loaderVersion: string, files: InstallFile[]): Promise<string> {
  const dir = await freeInstanceDir(instancesDir, pack);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'instance.cfg'), instanceCfg(pack));
  await writeFile(join(dir, 'mmc-pack.json'), JSON.stringify(mmcPack(pack, loaderVersion), null, 2));
  await syncGameDir(join(dir, '.minecraft'), files, pack);
  return dir;
}

/** Zip-архив инстанса для импорта в Prism/MultiMC («Добавить экземпляр → Импорт»). */
export async function exportPrismZip(dest: string, pack: Pack, loaderVersion: string, files: InstallFile[]) {
  const zip = new AdmZip();
  const root = safeName(pack.name);
  zip.addFile(`${root}/instance.cfg`, Buffer.from(instanceCfg(pack)));
  zip.addFile(`${root}/mmc-pack.json`, Buffer.from(JSON.stringify(mmcPack(pack, loaderVersion), null, 2)));
  for (const f of files) zip.addFile(`${root}/.minecraft/${f.path}`, await readFile(f.src));
  await zip.writeZipPromise(dest);
}
