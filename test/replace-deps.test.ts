import { describe, expect, it } from 'vitest';
import { resolveWithFixes } from '../src/core/replace';
import { newPack } from '../src/core/importer';
import type { Resolver } from '../src/core/resolver';
import type { Pack, PackEntry, ResolveResult } from '../src/shared/types';

const parent: PackEntry = {
  key: 'modrinth:parent', source: 'modrinth', projectId: 'parent', slug: 'some-addon', title: 'Some Addon',
  author: '', kind: 'mod', addedBy: 'user', requiredBy: [], enabled: true,
};
const fabricApi: PackEntry = {
  key: 'curseforge:306612', source: 'curseforge', projectId: '306612', slug: 'fabric-api', title: 'Fabric API',
  author: '', kind: 'mod', addedBy: 'dependency', requiredBy: ['modrinth:parent'], enabled: true,
};

/** Заглушка резолвера: пока зависимость не пропущена, она «тянется» и не имеет версии под NeoForge. */
function stub(): Resolver {
  const skip = new Set<string>();
  return {
    skip,
    async resolve(p: Pack): Promise<ResolveResult> {
      const entries = skip.has(fabricApi.key) ? [parent] : [parent, fabricApi];
      return {
        pack: { ...p, entries },
        resolved: [],
        added: [],
        issues: skip.has(fabricApi.key)
          ? []
          : [{ level: 'error', title: 'Fabric API — нет версии', entryKey: fabricApi.key, code: 'no-version' }],
      };
    },
    async compatibleFiles() {
      return [];
    },
  } as unknown as Resolver;
}

describe('resolveWithFixes', () => {
  it('не тянет зависимость, указанную для другого загрузчика', async () => {
    const res = await resolveWithFixes(stub(), newPack({ loader: 'neoforge', mcVersion: '1.21.1', entries: [parent] }));
    expect(res.issues.filter((i) => i.level === 'error')).toHaveLength(0);
    expect(res.pack.entries.map((e) => e.key)).toEqual(['modrinth:parent']);
    expect(res.issues.some((i) => i.level === 'fixed' && i.title.includes('Fabric API'))).toBe(true);
  });
});
