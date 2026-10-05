import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from './store';
import { Background } from './components/Background';
import { Sidebar, TitleBar } from './components/Chrome';
import { LogoMark } from './components/Pixel';
import { Home } from './components/Home';
import { NewPackModal } from './components/NewPack';
import { PackView } from './components/PackView';
import { SettingsView } from './components/SettingsView';
import { Toasts } from './components/ui';

function Splash() {
  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
      <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}>
        <LogoMark size={72} />
      </motion.div>
    </div>
  );
}

export function App() {
  const { ready, init, view, settings } = useStore();

  useEffect(() => {
    void init();
  }, [init]);

  const still = !!settings?.reduceMotion;
  const key = view.name === 'pack' ? `pack:${view.id}` : view.name;

  return (
    <div className={still ? 'reduce-motion' : ''} style={{ height: '100%' }}>
      <Background />
      <div className="app">
        <TitleBar />
        {!ready ? (
          <Splash />
        ) : (
          <div className="shell">
            <Sidebar />
            <main className="main">
              <AnimatePresence mode="wait">
                <motion.div key={key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>
                  {view.name === 'home' && <Home />}
                  {view.name === 'pack' && <PackView id={view.id} />}
                  {view.name === 'settings' && <SettingsView />}
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
        )}
      </div>
      <NewPackModal />
      <Toasts />
    </div>
  );
}
