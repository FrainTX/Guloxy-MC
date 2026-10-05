import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Compass, Hammer } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';
import { LOADER_NAMES, type CatalogItem, type PackEntry } from '../../shared/types';
import { ModsTab } from './ModsTab';
import { CatalogTab } from './CatalogTab';
import { BuildTab } from './BuildTab';
import { PackSettingsTab } from './PackSettingsTab';
import { ProjectDrawer } from './ProjectDrawer';
import { PackAvatar } from './Pixel';
import { timeAgo } from '../util';

export type Tab = 'mods' | 'catalog' | 'build' | 'settings';

export type DrawerTarget = { item?: CatalogItem; entry?: PackEntry } | null;

export function PackView({ id }: { id: string }) {
  const pack = useStore((s) => s.packs.find((p) => p.id === id));
  const { refreshPacks, setBackdrop, showcase, loadShowcase } = useStore();
  const [tab, setTab] = useState<Tab>('mods');
  const [drawer, setDrawer] = useState<DrawerTarget>(null);
  const modCount = pack?.entries.length ?? 0;

  // Обложка сборки — кадр из галереи одного из её модов
  useEffect(() => {
    if (!pack || pack.cover || !modCount) return;
    let alive = true;
    api.packs
      .cover(pack.id)
      .then((c) => {
        if (alive && c) void refreshPacks();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack?.id, pack?.cover, modCount]);

  useEffect(() => {
    void loadShowcase();
  }, [loadShowcase]);

  const fallback = showcase.length ? showcase[(id.charCodeAt(0) + id.charCodeAt(1)) % showcase.length] : undefined;
  const cover = pack?.cover ?? fallback?.image;

  useEffect(() => {
    setBackdrop(pack?.cover ?? fallback?.thumb ?? null);
  }, [pack?.cover, fallback, setBackdrop]);

  if (!pack) return <div className="page muted">Сборка не найдена</div>;

  const enabled = pack.entries.filter((e) => e.enabled);
  const userCount = enabled.filter((e) => e.addedBy === 'user').length;
  const lb = pack.lastBuild;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'mods', label: 'Моды', count: enabled.length },
    { id: 'catalog', label: 'Каталог' },
    { id: 'build', label: 'Сборка' },
    { id: 'settings', label: 'Параметры' },
  ];

  return (
    <div className="page">
      <section className="hero pack-hero" key={pack.id}>
        {cover && <img className="shot" src={cover} alt="" />}
        <div className="content">
          <PackAvatar pack={pack} size={112} radius={28} />
          <div style={{ minWidth: 0 }}>
            <div className="kicker">
              <span className="pill">
                Minecraft {pack.mcVersion} · {LOADER_NAMES[pack.loader]}
              </span>
              {lb && <span style={{ color: lb.ok ? 'var(--ok)' : 'var(--bad)' }}>{lb.ok ? `● собрана ${timeAgo(lb.finishedAt)}` : '● ошибка сборки'}</span>}
            </div>
            <h1 className="h-display">{pack.name}</h1>
            <div className="chips">
              <span className="chip">{userCount} выбрано</span>
              <span className="chip">{enabled.length - userCount} подтянуто автоматически</span>
              <span className="chip">{(pack.memoryMb / 1024).toFixed(1)} ГБ ОЗУ</span>
              <span className="chip">версия {pack.version}</span>
            </div>
            <div className="actions">
              <button className="btn xl primary" onClick={() => setTab('build')}>
                <Hammer size={19} strokeWidth={2.4} /> {lb ? 'Пересобрать' : 'Собрать'}
              </button>
              <button className="btn lg glass" onClick={() => setTab('catalog')}>
                <Compass size={18} /> Добавить моды
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
            {tab === t.id && <motion.div layoutId="tabpill" className="pillbg" transition={{ type: 'spring', damping: 30, stiffness: 380 }} />}
            {t.label}
            {t.count !== undefined && <span className="count">{t.count}</span>}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          {tab === 'mods' && <ModsTab pack={pack} openCatalog={() => setTab('catalog')} openBuild={() => setTab('build')} onOpen={(entry) => setDrawer({ entry })} />}
          {tab === 'catalog' && <CatalogTab pack={pack} onOpen={(item) => setDrawer({ item })} />}
          {tab === 'build' && <BuildTab pack={pack} openMods={() => setTab('mods')} />}
          {tab === 'settings' && <PackSettingsTab pack={pack} />}
        </motion.div>
      </AnimatePresence>

      <ProjectDrawer pack={pack} target={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}
