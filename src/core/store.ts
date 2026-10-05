import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultMinecraftDir, defaultPrismInstancesDir } from './paths';
import type { Pack, Settings } from '../shared/types';
import { BUILTIN_CF_KEY } from './builtin';

export class Store {
  constructor(public readonly root: string) {}

  get packsDir() {
    return join(this.root, 'packs');
  }
  get cacheDir() {
    return join(this.root, 'cache');
  }

  private async writeJson(path: string, data: unknown) {
    await mkdir(join(path, '..'), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, path);
  }

  async getSettings(): Promise<Settings> {
    const defaults: Settings = {
      curseforgeApiKey: '',
      builtinCurseforgeKey: !!BUILTIN_CF_KEY,
      preferSource: 'modrinth',
      concurrency: 6,
      minecraftDir: defaultMinecraftDir(),
      prismInstancesDir: defaultPrismInstancesDir(),
      javaPath: '',
      defaultMemoryMb: 6144,
      reduceMotion: false,
    };
    const p = join(this.root, 'settings.json');
    if (!existsSync(p)) return defaults;
    try {
      const saved = JSON.parse(await readFile(p, 'utf8')) as Partial<Settings>;
      return { ...defaults, ...saved, builtinCurseforgeKey: defaults.builtinCurseforgeKey };
    } catch {
      return defaults;
    }
  }

  async setSettings(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await this.getSettings()), ...patch };
    delete next.builtinCurseforgeKey;
    await this.writeJson(join(this.root, 'settings.json'), next);
    return this.getSettings();
  }

  async listPacks(): Promise<Pack[]> {
    if (!existsSync(this.packsDir)) return [];
    const out: Pack[] = [];
    for (const f of await readdir(this.packsDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(await readFile(join(this.packsDir, f), 'utf8')) as Pack);
      } catch {
        /* повреждённый файл пропускаем */
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getPack(id: string): Promise<Pack> {
    const p = join(this.packsDir, `${id}.json`);
    if (!existsSync(p)) throw new Error('Сборка не найдена');
    return JSON.parse(await readFile(p, 'utf8')) as Pack;
  }

  async savePack(pack: Pack): Promise<Pack> {
    if (!/^[a-z0-9-]+$/i.test(pack.id)) throw new Error('Некорректный id сборки');
    pack.updatedAt = Date.now();
    await this.writeJson(join(this.packsDir, `${pack.id}.json`), pack);
    return pack;
  }

  async removePack(id: string) {
    if (!/^[a-z0-9-]+$/i.test(id)) return;
    await rm(join(this.packsDir, `${id}.json`), { force: true });
  }
}
