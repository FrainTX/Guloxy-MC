import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyJars } from '../src/core/verifier';
import { inspectJar } from '../src/core/jarinspect';

const dir = mkdtempSync(join(tmpdir(), 'gx-test-'));

function fabricJar(name: string, json: object, nested: Record<string, object> = {}) {
  const zip = new AdmZip();
  zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify(json)));
  for (const [n, j] of Object.entries(nested)) {
    const inner = new AdmZip();
    inner.addFile('fabric.mod.json', Buffer.from(JSON.stringify(j)));
    zip.addFile(`META-INF/jars/${n}.jar`, inner.toBuffer());
  }
  const p = join(dir, `${name}.jar`);
  writeFileSync(p, zip.toBuffer());
  return p;
}

function neoJar(name: string, toml: string) {
  const zip = new AdmZip();
  zip.addFile('META-INF/neoforge.mods.toml', Buffer.from(toml));
  const p = join(dir, `${name}.jar`);
  writeFileSync(p, zip.toBuffer());
  return p;
}

const ctx = { mcVersion: '1.21.1', loader: 'fabric' as const, loaderVersion: '0.16.10', javaMajor: 21 };

describe('inspectJar', () => {
  it('читает fabric.mod.json и вложенные jar', () => {
    const p = fabricJar('a', { id: 'a', version: '1.0', depends: { minecraft: '~1.21' } }, { lib: { id: 'mylib', version: '2.0' } });
    const info = inspectJar(p);
    expect(info.platform).toBe('fabric');
    expect(info.topLevel.map((m) => m.id)).toEqual(['a']);
    expect(info.mods.map((m) => m.id)).toContain('mylib');
  });
  it('читает «вольный» JSON с комментариями', () => {
    const zip = new AdmZip();
    zip.addFile('fabric.mod.json', Buffer.from('{\n // comment\n "id": "loose", "version": "1",\n}'));
    const p = join(dir, 'loose.jar');
    writeFileSync(p, zip.toBuffer());
    expect(inspectJar(p).topLevel[0].id).toBe('loose');
  });
});

describe('verifyJars', () => {
  it('находит отсутствующие зависимости', () => {
    const a = fabricJar('m1', { id: 'm1', version: '1', depends: { fabricloader: '>=0.15', 'cloth-config': '*', minecraft: '1.21.x' } });
    const r = verifyJars([{ key: 'k1', title: 'Mod 1', path: a, addedBy: 'user' }], ctx);
    expect(r.missing.map((m) => m.id)).toEqual(['cloth-config']);
    expect(r.issues.filter((i) => i.level === 'error')).toHaveLength(0);
  });
  it('учитывает вложенные jar и provides', () => {
    const a = fabricJar('m2', { id: 'm2', version: '1', depends: { mylib: '*', fabric: '*' } }, { mylib: { id: 'mylib', version: '1' } });
    const api = fabricJar('api', { id: 'fabric-api', version: '0.100', provides: ['fabric'] });
    const r = verifyJars(
      [
        { key: 'k2', title: 'Mod 2', path: a, addedBy: 'user' },
        { key: 'k3', title: 'Fabric API', path: api, addedBy: 'dependency' },
      ],
      ctx,
    );
    expect(r.missing).toHaveLength(0);
  });
  it('ловит неверную версию Minecraft и загрузчика', () => {
    const a = fabricJar('m3', { id: 'm3', version: '1', depends: { minecraft: '1.20.x', fabricloader: '>=0.17' } });
    const r = verifyJars([{ key: 'k4', title: 'Old', path: a, addedBy: 'user' }], ctx);
    expect(r.issues.filter((i) => i.level === 'error')).toHaveLength(2);
  });
  it('убирает дубликаты по mod id', () => {
    const a = fabricJar('d1', { id: 'dup', version: '1' });
    const b = fabricJar('d2', { id: 'dup', version: '1' });
    const r = verifyJars(
      [
        { key: 'user', title: 'A', path: a, addedBy: 'user' },
        { key: 'dep', title: 'B', path: b, addedBy: 'dependency' },
      ],
      ctx,
    );
    expect(r.duplicates).toEqual(['dep']);
  });
  it('ловит мод под чужой загрузчик и breaks', () => {
    const neo = neoJar('n', '[[mods]]\nmodId="n"\nversion="1"\n');
    const x = fabricJar('x', { id: 'x', version: '1', breaks: { y: '*' } });
    const y = fabricJar('y', { id: 'y', version: '1' });
    const r = verifyJars(
      [
        { key: 'n', title: 'Neo', path: neo, addedBy: 'user' },
        { key: 'x', title: 'X', path: x, addedBy: 'user' },
        { key: 'y', title: 'Y', path: y, addedBy: 'user' },
      ],
      ctx,
    );
    expect(r.issues.some((i) => i.entryKey === 'n' && i.level === 'error')).toBe(true);
    expect(r.issues.some((i) => i.title.startsWith('Конфликт'))).toBe(true);
  });
  it('проверяет обязательные зависимости NeoForge', () => {
    const toml = `[[mods]]\nmodId="z"\nversion="1"\n[[dependencies.z]]\nmodId="neoforge"\ntype="required"\nversionRange="[21.1,)"\n[[dependencies.z]]\nmodId="curios"\ntype="required"\nversionRange="[9,)"\n[[dependencies.z]]\nmodId="jei"\ntype="optional"\n`;
    const z = neoJar('z', toml);
    const r = verifyJars([{ key: 'z', title: 'Z', path: z, addedBy: 'user' }], { ...ctx, loader: 'neoforge', loaderVersion: '21.1.200' });
    expect(r.missing.map((m) => m.id)).toEqual(['curios']);
    expect(r.issues.filter((i) => i.level === 'error')).toHaveLength(0);
  });
  it('предлагает исправление конфликта версий (Sodium ↔ Iris)', () => {
    const iris = fabricJar('iris', { id: 'iris', version: '1.8.8', depends: { sodium: '0.6.x' } });
    const sodium8 = fabricJar('sodium8', { id: 'sodium', version: '0.8.13+mc1.21.1', breaks: { iris: '<1.10' } });
    const sodium6 = fabricJar('sodium6', { id: 'sodium', version: '0.6.13+mc1.21.1' });
    const r = verifyJars(
      [
        { key: 'iris', title: 'Iris', path: iris, addedBy: 'user' },
        { key: 'sodium', title: 'Sodium', path: sodium8, addedBy: 'user' },
      ],
      ctx,
    );
    expect(r.issues.filter((i) => i.level === 'error').length).toBeGreaterThan(0);
    const dep = r.conflicts.find((c) => c.a === 'iris' && c.b === 'sodium')!;
    expect(dep.preferB).toBe(true);
    expect(dep.okB!(inspectJar(sodium6))).toBe(true);
    expect(dep.okB!(inspectJar(sodium8))).toBe(false);
    const br = r.conflicts.find((c) => c.a === 'sodium')!;
    expect(br.okA(inspectJar(sodium6))).toBe(true);
    const fixed = verifyJars(
      [
        { key: 'iris', title: 'Iris', path: iris, addedBy: 'user' },
        { key: 'sodium', title: 'Sodium', path: sodium6, addedBy: 'user' },
      ],
      ctx,
    );
    expect(fixed.conflicts).toHaveLength(0);
  });
  it('видит моды внутри JAR-контейнера без манифеста (как Kotlin for Forge)', () => {
    const inner = new AdmZip();
    inner.addFile('META-INF/neoforge.mods.toml', Buffer.from('[[mods]]\nmodId="kotlinforforge"\nversion="5.12.0"\n'));
    const outer = new AdmZip();
    outer.addFile('META-INF/MANIFEST.MF', Buffer.from('Manifest-Version: 1.0\n'));
    outer.addFile('META-INF/jarjar/kffmod.jar', inner.toBuffer());
    const kff = join(dir, 'kff.jar');
    writeFileSync(kff, outer.toBuffer());
    const user = neoJar('jetpack', '[[mods]]\nmodId="jetpack"\nversion="1"\n[[dependencies.jetpack]]\nmodId="kotlinforforge"\ntype="required"\nversionRange="[5,)"\n');
    const r = verifyJars(
      [
        { key: 'jetpack', title: 'Create Jetpack', path: user, addedBy: 'user' },
        { key: 'kff', title: 'Kotlin for Forge', path: kff, addedBy: 'auto' },
      ],
      { ...ctx, loader: 'neoforge', loaderVersion: '21.1.252' },
    );
    expect(r.missing).toHaveLength(0);
    expect(r.issues).toHaveLength(0);
  });
});
