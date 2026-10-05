import { describe, expect, it } from 'vitest';
import { compareVersions, matchesFabric, matchesMaven } from '../src/core/versionrange';

describe('compareVersions', () => {
  it('сравнивает числовые части', () => {
    expect(compareVersions('1.21.1', '1.21')).toBeGreaterThan(0);
    expect(compareVersions('1.21', '1.21.0')).toBe(0);
    expect(compareVersions('0.16.10', '0.16.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-beta.2', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('21.1.10-beta', '21.1.9')).toBeGreaterThan(0);
  });
});

describe('matchesFabric', () => {
  it('поддерживает операторы и x-диапазоны', () => {
    expect(matchesFabric('1.21.1', '>=1.21')).toBe(true);
    expect(matchesFabric('1.21.1', '~1.21')).toBe(true);
    expect(matchesFabric('1.22', '~1.21')).toBe(false);
    expect(matchesFabric('1.20.1', '1.20.x')).toBe(true);
    expect(matchesFabric('1.21', '1.20.x')).toBe(false);
    expect(matchesFabric('1.21.1', ['1.20.1', '1.21.1'])).toBe(true);
    expect(matchesFabric('1.21.1', '>=1.21 <1.21.2')).toBe(true);
    expect(matchesFabric('1.21.4', '>=1.21 <1.21.2')).toBe(false);
    expect(matchesFabric('0.19.5', '>=0.15.0')).toBe(true);
    expect(matchesFabric('anything', '*')).toBe(true);
  });
});

describe('matchesMaven', () => {
  it('проверяет диапазоны mods.toml', () => {
    expect(matchesMaven('1.21.1', '[1.21.1,1.22)')).toBe(true);
    expect(matchesMaven('1.21.1', '[1.20,1.21)')).toBe(false);
    expect(matchesMaven('47.4.0', '[47,)')).toBe(true);
    expect(matchesMaven('46.0.0', '[47,)')).toBe(false);
    expect(matchesMaven('1.21.1', '1.21.1')).toBe(true);
    expect(matchesMaven('1.21.1', '[1.21, 1.21.1)')).toBe(false);
    expect(matchesMaven('1.21.1', '[1.21, 1.21.1)', { lenientUpper: true })).toBe(true);
  });
});
