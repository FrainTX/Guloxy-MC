import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Check, Download, KeyRound, Loader2, Plus, Search } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';
import { ModIcon, Seg, SourceBadge } from './ui';
import { fmtNum, timeAgo } from '../util';
import type { CatalogItem, ContentKind, Pack, PackEntry, SearchQuery, Source } from '../../shared/types';

export function entryFromItem(item: CatalogItem): PackEntry {
  return {
    key: `${item.source}:${item.projectId}`,
    source: item.source,
    projectId: item.projectId,
    slug: item.slug,
    title: item.title,
    author: item.author,
    iconUrl: item.iconUrl,
    kind: item.kind,
    addedBy: 'user',
    requiredBy: [],
    enabled: true,
  };
}

export function useAddRemove(pack: Pack) {
  const { updatePack, toast } = useStore();
  const has = (item: { source: Source; projectId: string }) =>
    pack.entries.some((e) => e.key === `${item.source}:${item.projectId}` && e.addedBy === 'user');
  const add = async (item: CatalogItem) => {
    const key = `${item.source}:${item.projectId}`;
    await updatePack(pack.id, (p) => {
      const existing = p.entries.find((e) => e.key === key);
      if (existing) {
        existing.addedBy = 'user';
        existing.enabled = true;
        return p;
      }
      return { ...p, entries: [...p.entries, entryFromItem(item)] };
    });
    toast({ kind: 'ok', title: `${item.title} добавлен`, detail: 'Зависимости подтянутся при сборке' });
  };
  const remove = async (item: { source: Source; projectId: string }) => {
    const key = `${item.source}:${item.projectId}`;
    await updatePack(pack.id, (p) => ({ ...p, entries: p.entries.filter((e) => e.key !== key) }));
  };
  return { has, add, remove };
}

const PAGE = 24;

export function CatalogTab({ pack, onOpen }: { pack: Pack; onOpen: (item: CatalogItem) => void }) {
  const { settings, go } = useStore();
  const [source, setSource] = useState<Source>('modrinth');
  const [kind, setKind] = useState<ContentKind>('mod');
  const [sort, setSort] = useState<SearchQuery['sort']>('relevance');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const reqId = useRef(0);
  const { has, add, remove } = useAddRemove(pack);

  const noKey = source === 'curseforge' && !settings?.curseforgeApiKey && !settings?.builtinCurseforgeKey;

  const load = async (offset: number) => {
    if (noKey) return;
    const id = ++reqId.current;
    setLoading(true);
    setError('');
    try {
      const r = await api.catalog.search({ source, query, kind, mcVersion: pack.mcVersion, loader: pack.loader, sort, offset, limit: PAGE });
      if (id !== reqId.current) return;
      setItems((prev) => (offset ? [...prev, ...r.items] : r.items));
      setTotal(r.total);
    } catch (e) {
      if (id === reqId.current) setError((e as Error).message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => load(0), query ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, kind, sort, query, pack.mcVersion, pack.loader, noKey]);

  return (
    <div>
      <div className="catalog-bar">
        <div className="row">
          <div className="search">
            <Search size={20} />
            <input
              className="input"
              placeholder={`Искать ${kind === 'mod' ? 'моды' : kind === 'shader' ? 'шейдеры' : 'ресурспаки'} для ${pack.mcVersion}…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="row wrap">
          <Seg<Source>
            value={source}
            onChange={setSource}
            options={[
              { value: 'modrinth', label: <>Modrinth</> },
              { value: 'curseforge', label: <>CurseForge</> },
            ]}
          />
          <Seg<ContentKind>
            value={kind}
            onChange={setKind}
            options={[
              { value: 'mod', label: 'Моды' },
              { value: 'resourcepack', label: 'Ресурспаки' },
              { value: 'shader', label: 'Шейдеры' },
            ]}
          />
          <div className="grow" />
          <select className="select" style={{ width: 230, height: 44 }} value={sort} onChange={(e) => setSort(e.target.value as SearchQuery['sort'])}>
            <option value="relevance">По релевантности</option>
            <option value="downloads">По скачиваниям</option>
            <option value="updated">Недавно обновлённые</option>
            <option value="newest">Новые</option>
          </select>
          <span className="muted mono" style={{ fontSize: 12 }}>
            {fmtNum(total)} найдено
          </span>
        </div>
      </div>

      {noKey ? (
        <div className="empty">
          <KeyRound size={44} />
          <div className="big">Нужен API-ключ CurseForge</div>
          <p>Получите бесплатный ключ на console.curseforge.com и вставьте его в настройках приложения.</p>
          <button className="btn lg primary" style={{ marginTop: 12 }} onClick={() => go({ name: 'settings' })}>
            <KeyRound size={18} /> Открыть настройки
          </button>
        </div>
      ) : error ? (
        <div className="empty">
          <div className="big">Не удалось загрузить каталог</div>
          <p>{error}</p>
          <button className="btn" onClick={() => load(0)}>
            Повторить
          </button>
        </div>
      ) : (
        <>
          <div className="cat-grid">
            {items.map((it, i) => {
              const added = has(it);
              return (
                <motion.div
                  key={`${it.source}:${it.projectId}`}
                  className="cat-card"
                  onClick={() => onOpen(it)}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: Math.min(i % PAGE, 12) * 0.03 }}
                >
                  <div className={`cv ${it.cover ? '' : 'blur'}`}>{(it.cover || it.iconUrl) && <img src={it.cover || it.iconUrl} alt="" loading="lazy" />}</div>
                  <div className="body">
                    <ModIcon src={it.iconUrl} title={it.title} />
                    <h4>{it.title}</h4>
                    <p>{it.description}</p>
                    <div className="foot">
                      <SourceBadge source={it.source} />
                      <span>
                        <Download size={12} style={{ verticalAlign: -2 }} /> {fmtNum(it.downloads)}
                      </span>
                      {it.updatedAt && <span>{timeAgo(it.updatedAt)}</span>}
                      {it.author && <span>{it.author}</span>}
                    </div>
                  </div>
                  <button
                    className={`add-fab ${added ? 'added' : ''}`}
                    title={added ? 'Убрать из сборки' : 'Добавить в сборку'}
                    onClick={(e) => {
                      e.stopPropagation();
                      void (added ? remove(it) : add(it));
                    }}
                  >
                    {added ? <Check size={18} strokeWidth={2.6} /> : <Plus size={19} strokeWidth={2.4} />}
                  </button>
                </motion.div>
              );
            })}
            {loading && !items.length && Array.from({ length: 9 }, (_, i) => <div key={i} className="skeleton" />)}
          </div>
          {!loading && !items.length && (
            <div className="empty">
              <div className="big">Ничего не найдено</div>
              <p>Попробуйте другой запрос или источник.</p>
            </div>
          )}
          {items.length < total && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 22 }}>
              <button className="btn lg" disabled={loading} onClick={() => load(items.length)}>
                {loading ? <Loader2 size={18} className="spin" /> : null} Показать ещё
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
