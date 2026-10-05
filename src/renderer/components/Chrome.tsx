import { Download, Home, Minus, Plus, Settings as SettingsIcon, Square, X } from 'lucide-react';
import { api, isElectron } from '../api';
import { useStore } from '../store';
import { LogoMark, PackAvatar } from './Pixel';
import { LOADER_NAMES } from '../../shared/types';

export { LogoMark };

export function TitleBar() {
  const building = useStore((s) => s.build?.running);
  return (
    <div className="titlebar">
      <span className="brand">Guloxy MC</span>
      <div className="spacer" />
      <div className="status">
        <span className={`dot ${building ? 'busy' : ''}`} />
        {building ? 'Идёт сборка' : isElectron ? 'Онлайн' : 'Веб-превью'}
      </div>
      {isElectron ? (
        <div className="winbtns">
          <button onClick={() => api.window.minimize()} aria-label="Свернуть">
            <Minus size={15} />
          </button>
          <button onClick={() => api.window.maximize()} aria-label="Развернуть">
            <Square size={12} />
          </button>
          <button className="close" onClick={() => api.window.close()} aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>
      ) : (
        <div style={{ width: 16 }} />
      )}
    </div>
  );
}

export function Sidebar() {
  const { packs, view, go, setNewPackOpen, refreshPacks, toast } = useStore();
  const activeId = view.name === 'pack' ? view.id : null;

  const doImport = async () => {
    try {
      const p = await api.packs.importFile();
      if (p) {
        await refreshPacks();
        go({ name: 'pack', id: p.id });
        toast({ kind: 'ok', title: 'Сборка импортирована', detail: p.name });
      }
    } catch (e) {
      toast({ kind: 'error', title: 'Не удалось импортировать', detail: (e as Error).message });
    }
  };

  return (
    <aside className="sidebar">
      <div className="logo" onClick={() => go({ name: 'home' })}>
        <LogoMark size={40} />
        <div className="logo-text">
          <div className="t1">Guloxy</div>
          <div className="t2">Сборки Minecraft</div>
        </div>
      </div>

      <div className="side-actions">
        <button className="btn primary" onClick={() => setNewPackOpen(true)}>
          <Plus size={17} strokeWidth={2.5} /> Новая сборка
        </button>
        <button className="btn icon" title="Импорт .mrpack / CurseForge .zip" onClick={doImport}>
          <Download size={17} />
        </button>
      </div>

      <div className="side-label">
        <span>Мои сборки</span>
        <span>{packs.length}</span>
      </div>

      <div className="pack-list">
        {packs.map((p) => (
          <div key={p.id} className={`pack-item ${activeId === p.id ? 'active' : ''}`} onClick={() => go({ name: 'pack', id: p.id })}>
            <PackAvatar pack={p} size={44} />
            <div className="meta">
              <div className="name">{p.name}</div>
              <div className="sub">
                {p.mcVersion} · {LOADER_NAMES[p.loader]} · {p.entries.filter((e) => e.enabled).length} модов
              </div>
            </div>
          </div>
        ))}
        {!packs.length && <div className="muted" style={{ padding: '6px 12px', fontSize: 13 }}>Пока пусто — создайте первую сборку.</div>}
      </div>

      <div className="side-foot">
        <button className={`nav-btn ${view.name === 'home' ? 'active' : ''}`} onClick={() => go({ name: 'home' })}>
          <Home size={17} /> Главная
        </button>
        <button className={`nav-btn ${view.name === 'settings' ? 'active' : ''}`} onClick={() => go({ name: 'settings' })}>
          <SettingsIcon size={17} /> Настройки
        </button>
        <div className="signature">
          Сделано <b>Guloxy</b>
        </div>
      </div>
    </aside>
  );
}
