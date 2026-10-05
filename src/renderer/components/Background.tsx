import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../store';

/** Атмосферный фон: текущий кадр игры, сильно размытый и затемнённый. */
export function Background() {
  const src = useStore((s) => s.backdrop);
  return (
    <div className="backdrop" aria-hidden>
      <AnimatePresence>
        {src && (
          <motion.img key={src} src={src} alt="" initial={{ opacity: 0 }} animate={{ opacity: 0.32 }} exit={{ opacity: 0 }} transition={{ duration: 1 }} />
        )}
      </AnimatePresence>
    </div>
  );
}
