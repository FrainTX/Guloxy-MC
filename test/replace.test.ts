import { describe, expect, it } from 'vitest';
import { normTitle } from '../src/core/replace';

describe('normTitle', () => {
  it('убирает упоминания загрузчика из названия', () => {
    expect(normTitle('Create Fabric')).toBe('create');
    expect(normTitle('Create')).toBe('create');
    expect(normTitle('Sodium [NeoForge]')).toBe('sodium');
    expect(normTitle('Xaero’s Minimap (Forge Edition)')).toBe(normTitle("Xaero's Minimap"));
  });
});
