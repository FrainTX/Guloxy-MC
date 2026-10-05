// Сборка main/preload процессов Electron в CommonJS.
import { build, context } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';

// Ключ CurseForge: из переменной окружения (секрет CI) или локального файла curseforge.key (в .gitignore)
const cfKey = (process.env.CURSEFORGE_API_KEY || (existsSync('curseforge.key') ? readFileSync('curseforge.key', 'utf8') : '')).trim();
console.log(cfKey ? 'CurseForge: ключ встроен в сборку' : 'CurseForge: ключ не задан — пользователь введёт свой в настройках');

const watch = process.argv.includes('--watch');
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  external: ['electron'],
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  logLevel: 'info',
  define: { __CF_KEY__: JSON.stringify(cfKey) },
};
const entries = { main: 'electron/main.ts', preload: 'electron/preload.ts' };

if (watch) {
  const ctx = await context({ ...common, entryPoints: entries });
  await ctx.watch();
} else {
  await build({ ...common, entryPoints: entries, minify: true });
}
