import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Compass, Eye, EyeOff, Hammer, Link2, Loader2, Pin, ScanSearch, Search, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';
import { IssueRow, ModIcon, Seg, SourceBadge } from './ui';
import type { Issue, Pack, PackEntry } from '../../shared/types';

type Filter = 'all' | 'user' | 'deps' | 'mod' | 'resourcepack' | 'shader';

export function ModsTab({
  pack,
  openCatalog,
  openBuild,
  onOpen,
}: {
  pack: Pack;
  openCatalog: () => void;
  openBuild: () => void;
  onOpen: (e: PackEntry) => void;
}) {
  const { updatePack, refreshPacks, toast } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [checking, setChecking] = useState(false);
  const [issues, setIssues] = useState<Issue[] | null>(null);

  const titleOf = useMemo(() => new Map(pack.entries.map((e) => [e.key, e.title])), [pack.entries]);

  const list = pack.entries
    .filter((e) => {
      if (filter === 'user') return e.addedBy === 'user';
      if (filter === 'deps') return e.addedBy !== 'user';
      if (filter === 'mod' || filter === 'resourcepack' || filter === 'shader') return e.kind === filter;
      return true;
    })
    .filter((e) => !q || e.title.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.addedBy === 'user' ? 0 : 1) - (b.addedBy === 'user' ? 0 : 1) || a.title.localeCompare(b.title));

  const errKeys = new Set((issues ?? []).filter((i) => i.level === 'error').map((i) => i.entryKey));

  const check = async () => {
    setChecking(true);
    try {
      const r = await api.packs.resolve(pack.id);
      await refreshPacks();
      setIssues(r.issues);
      const errors = r.issues.filter((i) => i.level === 'error').length;
      if (errors) toast({ kind: 'error', title: `Найдено проблем: ${errors}`, detail: 'Подробности над списком модов' });
      else toast({ kind: 'ok', title: 'Всё совместимо', detail: r.added.length ? `Добавлено зависимостей: ${r.added.length}` : 'Зависимости на месте' });
    } catch (e) {
      toast({ kind: 'error', title: 'Не удалось проверить', detail: (e as Error).message });
    } finally {
      setChecking(false);
    }
  };

  const remove = (key: string) =>
    updatePack(pack.id, (p) => ({
      ...p,
      entries: p.entries.filter((e) => e.key !== key).map((e) => ({ ...e, requiredBy: e.requiredBy.filter((r) => r !== key) })),
    }));

  const toggle = (key: string) =>
    updatePack(pack.id, (p) => ({ ...p, entries: p.entries.map((e) => (e.key === key ? { ...e, enabled: !e.enabled } : e)) }));

  if (!pack.entries.length) {
    return (
      <div className="empty">
        <Compass size={48} />
        <div className="big">Сборка пока пустая</div>
        <p>Откройте каталог и добавьте моды — зависимости подтянутся сами.</p>
        <button className="btn lg primary" style={{ marginTop: 14 }} onClick={openCatalog}>
          <Compass size={18} /> Открыть каталог
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="toolbar">
        <div className="search" style={{ maxWidth: 360 }}>
          <Search size={18} />
          <input className="input" placeholder="Поиск в сборке" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Seg<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'user', label: 'Выбранные' },
            { value: 'deps', label: 'Авто' },
            { value: 'mod', label: 'Моды' },
            { value: 'resourcepack', label: 'Ресурспаки' },
            { value: 'shader', label: 'Шейдеры' },
          ]}
        />
        <div className="grow" />
        <button className="btn" onClick={check} disabled={checking}>
          {checking ? <Loader2 size={17} className="spin" /> : <ScanSearch size={16} />} Проверить
        </button>
        <button className="btn primary" onClick={openBuild}>
          <Hammer size={17} /> Собрать
        </button>
      </div>

      {issues && issues.length > 0 && (
        <div className="issues" style={{ marginBottom: 16 }}>
          {issues.map((i, n) => (
            <IssueRow
              key={n}
              issue={i}
              action={
                i.entryKey && i.level === 'error' ? (
                  <button className="btn sm danger" onClick={() => remove(i.entryKey!).then(() => setIssues((x) => x?.filter((y) => y !== i) ?? null))}>
                    <Trash2 size={14} /> Убрать
                  </button>
                ) : undefined
              }
            />
          ))}
        </div>
      )}

      <div className="mod-list">
        <AnimatePresence initial={false}>
          {list.map((e) => (
            <motion.div
              layout
              key={e.key}
              className={`mod-row ${e.enabled ? '' : 'disabled'} ${errKeys.has(e.key) ? 'err' : ''}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
            >
              <ModIcon src={e.iconUrl} title={e.title} />
              <div style={{ minWidth: 0, cursor: 'pointer' }} onClick={() => onOpen(e)}>
                <div className="t">
                  {e.title}
                  <SourceBadge source={e.source} />
                  {e.kind !== 'mod' && <span className="tag">{e.kind === 'shader' ? 'шейдер' : 'ресурспак'}</span>}
                  {e.addedBy === 'dependency' && <span className="tag dep">зависимость</span>}
                  {e.addedBy === 'auto' && <span className="tag auto">авто</span>}
                  {e.pinnedVersionId && (
                    <span className={`tag ${e.autoPinned ? 'auto' : 'pin'}`}>
                      <Pin size={10} style={{ verticalAlign: -1 }} /> {e.autoPinned ? 'версия подобрана' : 'версия закреплена'}
                    </span>
                  )}
                </div>
                <div className="d">
                  {e.addedBy !== 'user' && (e.reason || e.requiredBy.length) ? (
                    <>
                      <Link2 size={12} style={{ verticalAlign: -2 }} />{' '}
                      {e.reason ?? `нужен для: ${e.requiredBy.map((r) => titleOf.get(r) ?? r).join(', ')}`}
                    </>
                  ) : (
                    e.author || e.slug
                  )}
                </div>
              </div>
              <div className="actions">
                {e.addedBy === 'user' && (
                  <button className="btn icon sm ghost" title={e.enabled ? 'Выключить' : 'Включить'} onClick={() => toggle(e.key)}>
                    {e.enabled ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                )}
                {e.addedBy !== 'dependency' && (
                  <button className="btn icon sm ghost danger" title="Удалить из сборки" onClick={() => remove(e.key)}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
