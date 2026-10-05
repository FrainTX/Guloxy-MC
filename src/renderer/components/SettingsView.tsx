import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Eye, EyeOff, FolderOpen, Radar, Save } from 'lucide-react';
import { api, isElectron } from '../api';
import { useStore } from '../store';
import { Seg, Toggle } from './ui';
import { MemorySlider } from './NewPack';
import { LogoMark } from './Pixel';
import type { Settings } from '../../shared/types';

export function SettingsView() {
  const { settings, saveSettings, toast } = useStore();
  const [draft, setDraft] = useState<Settings | null>(settings);
  const [showKey, setShowKey] = useState(false);
  const [javas, setJavas] = useState<string[]>([]);

  useEffect(() => setDraft(settings), [settings]);
  if (!draft) return null;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const detect = async () => {
    const r = await api.settings.detectPaths();
    setDraft((d) => (d ? { ...d, minecraftDir: r.minecraftDir, prismInstancesDir: r.prismInstancesDir || d.prismInstancesDir } : d));
    setJavas(r.java);
    toast({ kind: 'info', title: 'Пути определены', detail: r.java.length ? `Найдено Java: ${r.java.length}` : 'Java не найдена — скачается автоматически при необходимости' });
  };

  const pick = async (k: 'minecraftDir' | 'prismInstancesDir', title: string) => {
    const p = await api.shell.pickDir(title);
    if (p) set(k, p);
  };

  return (
    <div className="page">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="page-title">
          <h1 className="h-display">Настройки</h1>
        </div>
      </motion.div>

      <div className="settings-grid">
        <div className="card settings-card">
          <h3>CurseForge API</h3>
          <p className="hint">
            Без ключа доступен только Modrinth. Бесплатный ключ выдают на{' '}
            <a href="#" onClick={(e) => (e.preventDefault(), api.shell.openExternal('https://console.curseforge.com/'))}>
              console.curseforge.com
            </a>{' '}
            → API Keys. Ключ хранится только на этом компьютере.
          </p>
          {settings?.builtinCurseforgeKey && (
            <p className="ok-note">
              ✓ В приложение встроен ключ Guloxy — CurseForge работает сразу. Поле ниже нужно, только если хотите использовать свой ключ.
            </p>
          )}
          <div className="row">
            <input
              className="input mono"
              type={showKey ? 'text' : 'password'}
              placeholder={settings?.builtinCurseforgeKey ? 'используется встроенный ключ' : '$2a$10$…'}
              value={draft.curseforgeApiKey}
              onChange={(e) => set('curseforgeApiKey', e.target.value.trim())}
            />
            <button className="btn icon" onClick={() => setShowKey((v) => !v)} title={showKey ? 'Скрыть' : 'Показать'}>
              {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <div className="set-row" style={{ marginTop: 12 }}>
            <div>
              <div className="n">Предпочитаемый источник для зависимостей</div>
              <div className="s">Если библиотека есть на обоих сайтах, она будет скачана отсюда.</div>
            </div>
            <Seg
              value={draft.preferSource}
              onChange={(v) => set('preferSource', v)}
              options={[
                { value: 'modrinth', label: 'Modrinth' },
                { value: 'curseforge', label: 'CurseForge' },
              ]}
            />
          </div>
        </div>

        <div className="card settings-card">
          <div className="row between">
            <div>
              <h3>Папки</h3>
              <p className="hint">Куда устанавливать сборки.</p>
            </div>
            {isElectron && (
              <button className="btn sm" onClick={detect}>
                <Radar size={15} /> Найти автоматически
              </button>
            )}
          </div>
          <div className="field">
            <label>Папка .minecraft (официальный лаунчер)</label>
            <div className="row">
              <input className="input mono" value={draft.minecraftDir} onChange={(e) => set('minecraftDir', e.target.value)} />
              <button className="btn icon" onClick={() => pick('minecraftDir', 'Папка .minecraft')}>
                <FolderOpen size={18} />
              </button>
            </div>
          </div>
          <div className="field" style={{ marginTop: 16 }}>
            <label>Папка инстансов Prism / MultiMC</label>
            <div className="row">
              <input
                className="input mono"
                placeholder="не найдена — будет создан zip для импорта"
                value={draft.prismInstancesDir}
                onChange={(e) => set('prismInstancesDir', e.target.value)}
              />
              <button className="btn icon" onClick={() => pick('prismInstancesDir', 'Папка instances')}>
                <FolderOpen size={18} />
              </button>
            </div>
          </div>
          <div className="field" style={{ marginTop: 16 }}>
            <label>Java для установщика Forge/NeoForge (необязательно)</label>
            <input className="input mono" placeholder="авто: найдём или скачаем Temurin" value={draft.javaPath} onChange={(e) => set('javaPath', e.target.value)} />
            {javas.length > 0 && (
              <div className="muted mono" style={{ fontSize: 11.5 }}>
                {javas.map((j) => (
                  <div key={j}>{j}</div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card settings-card">
          <h3>Производительность</h3>
          <p className="hint">Значения по умолчанию для новых сборок и загрузчика.</p>
          <MemorySlider value={draft.defaultMemoryMb} onChange={(v) => set('defaultMemoryMb', v)} />
          <div className="set-row" style={{ marginTop: 14 }}>
            <div>
              <div className="n">Параллельных загрузок</div>
              <div className="s">Больше — быстрее, но может упереться в лимиты сайтов.</div>
            </div>
            <Seg
              value={String(draft.concurrency)}
              onChange={(v) => set('concurrency', Number(v))}
              options={['3', '6', '10'].map((v) => ({ value: v, label: v }))}
            />
          </div>
          <div className="set-row">
            <div>
              <div className="n">Меньше анимаций</div>
              <div className="s">Отключает движущийся фон и эффекты.</div>
            </div>
            <Toggle on={draft.reduceMotion} onChange={(v) => set('reduceMotion', v)} />
          </div>
        </div>

        <div className="card settings-card" style={{ display: 'flex', gap: 22, alignItems: 'center' }}>
          <LogoMark size={64} />
          <div>
            <h3 style={{ fontSize: 26, margin: 0 }}>
              Guloxy <span className="ice">MC</span>
            </h3>
            <div className="muted">Конструктор сборок Minecraft · сделано командой Guloxy</div>
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button
            className="btn lg primary"
            disabled={!dirty}
            onClick={async () => {
              await saveSettings(draft);
              toast({ kind: 'ok', title: 'Настройки сохранены' });
            }}
          >
            <Save size={18} /> Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
