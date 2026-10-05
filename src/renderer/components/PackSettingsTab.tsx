import { useEffect, useState } from 'react';
import { RefreshCw, Save, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';
import { Toggle, LOADER_STYLE } from './ui';
import { MemorySlider, useLoaderAvailability, useMcVersions } from './NewPack';
import { LOADER_NAMES, type Loader, type Pack } from '../../shared/types';

export function PackSettingsTab({ pack }: { pack: Pack }) {
  const { savePack, removePack, toast, refreshPacks } = useStore();
  const [draft, setDraft] = useState(pack);
  const versions = useMcVersions();
  const avail = useLoaderAvailability(draft.mcVersion);
  const loaderList = avail[draft.loader] ?? [];

  useEffect(() => setDraft(pack), [pack]);

  const set = <K extends keyof Pack>(k: K, v: Pack[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(pack);

  const save = async () => {
    const platformChanged = draft.mcVersion !== pack.mcVersion || draft.loader !== pack.loader;
    const next = platformChanged
      ? { ...draft, entries: draft.entries.map((e) => ({ ...e, pinnedVersionId: undefined })), lastBuild: undefined }
      : draft;
    await savePack(next);
    toast({
      kind: 'ok',
      title: 'Параметры сохранены',
      detail: platformChanged ? 'Версия игры/загрузчик изменены — закреплённые версии модов сброшены' : undefined,
    });
  };

  return (
    <div className="settings-grid">
      <div className="card settings-card">
        <h3>Основное</h3>
        <p className="hint">Название и иконка попадут в профиль лаунчера и в экспортированные файлы.</p>
        <div className="form-grid">
          <div className="field">
            <label>Название</label>
            <input className="input" value={draft.name} maxLength={60} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="field">
            <label>Версия сборки</label>
            <input className="input" value={draft.version} maxLength={20} onChange={(e) => set('version', e.target.value)} />
          </div>
          <div className="field full">
            <label>Описание</label>
            <textarea className="input" value={draft.description} maxLength={400} onChange={(e) => set('description', e.target.value)} />
          </div>
          <div className="field full">
            <label>Обложка</label>
            <div className="row" style={{ gap: 16 }}>
              <div style={{ width: 240, height: 120, borderRadius: 16, overflow: 'hidden', background: 'var(--bg-4)' }}>
                {pack.cover && <img src={pack.cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                <button
                  className="btn"
                  disabled={!pack.entries.length}
                  onClick={async () => {
                    await api.packs.cover(pack.id, true).catch(() => null);
                    await refreshPacks();
                  }}
                >
                  <RefreshCw size={16} /> Сменить обложку
                </button>
                <span className="muted" style={{ fontSize: 12.5 }}>Кадры берутся из галерей модов этой сборки.</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card settings-card">
        <h3>Игра и загрузчик</h3>
        <p className="hint">При смене версии все моды будут подобраны заново под новую версию.</p>
        <div className="form-grid">
          <div className="field">
            <label>Minecraft</label>
            <select className="select" value={draft.mcVersion} onChange={(e) => setDraft((d) => ({ ...d, mcVersion: e.target.value, loaderVersion: 'latest' }))}>
              {!versions.some((v) => v.version === draft.mcVersion) && <option>{draft.mcVersion}</option>}
              {versions.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.version}
                  {v.type === 'snapshot' ? ' (снапшот)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Версия загрузчика</label>
            <select className="select" value={draft.loaderVersion} onChange={(e) => set('loaderVersion', e.target.value)}>
              <option value="latest">Последняя стабильная (рекомендуем)</option>
              {loaderList.slice(0, 80).map((v) => (
                <option key={v.version} value={v.version}>
                  {v.version}
                  {v.stable ? '' : ' (бета)'}
                </option>
              ))}
            </select>
          </div>
          <div className="field full">
            <label>Загрузчик</label>
            <div className="loader-cards">
              {(['fabric', 'neoforge', 'forge', 'quilt'] as Loader[]).map((l) => {
                const v = avail[l];
                const na = !!v && v.length === 0;
                return (
                  <div
                    key={l}
                    className={`loader-card ${draft.loader === l ? 'on' : ''} ${na ? 'na' : ''}`}
                    onClick={() => !na && setDraft((d) => ({ ...d, loader: l, loaderVersion: 'latest' }))}
                  >
                    <div className="glyph" style={{ background: LOADER_STYLE[l].bg, color: LOADER_STYLE[l].fg }}>
                      {LOADER_STYLE[l].glyph}
                    </div>
                    <div className="ln">{LOADER_NAMES[l]}</div>
                    <div className="lv">{na ? 'недоступен' : ''}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="card settings-card">
        <h3>Запуск</h3>
        <p className="hint">Эти параметры записываются в профиль лаунчера.</p>
        <MemorySlider value={draft.memoryMb} onChange={(v) => set('memoryMb', v)} />
        <div className="field" style={{ marginTop: 18 }}>
          <label>Аргументы JVM</label>
          <input className="input mono" value={draft.jvmArgs} onChange={(e) => set('jvmArgs', e.target.value)} />
        </div>
        <div className="set-row" style={{ marginTop: 10 }}>
          <div>
            <div className="n">Разрешить бета-версии модов</div>
            <div className="s">Свежее, но менее стабильно. Если у мода нет релиза, бета берётся в любом случае.</div>
          </div>
          <Toggle on={draft.allowBeta} onChange={(v) => set('allowBeta', v)} />
        </div>
      </div>

      <div className="row between">
        <button
          className="btn danger"
          onClick={() => {
            if (confirm(`Удалить сборку «${pack.name}»? Установленные в лаунчер файлы останутся.`)) void removePack(pack.id);
          }}
        >
          <Trash2 size={16} /> Удалить сборку
        </button>
        <div className="row">
          {dirty && (
            <button className="btn ghost" onClick={() => setDraft(pack)}>
              Отменить
            </button>
          )}
          <button className="btn lg primary" disabled={!dirty} onClick={save}>
            <Save size={18} /> Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
