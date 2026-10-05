import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Download } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';
import { fmtBytes, timeAgo } from '../util';
import { Index } from './ui';
import { initials } from './Pixel';
import { LOADER_NAMES } from '../../shared/types';

export function Home() {
  const { packs, go, setNewPackOpen, refreshPacks, toast, showcase, loadShowcase, setBackdrop } = useStore();
  const [idx, setIdx] = useState(0);
  const totalMods = packs.reduce((s, p) => s + p.entries.filter((e) => e.enabled).length, 0);
  const built = packs.filter((p) => p.lastBuild?.ok).length;
  const totalSize = packs.reduce((s, p) => s + (p.lastBuild?.totalBytes ?? 0), 0);

  useEffect(() => {
    void loadShowcase();
  }, [loadShowcase]);

  useEffect(() => {
    if (showcase.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % Math.min(showcase.length, 6)), 9000);
    return () => clearInterval(t);
  }, [showcase.length]);

  const shot = showcase[idx];
  useEffect(() => {
    setBackdrop(shot?.thumb ?? null);
  }, [shot, setBackdrop]);

  const doImport = async () => {
    try {
      const p = await api.packs.importFile();
      if (p) {
        await refreshPacks();
        go({ name: 'pack', id: p.id });
      }
    } catch (e) {
      toast({ kind: 'error', title: 'Не удалось импортировать', detail: (e as Error).message });
    }
  };

  return (
    <div className="page">
      <section className="hero">
        <AnimatePresence>
          {shot && (
            <motion.img
              key={shot.image}
              className="shot"
              src={shot.image}
              alt=""
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.2 }}
            />
          )}
        </AnimatePresence>
        <motion.div className="content" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
          <Index pill="Guloxy MC">Конструктор сборок Minecraft</Index>
          <h1 className="h-display">
            Собери. <span className="ice">Запусти.</span>
            <br />
            Играй.
          </h1>
          <p>Моды из Modrinth и CurseForge, зависимости, проверка совместимости и установка в лаунчер. Сборка стартует с первого раза.</p>
          <div className="row wrap" style={{ gap: 12 }}>
            <button className="btn xl primary" onClick={() => setNewPackOpen(true)}>
              Создать сборку <ArrowRight size={20} strokeWidth={2.5} />
            </button>
            <button className="btn lg glass" onClick={doImport}>
              <Download size={17} /> Импорт сборки
            </button>
          </div>
        </motion.div>
        {shot && (
          <div className="credit">
            <span>Кадр: {shot.title}</span>
            <span className="dots">
              {showcase.slice(0, 6).map((s, i) => (
                <i key={s.image} className={i === idx ? 'on' : ''} onClick={() => setIdx(i)} />
              ))}
            </span>
          </div>
        )}
      </section>

      <div className="stats">
        {[
          { v: packs.length, k: 'сборок' },
          { v: totalMods, k: 'модов в сборках' },
          { v: built, k: 'готовы к запуску' },
          { v: fmtBytes(totalSize), k: 'скачано' },
        ].map((s) => (
          <div key={s.k} className="card stat">
            <div className="v">{s.v}</div>
            <div className="k">{s.k}</div>
          </div>
        ))}
      </div>

      {packs.length > 0 && (
        <>
          <div className="section-title">
            <h2>Мои сборки</h2>
          </div>
          <div className="tiles">
            {packs.slice(0, 8).map((p, i) => (
              <motion.div
                key={p.id}
                className="tile"
                onClick={() => go({ name: 'pack', id: p.id })}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                {p.cover || showcase[(i + 2) % Math.max(1, showcase.length)] ? (
                  <img className="cover" src={p.cover ?? showcase[(i + 2) % showcase.length].thumb} alt="" />
                ) : (
                  <div className="cover" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontFamily: 'var(--display)', fontSize: 64 }}>
                    {initials(p.name)}
                  </div>
                )}
                <div className="body">
                  <div className="nm">{p.name}</div>
                  <div className="sb">
                    {p.mcVersion} · {LOADER_NAMES[p.loader]} · {p.entries.filter((e) => e.enabled).length} модов
                    {p.lastBuild && (
                      <span style={{ color: p.lastBuild.ok ? 'var(--ok)' : 'var(--bad)' }}>
                        {' '}
                        · {p.lastBuild.ok ? 'собрана' : 'ошибка'} {timeAgo(p.lastBuild.finishedAt)}
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </>
      )}

      {showcase.length > 6 && (
        <>
          <div className="section-title">
            <h2>Шейдеры, которые меняют всё</h2>
            <span className="muted" style={{ fontSize: 13 }}>
              Добавьте их в сборку из каталога
            </span>
          </div>
          <div className="tiles">
            {showcase.slice(6, 14).map((s) => (
              <div key={s.image} className="tile" onClick={() => api.shell.openExternal(s.url)}>
                <img className="cover" src={s.thumb} alt="" loading="lazy" />
                <div className="body">
                  <div className="nm">{s.title}</div>
                  <div className="sb">Modrinth · шейдер</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
