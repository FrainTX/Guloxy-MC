import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Download, ExternalLink, Loader2, Pin, PinOff, Plus, X } from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { api } from '../api';
import { useStore } from '../store';
import { ModIcon, SourceBadge } from './ui';
import { useAddRemove } from './CatalogTab';
import { fmtBytes, fmtNum, timeAgo } from '../util';
import type { CatalogItem, Pack, ProjectDetails } from '../../shared/types';
import type { DrawerTarget } from './PackView';

function renderBody(body: string, source: CatalogItem['source']) {
  const html = source === 'modrinth' ? (marked.parse(body, { async: false }) as string) : body;
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['iframe', 'script', 'style', 'form', 'input'], FORBID_ATTR: ['style', 'onerror', 'onclick'] });
}

export function ProjectDrawer({ pack, target, onClose }: { pack: Pack; target: DrawerTarget; onClose: () => void }) {
  const { updatePack } = useStore();
  const [details, setDetails] = useState<ProjectDetails | null>(null);
  const [error, setError] = useState('');
  const { has, add, remove } = useAddRemove(pack);

  const base = useMemo(() => {
    if (!target) return null;
    if (target.item) return target.item;
    const e = target.entry!;
    return { source: e.source, projectId: e.projectId, title: e.title, iconUrl: e.iconUrl, kind: e.kind } as CatalogItem;
  }, [target]);

  useEffect(() => {
    if (!base) return;
    let alive = true;
    setDetails(null);
    setError('');
    api.catalog
      .details(base.source, base.projectId, pack.mcVersion, pack.loader, base.kind)
      .then((d) => alive && setDetails(d))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [base, pack.mcVersion, pack.loader]);

  const entry = base ? pack.entries.find((e) => e.key === `${base.source}:${base.projectId}`) : undefined;
  const item = details?.item ?? base;
  const autoPick = useMemo(() => {
    const vs = details?.versions ?? [];
    return (vs.find((v) => v.channel === 'release' || (pack.allowBeta && v.channel === 'beta')) ?? vs.find((v) => v.channel === 'beta') ?? vs[0])?.versionId;
  }, [details, pack.allowBeta]);
  const html = useMemo(() => (details ? renderBody(details.body, details.item.source) : ''), [details]);

  const pin = (versionId: string | undefined) =>
    entry && updatePack(pack.id, (p) => ({ ...p, entries: p.entries.map((e) => (e.key === entry.key ? { ...e, pinnedVersionId: versionId, autoPinned: false } : e)) }));

  useEffect(() => {
    if (!target) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [target, onClose]);

  return (
    <AnimatePresence>
      {target && item && (
        <>
          <motion.div className="overlay" style={{ background: 'rgba(3,5,8,.55)' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            className="drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 300 }}
          >
            <div className="drawer-head">
              <button className="btn icon glass" style={{ position: 'absolute', right: 16, top: 16, zIndex: 3 }} onClick={onClose}>
                <X size={19} />
              </button>
              <div className="cover">{(details?.gallery[0] || item.cover) && <img src={details?.gallery[0] || item.cover} alt="" />}</div>
              <div className="inner">
                <ModIcon src={item.iconUrl} title={item.title} />
                <div style={{ minWidth: 0, paddingBottom: 4 }}>
                  <div className="row" style={{ marginBottom: 6, gap: 14 }}>
                    <SourceBadge source={item.source} />
                    {details && (
                      <span className="muted" style={{ fontSize: 12.5 }}>
                        <Download size={12} style={{ verticalAlign: -2 }} /> {fmtNum(details.item.downloads)}
                      </span>
                    )}
                    {details?.item.author && <span className="muted" style={{ fontSize: 12.5 }}>от {details.item.author}</span>}
                  </div>
                  <h2 className="h-display" style={{ fontSize: 40 }}>
                    {item.title}
                  </h2>
                </div>
              </div>
              <div style={{ padding: '0 30px' }}>
                {details && <p style={{ color: 'var(--text-2)', margin: '18px 0 0', fontSize: 15 }}>{details.item.description}</p>}
                <div className="row wrap" style={{ marginTop: 18 }}>
                  {has(item) ? (
                    <button className="btn lg" onClick={() => remove(item)}>
                      <Check size={17} style={{ color: 'var(--ok)' }} /> В сборке — убрать
                    </button>
                  ) : (
                    <button className="btn lg primary" onClick={() => details && add(details.item)} disabled={!details}>
                      <Plus size={18} strokeWidth={2.4} /> Добавить в сборку
                    </button>
                  )}
                  {details?.links.map((l) => (
                    <button key={l.url} className="btn ghost sm" onClick={() => api.shell.openExternal(l.url)}>
                      <ExternalLink size={14} /> {l.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="drawer-body">
              {error && <div className="issue error">{error}</div>}
              {!details && !error && (
                <div className="row muted" style={{ padding: 30, justifyContent: 'center' }}>
                  <Loader2 className="spin" /> Загружаю описание…
                </div>
              )}
              {details && (
                <>
                  <div className="label" style={{ margin: '6px 0 10px' }}>
                    Версии для {pack.mcVersion} · {pack.loader}
                    {entry && <span className="muted"> — нажмите, чтобы закрепить</span>}
                  </div>
                  {details.versions.length ? (
                    <div className="versions">
                      {details.versions.slice(0, 40).map((v) => {
                        const pinned = entry?.pinnedVersionId === v.versionId;
                        return (
                          <div
                            key={v.versionId}
                            className={`version-row ${pinned ? 'on' : ''}`}
                            onClick={() => entry && pin(pinned ? undefined : v.versionId)}
                            title={entry ? (pinned ? 'Открепить' : 'Закрепить эту версию') : 'Сначала добавьте мод в сборку'}
                          >
                            {pinned ? <Pin size={14} style={{ color: 'var(--ice)' }} /> : v.versionId === autoPick && !entry?.pinnedVersionId ? <Check size={14} style={{ color: 'var(--ok)' }} /> : <PinOff size={14} className="muted" />}
                            <span className="vn">{v.versionName}</span>
                            <span className={`tag ${v.channel === 'release' ? '' : 'pin'}`}>{v.channel}</span>
                            <span className="muted mono" style={{ fontSize: 11 }}>
                              {fmtBytes(v.size)} · {timeAgo(v.published)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="issue warning">
                      <div />
                      <div>
                        <div className="it">Нет версий для {pack.mcVersion}</div>
                        <div className="id">Мод нельзя будет установить в эту сборку.</div>
                      </div>
                    </div>
                  )}

                  {details.gallery.length > 0 && (
                    <div className="gallery">
                      {details.gallery.slice(1, 9).map((g) => (
                        <img key={g} src={g} alt="" loading="lazy" />
                      ))}
                    </div>
                  )}
                  <div className="md" dangerouslySetInnerHTML={{ __html: html }} onClick={(e) => {
                    const a = (e.target as HTMLElement).closest('a');
                    if (a?.href) {
                      e.preventDefault();
                      api.shell.openExternal(a.href);
                    }
                  }} />
                </>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
