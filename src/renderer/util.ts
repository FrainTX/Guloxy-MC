export function fmtNum(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

export function fmtBytes(n: number): string {
  if (!n) return '0 Б';
  const u = ['Б', 'КБ', 'МБ', 'ГБ'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function timeAgo(ts: number | string): string {
  const t = typeof ts === 'string' ? Date.parse(ts) : ts;
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'только что';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} дн назад`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} мес назад`;
  return `${Math.round(mo / 12)} г назад`;
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function uid(): string {
  return crypto.randomUUID();
}

/** Подсветка под курсором для элементов с классом .spot */
export function spotlight(e: React.MouseEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
}

const TINTS = ['#24435e', '#2c3b6b', '#1f4a48', '#4a2c3e', '#2f4630', '#3a3550', '#1e3d55'];

export function paletteFor(seed: string): [string, string] {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return [TINTS[h % TINTS.length], '#8fd3ff'];
}

/** PNG-иконка для профиля лаунчера: скруглённый квадрат цвета сборки и инициалы. */
export function generatePackIcon(name: string, colors = paletteFor(name)): string {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = colors[0];
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, 30);
  ctx.fill();
  const letters =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || 'G';
  ctx.fillStyle = '#eef3f8';
  ctx.font = `700 ${letters.length > 1 ? 56 : 66}px Oswald, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letters, size / 2, size / 2 + 3);
  return c.toDataURL('image/png');
}
