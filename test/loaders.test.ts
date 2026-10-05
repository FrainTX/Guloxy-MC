import { describe, expect, it } from 'vitest';
import { neoforgePrefix } from '../src/core/loaders';
import { chooseFile } from '../src/core/resolver';
import { candidateSlugs } from '../src/core/verifier';
import type { ModFile } from '../src/shared/types';

describe('neoforgePrefix', () => {
  it('сопоставляет версии Minecraft и NeoForge', () => {
    expect(neoforgePrefix('1.21.1')).toBe('21.1.');
    expect(neoforgePrefix('1.21')).toBe('21.0.');
    expect(neoforgePrefix('1.20.4')).toBe('20.4.');
    expect(neoforgePrefix('26.1')).toBe('26.1.0.');
    expect(neoforgePrefix('26.1.2')).toBe('26.1.2.');
  });
});

describe('chooseFile', () => {
  const f = (id: string, channel: ModFile['channel'], published: string): ModFile => ({
    source: 'modrinth', projectId: 'p', versionId: id, versionName: id, fileName: `${id}.jar`, url: '', size: 1,
    channel, gameVersions: [], loaders: ['fabric'], published, dependencies: [],
  });
  it('предпочитает свежий релиз', () => {
    const r = chooseFile([f('b', 'beta', '2026-02'), f('r', 'release', '2026-01'), f('old', 'release', '2025-01')], false);
    expect(r.file?.versionId).toBe('r');
  });
  it('берёт бету, если разрешено', () => {
    expect(chooseFile([f('b', 'beta', '2026-02'), f('r', 'release', '2026-01')], true).file?.versionId).toBe('b');
  });
  it('падает на бету с предупреждением, если релизов нет', () => {
    const r = chooseFile([f('a', 'alpha', '2026-03'), f('b', 'beta', '2026-02')], false);
    expect(r.file?.versionId).toBe('b');
    expect(r.warning).toBeTruthy();
  });
});

describe('candidateSlugs', () => {
  it('разбивает слитные mod id на slug через дефис', () => {
    expect(candidateSlugs('sophisticatedbackpacks')).toContain('sophisticated-backpacks');
    expect(candidateSlugs('createdeco')).toContain('create-deco');
    expect(candidateSlugs('cloth_config')).toContain('cloth-config');
  });
});
