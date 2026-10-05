import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Archive, Boxes, Check, FileArchive, FolderOpen, Gamepad2, Hammer, Layers, Package, Square, Trash2 } from 'lucide-react';
import { api, isElectron } from '../api';
import { useStore } from '../store';
import { IssueRow } from './ui';
import { fmtBytes, plural } from '../util';
import type { BuildStage, BuildTarget, Pack } from '../../shared/types';

const TARGETS: { id: BuildTarget; title: string; sub: string; icon: typeof Package }[] = [
  { id: 'official', title: 'Официальный лаунчер', sub: 'Загрузчик + профиль. Откройте лаунчер и жмите «Играть»', icon: Gamepad2 },
  { id: 'shared', title: 'TLauncher и другие лаунчеры', sub: 'Загрузчик в versions, моды в .minecraft/mods. В лаунчере выберите появившуюся версию', icon: Boxes },
  { id: 'zip', title: 'ZIP-архив .minecraft', sub: 'Один файл: распакуйте в .minecraft и выберите версию. Удобно скинуть другу', icon: FileArchive },
  { id: 'prism', title: 'Prism Launcher / MultiMC', sub: 'Готовый инстанс или zip для импорта', icon: Layers },
  { id: 'mrpack', title: 'Modrinth .mrpack', sub: 'Файл сборки для Modrinth App и других лаунчеров', icon: Package },
  { id: 'cfzip', title: 'CurseForge .zip', sub: 'Архив для импорта в CurseForge App', icon: Archive },
];

const STAGES: { id: BuildStage; label: string }[] = [
  { id: 'resolve', label: 'Зависимости' },
  { id: 'download', label: 'Загрузка' },
  { id: 'verify', label: 'Проверка' },
  { id: 'loader', label: 'Загрузчик' },
  { id: 'install', label: 'Установка' },
];

const ORDER: BuildStage[] = ['resolve', 'download', 'verify', 'loader', 'install', 'done'];

export function BuildTab({ pack, openMods }: { pack: Pack; openMods: () => void }) {
  const { build, setBuild, refreshPacks, toast, settings, updatePack } = useStore();
  const [targets, setTargets] = useState<BuildTarget[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('gx.targets') ?? '') as BuildTarget[];
    } catch {
      return ['official'];
    }
  });
  const termRef = useRef<HTMLDivElement>(null);
  const mine = build?.packId === pack.id ? build : null;
  const otherRunning = build?.running && build.packId !== pack.id;

  useEffect(() => {
    try {
      localStorage.setItem('gx.targets', JSON.stringify(targets));
    } catch {
      /* ignore */
    }
  }, [targets]);

  useEffect(() => {
    termRef.current?.scrollTo({ top: termRef.current.scrollHeight });
  }, [mine?.logs.length]);

  const removeEntry = (key: string) =>
    updatePack(pack.id, (p) => ({
      ...p,
      entries: p.entries.filter((e) => e.key !== key).map((e) => ({ ...e, requiredBy: e.requiredBy.filter((r) => r !== key) })),
    }));

  const toggle = (t: BuildTarget) => setTargets((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]));

  const start = async () => {
    setBuild({ packId: pack.id, running: true, progress: null, logs: [], report: null, stagesDone: [] });
    const offP = api.build.onProgress((p) =>
      setBuild((b) => {
        if (!b) return b;
        const idx = ORDER.indexOf(p.stage);
        return { ...b, progress: p, stagesDone: ORDER.slice(0, Math.max(0, idx)) };
      }),
    );
    const offL = api.build.onLog((l) => setBuild((b) => (b ? { ...b, logs: [...b.logs.slice(-600), l] } : b)));
    try {
      const report = await api.build.start({ packId: pack.id, targets });
      setBuild((b) => (b ? { ...b, running: false, report, stagesDone: report.ok ? ORDER : b.stagesDone } : b));
      await refreshPacks();
      if (report.ok) toast({ kind: 'ok', title: 'Сборка готова к запуску!', detail: `${report.modCount} ${plural(report.modCount, 'файл', 'файла', 'файлов')} · ${fmtBytes(report.totalBytes)}` });
      else toast({ kind: 'error', title: 'Сборка не завершена', detail: 'Посмотрите список проблем ниже' });
    } catch (e) {
      setBuild((b) => (b ? { ...b, running: false, logs: [...b.logs, { t: Date.now(), level: 'error', text: (e as Error).message }] } : b));
      toast({ kind: 'error', title: 'Ошибка сборки', detail: (e as Error).message });
    } finally {
      offP();
      offL();
    }
  };

  const p = mine?.progress;
  const stageIdx = p ? ORDER.indexOf(p.stage) : -1;
  const overall = mine?.report?.ok ? 1 : p ? Math.min(1, (stageIdx + Math.min(1, p.progress)) / 5) : 0;
  const report = mine?.report ?? (mine ? null : pack.lastBuild ?? null);
  const enabled = pack.entries.filter((e) => e.enabled).length;

  const stageOf = (id: BuildStage) => {
    const i = ORDER.indexOf(id);
    if (report?.ok && !mine?.running) return 1;
    if (!mine) return 0;
    if (mine.stagesDone.includes(id)) return 1;
    if (mine.running && p?.stage === id) return Math.max(0.04, Math.min(1, p.progress));
    return i < stageIdx ? 1 : 0;
  };
  const statusWord = mine?.running ? 'идёт сборка' : report?.ok ? 'готово' : report ? 'есть проблемы' : 'ожидание';

  return (
    <div className="build-grid">
      <div className="card" style={{ padding: 20 }}>
        <div className="label" style={{ marginBottom: 12 }}>Куда установить</div>
        <div className="targets" style={{ marginTop: 14 }}>
          {TARGETS.map((t) => (
            <div key={t.id} className={`target ${targets.includes(t.id) ? 'on' : ''}`} onClick={() => !mine?.running && toggle(t.id)}>
              <div className="ic">
                <t.icon size={19} />
              </div>
              <div>
                <div className="n">{t.title}</div>
                <div className="s">{t.sub}</div>
              </div>
              <div className="check">{targets.includes(t.id) && <Check size={13} strokeWidth={3.5} />}</div>
            </div>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 12, margin: '14px 0 18px', lineHeight: 1.6 }}>
          {settings?.minecraftDir && (
            <>
              Папка игры: <span className="mono">{settings.minecraftDir}</span>
              <br />
            </>
          )}
          Архивы сохраняются в «Документы / Guloxy MC».
        </div>
        {mine?.running ? (
          <button className="btn lg danger" style={{ width: '100%' }} onClick={() => api.build.cancel()}>
            <Square size={14} /> Остановить
          </button>
        ) : (
          <button className="btn xl primary" style={{ width: '100%' }} disabled={!targets.length || !enabled || !!otherRunning} onClick={start}>
            <Hammer size={20} strokeWidth={2.4} /> {report ? 'Пересобрать' : 'Собрать'}
          </button>
        )}
        {!enabled && (
          <div className="muted" style={{ textAlign: 'center', marginTop: 12, fontSize: 13 }}>
            Сначала{' '}
            <a href="#" onClick={(e) => (e.preventDefault(), openMods())}>
              добавьте моды
            </a>
          </div>
        )}
        {otherRunning && <div className="muted" style={{ textAlign: 'center', marginTop: 12, fontSize: 13 }}>Уже собирается другая сборка</div>}
        {!isElectron && <div className="muted" style={{ textAlign: 'center', marginTop: 12, fontSize: 12 }}>Веб-превью: сборка симулируется</div>}
      </div>

      <div style={{ display: 'grid', gap: 20 }}>
        <div className="card status-panel">
          <div className="status-top">
            <div className="pct">
              {Math.round(overall * 100)}
              <small>%</small>
            </div>
            <div style={{ minWidth: 0, paddingBottom: 4 }}>
              <div className="label" style={{ marginBottom: 8, color: mine?.running ? 'var(--ice)' : report ? (report.ok ? 'var(--ok)' : 'var(--bad)') : undefined }}>
                ● {statusWord}
              </div>
              <div className="headline">
                {mine?.running ? p?.message ?? 'Подготовка…' : report ? (report.ok ? 'Запустится с первого раза' : 'Нужно исправить проблемы') : 'Готовы собрать?'}
              </div>
              <div className="muted mono" style={{ fontSize: 12 }}>
                {mine?.running && p?.bytesTotal ? `${fmtBytes(p.bytesDone ?? 0)} / ${fmtBytes(p.bytesTotal)}` : null}
                {!mine?.running && report && `${report.modCount} файлов · ${fmtBytes(report.totalBytes)} · загрузчик ${report.loaderVersion} · ${(report.durationMs / 1000).toFixed(1)} с`}
                {!mine?.running && !report && `${enabled} ${plural(enabled, 'мод', 'мода', 'модов')} · зависимости, загрузчик и проверка — автоматически`}
              </div>
            </div>
          </div>
          <div className="stages">
            {STAGES.map((s, i) => {
              const v = stageOf(s.id);
              const active = !!mine?.running && p?.stage === s.id;
              const done = v >= 1 && !active;
              return (
                <div key={s.id} className={`stage ${active ? 'active' : ''} ${done ? 'done' : ''}`}>
                  <div className="bar">
                    <motion.div className="fill" initial={false} animate={{ scaleX: v }} transition={{ duration: 0.25 }} />
                  </div>
                  <div className="lbl">
                    {i + 1}. {s.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <AnimatePresence>
          {report && !mine?.running && report.ok && report.outputs.length > 0 && (
            <motion.div className="hero success" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
              {pack.cover && <img className="shot" src={pack.cover} alt="" />}
              <div className="content">
                <div className="kicker">
                  <span className="pill" style={{ background: 'rgba(79,209,139,.2)', color: '#a6ecc5' }}>✓ Проверено</span>
                </div>
                <h3 className="h-display" style={{ marginTop: 12 }}>Можно играть</h3>
                <div style={{ marginBottom: 10, color: 'var(--text-2)' }}>
                  Всё скачано и проверено — докачивать ничего не придётся.
                </div>
                {report.outputs.map((o) => (
                  <div className="output" key={o.target + o.path}>
                    {o.target === 'official' || o.target === 'shared' ? <Gamepad2 size={18} /> : o.target === 'prism' ? <Layers size={18} /> : <Package size={18} />}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800 }}>{TARGETS.find((t) => t.id === o.target)?.title}</div>
                      {o.note && <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{o.note}</div>}
                      <div className="p">{o.path}</div>
                    </div>
                    <button className="btn sm" onClick={() => api.shell.openPath(o.path.endsWith('.zip') || o.path.endsWith('.mrpack') ? o.path.replace(/[\\/][^\\/]+$/, '') : o.path)}>
                      <FolderOpen size={14} /> Открыть
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {report && report.issues.length > 0 && (
          <div className="card" style={{ padding: 20 }}>
            <div className="row between" style={{ marginBottom: 12 }}>
              <div className="label">Отчёт проверки</div>
              {!report.ok && (
                <button className="btn sm" onClick={openMods}>
                  К модам
                </button>
              )}
            </div>
            <div className="issues">
              {[...report.issues]
                .sort((a, b) => ['error', 'warning', 'fixed', 'info'].indexOf(a.level) - ['error', 'warning', 'fixed', 'info'].indexOf(b.level))
                .map((i, n) => (
                  <IssueRow
                    key={n}
                    issue={i}
                    action={
                      i.level === 'error' && i.entryKey && pack.entries.some((e) => e.key === i.entryKey) ? (
                        <button className="btn sm danger" onClick={() => removeEntry(i.entryKey!)}>
                          <Trash2 size={13} /> Убрать
                        </button>
                      ) : undefined
                    }
                  />
                ))}
            </div>
          </div>
        )}

        {mine && (
          <div className="card" style={{ padding: 20 }}>
            <div className="row between" style={{ marginBottom: 12 }}>
              <div className="label">Журнал</div>
              {mine.report && (
                <span style={{ fontSize: 12.5, fontWeight: 600, color: mine.report.ok ? 'var(--ok)' : 'var(--bad)' }}>
                  {mine.report.ok ? 'Успешно' : 'С ошибками'}
                </span>
              )}
            </div>
            <div className="terminal" ref={termRef}>
              {mine.logs.map((l, i) => (
                <div className="l" key={i}>
                  <span className="time">{new Date(l.t).toLocaleTimeString('ru-RU')}</span>
                  <span className={l.level}>{l.text}</span>
                </div>
              ))}
              {mine.running && <span className="caret" />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
