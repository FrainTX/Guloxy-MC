// Встроенный ключ CurseForge подставляется при сборке (scripts/build-electron.mjs)
// из переменной CURSEFORGE_API_KEY или локального файла curseforge.key — в git он не хранится.
declare const __CF_KEY__: string | undefined;

export const BUILTIN_CF_KEY: string =
  (typeof __CF_KEY__ !== 'undefined' ? __CF_KEY__ : '') || process.env.CURSEFORGE_API_KEY || '';

/** Ключ, который реально используется: свой из настроек или встроенный. */
export function effectiveCfKey(userKey: string): string {
  return userKey.trim() || BUILTIN_CF_KEY;
}
