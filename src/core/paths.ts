import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export function defaultMinecraftDir(): string {
  switch (platform()) {
    case 'win32':
      return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), '.minecraft');
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'minecraft');
    default:
      return join(homedir(), '.minecraft');
  }
}

export function defaultPrismInstancesDir(): string {
  const candidates: string[] = [];
  switch (platform()) {
    case 'win32': {
      const appdata = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
      candidates.push(join(appdata, 'PrismLauncher', 'instances'), join(appdata, 'MultiMC', 'instances'));
      break;
    }
    case 'darwin':
      candidates.push(join(homedir(), 'Library', 'Application Support', 'PrismLauncher', 'instances'));
      break;
    default:
      candidates.push(
        join(homedir(), '.local', 'share', 'PrismLauncher', 'instances'),
        join(homedir(), '.var', 'app', 'org.prismlauncher.PrismLauncher', 'data', 'PrismLauncher', 'instances'),
      );
  }
  return candidates.find((c) => existsSync(c)) ?? '';
}

/** Имя папки, безопасное для любой ФС. */
export function safeName(name: string): string {
  const s = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return s || 'Guloxy Pack';
}
