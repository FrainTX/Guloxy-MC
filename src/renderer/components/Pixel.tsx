import type { Pack } from '../../shared/types';

/** Знак Guloxy: огранённый «алмаз» с буквой G. */
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-label="Guloxy">
      <path d="M24 2 44 13.5v21L24 46 4 34.5v-21L24 2Z" fill="#8fd3ff" />
      <path d="M24 2 44 13.5 24 25 4 13.5 24 2Z" fill="#b9e4ff" />
      <path d="M24 25v21L4 34.5v-21L24 25Z" fill="#5cb8f5" />
      <path d="M30.5 21.5a7.2 7.2 0 1 0 1.3 5.5H25" fill="none" stroke="#04121e" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const TINTS = ['#24435e', '#2c3b6b', '#1f4a48', '#4a2c3e', '#2f4630', '#3a3550', '#1e3d55'];

function tint(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || 'G'
  );
}

/** Аватар сборки: кадр из её модов или инициалы на спокойном цвете. */
export function PackAvatar({ pack, size = 44, radius }: { pack: Pick<Pack, 'id' | 'name' | 'cover'>; size?: number; radius?: number }) {
  return (
    <div
      className="avatar"
      style={{ width: size, height: size, borderRadius: radius ?? Math.round(size * 0.3), background: tint(pack.id), fontSize: size * 0.38 }}
    >
      {pack.cover ? <img src={pack.cover} alt="" /> : <span>{initials(pack.name)}</span>}
    </div>
  );
}
