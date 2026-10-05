import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';
import { Index, Modal, Toggle, LOADER_STYLE } from './ui';
import { generatePackIcon, paletteFor, uid } from '../util';
import { LOADER_NAMES, type Loader, type LoaderVersionInfo, type McVersionInfo, type Pack } from '../../shared/types';

const LOADERS: Loader[] = ['fabric', 'neoforge', 'forge', 'quilt'];

export function MemorySlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const min = 2048;
  const max = 16384;
  const p = ((value - min) / (max - min)) * 100;
  return (
    <div className="field">
      <div className="row between">
        <label className="label">Память для игры</label>
        <span className="mono" style={{ fontWeight: 800 }}>
          {(value / 1024).toFixed(value % 1024 ? 1 : 0)} ГБ
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={512}
        value={value}
        style={{ '--p': `${p}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="row between muted" style={{ fontSize: 11 }}>
        <span>2 ГБ</span>
        <span>рекомендуем 4–8 ГБ</span>
        <span>16 ГБ</span>
      </div>
    </div>
  );
}

export function useLoaderAvailability(mc: string) {
  const [avail, setAvail] = useState<Partial<Record<Loader, LoaderVersionInfo[] | null>>>({});
  useEffect(() => {
    if (!mc) return;
    let alive = true;
    setAvail({});
    for (const l of LOADERS) {
      api.meta
        .loaderVersions(l, mc)
        .then((v) => alive && setAvail((a) => ({ ...a, [l]: v })))
        .catch(() => alive && setAvail((a) => ({ ...a, [l]: [] })));
    }
    return () => {
      alive = false;
    };
  }, [mc]);
  return avail;
}

export function useMcVersions() {
  const [versions, setVersions] = useState<McVersionInfo[]>([]);
  useEffect(() => {
    api.meta.mcVersions().then(setVersions).catch(() => setVersions([]));
  }, []);
  return versions;
}

export function NewPackModal() {
  const { newPackOpen, setNewPackOpen, savePack, go, settings, toast, showcase, loadShowcase } = useStore();
  useEffect(() => {
    if (newPackOpen) void loadShowcase();
  }, [newPackOpen, loadShowcase]);
  const versions = useMcVersions();
  const [name, setName] = useState('');
  const [mc, setMc] = useState('');
  const [loader, setLoader] = useState<Loader>('fabric');
  const [memory, setMemory] = useState(settings?.defaultMemoryMb ?? 6144);
  const [snapshots, setSnapshots] = useState(false);
  const [busy, setBusy] = useState(false);
  const avail = useLoaderAvailability(mc);

  const list = useMemo(() => versions.filter((v) => snapshots || v.type === 'release'), [versions, snapshots]);

  useEffect(() => {
    if (!mc && list.length) setMc(list[0].version);
  }, [list, mc]);

  useEffect(() => {
    if (newPackOpen) {
      setName('');
      setBusy(false);
    }
  }, [newPackOpen]);

  useEffect(() => {
    const cur = avail[loader];
    if (cur && cur.length === 0) {
      const ok = LOADERS.find((l) => avail[l]?.length);
      if (ok) setLoader(ok);
    }
  }, [avail, loader]);

  const create = async () => {
    setBusy(true);
    try {
      const finalName = name.trim() || `Сборка ${mc}`;
      const seed = finalName + Date.now();
      const colors = paletteFor(seed);
      const pack: Pack = {
        id: uid(),
        name: finalName,
        description: '',
        author: 'Guloxy',
        version: '1.0.0',
        mcVersion: mc,
        loader,
        loaderVersion: 'latest',
        memoryMb: memory,
        jvmArgs: '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200',
        icon: generatePackIcon(finalName, colors),
        accent: '#8fd3ff',
        allowBeta: false,
        entries: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await savePack(pack);
      setNewPackOpen(false);
      go({ name: 'pack', id: pack.id });
      toast({ kind: 'ok', title: 'Сборка создана', detail: 'Теперь добавьте моды из каталога' });
    } catch (e) {
      toast({ kind: 'error', title: 'Ошибка', detail: (e as Error).message });
      setBusy(false);
    }
  };

  return (
    <Modal open={newPackOpen} onClose={() => setNewPackOpen(false)} banner={showcase[3]?.thumb ?? showcase[0]?.thumb}>
      <Index pill="Шаг 1 из 2">Дальше — моды из каталога</Index>
      <h2 style={{ marginTop: 12 }}>
        Новая <span className="ice">сборка</span>
      </h2>
      <p className="sub">Выберите версию игры и загрузчик — моды добавите на следующем шаге.</p>

      <div className="form-grid">
        <div className="field full">
          <label>Название</label>
          <input
            className="input"
            autoFocus
            placeholder="Например: Guloxy Survival"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && mc && avail[loader]?.length && create()}
          />
        </div>
        <div className="field">
          <label>Версия Minecraft</label>
          <select className="select" value={mc} onChange={(e) => setMc(e.target.value)}>
            {!list.length && <option>Загрузка…</option>}
            {list.map((v) => (
              <option key={v.version} value={v.version}>
                {v.version}
                {v.type === 'snapshot' ? ' (снапшот)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Снапшоты</label>
          <div className="row" style={{ height: 44 }}>
            <Toggle on={snapshots} onChange={setSnapshots} />
            <span className="muted" style={{ fontSize: 13 }}>
              Показывать тестовые версии
            </span>
          </div>
        </div>

        <div className="field full">
          <label>Загрузчик модов</label>
          <div className="loader-cards">
            {LOADERS.map((l) => {
              const v = avail[l];
              const na = v !== undefined && v !== null && v.length === 0;
              const st = LOADER_STYLE[l];
              return (
                <div key={l} className={`loader-card ${loader === l ? 'on' : ''} ${na ? 'na' : ''}`} onClick={() => !na && setLoader(l)}>
                  <div className="glyph" style={{ background: st.bg, color: st.fg }}>
                    {st.glyph}
                  </div>
                  <div className="ln">{LOADER_NAMES[l]}</div>
                  <div className="lv">
                    {!v ? <Loader2 size={12} className="spin" /> : na ? 'нет для ' + mc : (v.find((x) => x.stable) ?? v[0])?.version}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="full">
          <MemorySlider value={memory} onChange={setMemory} />
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 30, gap: 12 }}>
        <button className="btn lg ghost" onClick={() => setNewPackOpen(false)}>
          Отмена
        </button>
        <button className="btn lg primary" disabled={busy || !mc || !avail[loader]?.length} onClick={create}>
          Создать {busy ? <Loader2 size={18} className="spin" /> : <ArrowRight size={18} strokeWidth={2.5} />}
        </button>
      </div>
    </Modal>
  );
}
