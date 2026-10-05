// Сравнение версий и разбор диапазонов (Fabric-предикаты и Maven-диапазоны из mods.toml).

type Part = number | string;

function parts(v: string): { nums: Part[]; pre: string } {
  const clean = v.trim().replace(/^v/i, '').split('+')[0];
  const dash = clean.indexOf('-');
  const main = dash >= 0 ? clean.slice(0, dash) : clean;
  const pre = dash >= 0 ? clean.slice(dash + 1) : '';
  const nums = main.split(/[.]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  return { nums, pre };
}

function cmpPart(a: Part | undefined, b: Part | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return typeof b === 'number' && b === 0 ? 0 : -1;
  if (b === undefined) return typeof a === 'number' && a === 0 ? 0 : 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return 1;
  if (typeof b === 'number') return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Возвращает <0, 0, >0. Пре-релизы (1.0.0-beta) младше релиза (1.0.0). */
export function compareVersions(a: string, b: string): number {
  const A = parts(a);
  const B = parts(b);
  const len = Math.max(A.nums.length, B.nums.length);
  for (let i = 0; i < len; i++) {
    const c = cmpPart(A.nums[i], B.nums[i]);
    if (c !== 0) return c;
  }
  if (A.pre && !B.pre) return -1;
  if (!A.pre && B.pre) return 1;
  if (A.pre && B.pre) {
    const pa = A.pre.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p));
    const pb = B.pre.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p));
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const c = cmpPart(pa[i], pb[i]);
      if (c !== 0) return c;
    }
  }
  return 0;
}

function matchSingle(version: string, pred: string): boolean {
  pred = pred.trim();
  if (!pred || pred === '*') return true;
  const m = /^(>=|<=|>|<|=|~|\^)?\s*(.+)$/.exec(pred);
  if (!m) return true;
  const op = m[1] ?? '';
  let target = m[2].trim();
  // x-диапазоны: 1.20.x, 1.20.*
  if (/[.](x|X|\*)$/.test(target) || /[.](x|X|\*)[.]/.test(target)) {
    const prefix = target.split(/[.](?:x|X|\*)/)[0];
    const pv = parts(version).nums;
    const pp = parts(prefix).nums;
    const inRange = pp.every((p, i) => cmpPart(pv[i], p) === 0);
    if (!op || op === '=') return inRange;
    target = prefix;
  }
  const c = compareVersions(version, target);
  switch (op) {
    case '>=':
      return c >= 0;
    case '<=':
      return c <= 0;
    case '>':
      return c > 0;
    case '<':
      return c < 0;
    case '~': {
      // ~1.20.1 → >=1.20.1 <1.21
      const t = parts(target).nums;
      const upper = t.length >= 2 ? [t[0], Number(t[1]) + 1] : [Number(t[0]) + 1];
      return c >= 0 && compareVersions(version, upper.join('.')) < 0;
    }
    case '^': {
      const t = parts(target).nums;
      const upper = String(Number(t[0]) + 1);
      return c >= 0 && compareVersions(version, upper) < 0;
    }
    default:
      return c === 0 || version.startsWith(`${target}-`) || version === target;
  }
}

/**
 * Fabric/Quilt предикат: строка ("&gt;=1.20 &lt;1.21" — AND через пробел, "||" — OR) или массив строк (OR).
 */
export function matchesFabric(version: string, predicate: string | string[] | undefined): boolean {
  if (predicate === undefined) return true;
  const ors = Array.isArray(predicate) ? predicate : predicate.split('||');
  if (!ors.length) return true;
  return ors.some((or) =>
    or
      .trim()
      .replace(/(>=|<=|>|<|=|~|\^)\s+/g, '$1')
      .split(/\s+/)
      .every((p) => matchSingle(version, p)),
  );
}

/** Maven-диапазон: "[1.20.1,1.21)", "[47,)", "1.20.1" (мягкое требование = любое), объединение через запятую между скобками. */
export function matchesMaven(version: string, range: string | undefined, opts: { lenientUpper?: boolean } = {}): boolean {
  if (!range) return true;
  range = range.trim();
  if (!range || range === '*') return true;
  if (!/^[[(]/.test(range)) return true; // «рекомендованная» версия — не ограничение
  const sets = range.match(/[[(][^\])]*[\])]/g) ?? [];
  return sets.some((set) => {
    const lowInc = set[0] === '[';
    const highInc = set[set.length - 1] === ']';
    const inner = set.slice(1, -1);
    if (!inner.includes(',')) return compareVersions(version, inner.trim()) === 0;
    const [lo, hi] = inner.split(',').map((s) => s.trim());
    if (lo) {
      const c = compareVersions(version, lo);
      if (lowInc ? c < 0 : c <= 0) return false;
    }
    if (hi) {
      const c = compareVersions(version, hi);
      // FML на практике пропускает версию, равную исключающей верхней границе (напр. JEI "[1.21, 1.21.1)" на 1.21.1)
      if (highInc || opts.lenientUpper ? c > 0 : c >= 0) return false;
    }
    return true;
  });
}
