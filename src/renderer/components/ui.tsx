import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import type { Issue, Loader, Source } from '../../shared/types';

export function ModIcon({ src, title, size }: { src?: string; title: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = size ? { width: size, height: size } : undefined;
  return (
    <div className="mod-icon" style={style}>
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} draggable={false} />
      ) : (
        <span>{title.slice(0, 1).toUpperCase()}</span>
      )}
    </div>
  );
}

export function SourceBadge({ source }: { source: Source }) {
  return (
    <span className={`src-badge ${source}`} title={source === 'modrinth' ? 'Modrinth' : 'CurseForge'}>
      {source === 'modrinth' ? 'MR' : 'CF'}
    </span>
  );
}

/** Спокойные цвета загрузчиков. */
export const LOADER_STYLE: Record<Loader, { glyph: string; bg: string; fg: string }> = {
  fabric: { glyph: 'F', bg: '#3a382f', fg: '#e9dfc4' },
  quilt: { glyph: 'Q', bg: '#33304f', fg: '#d6ceff' },
  forge: { glyph: 'FG', bg: '#262c36', fg: '#cfd8e3' },
  neoforge: { glyph: 'N', bg: '#3c2629', fg: '#ffb8ae' },
};

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on} />;
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} disabled={o.disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Небольшая надпись над заголовком. */
export function Index({ children, pill }: { n?: string; children: ReactNode; short?: boolean; pill?: ReactNode }) {
  return (
    <div className="kicker">
      {pill && <span className="pill">{pill}</span>}
      <span>{children}</span>
    </div>
  );
}

export function Modal({ open, onClose, children, width, banner }: { open: boolean; onClose: () => void; children: ReactNode; width?: number; banner?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} onMouseDown={onClose}>
          <motion.div
            className="modal"
            style={width ? { width: `min(${width}px, 100%)` } : undefined}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button className="btn icon glass close-x" onClick={onClose} aria-label="Закрыть">
              <X size={18} />
            </button>
            {banner && (
              <div className="banner">
                <img src={banner} alt="" />
              </div>
            )}
            <div className={`inner ${banner ? '' : 'nobanner'}`}>{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismiss);
  return (
    <div className="toasts">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className={`toast ${t.kind}`}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.16 }}
            onClick={() => dismiss(t.id)}
          >
            <span className="dt" />
            <div>
              <div className="tt">{t.title}</div>
              {t.detail && <div className="td">{t.detail}</div>}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

const ISSUE_MARK: Record<Issue['level'], string> = { error: '×', warning: '!', info: 'i', fixed: '✓' };

export function IssueRow({ issue, action }: { issue: Issue; action?: ReactNode }) {
  return (
    <div className={`issue ${issue.level}`}>
      <div className="ic">{ISSUE_MARK[issue.level]}</div>
      <div>
        <div className="it">{issue.title}</div>
        {issue.detail && <div className="id">{issue.detail}</div>}
      </div>
      {action ?? <span />}
    </div>
  );
}
