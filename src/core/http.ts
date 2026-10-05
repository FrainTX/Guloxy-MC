import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

export const USER_AGENT = 'Guloxy/guloxy-mc/1.0.0 (github.com/FrainTX/Guloxy-MC)';

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status} — ${url}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** В Electron подменяется на net.fetch — тогда учитываются системный прокси и сертификаты. */
let fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args);
export function setFetch(f: typeof fetch) {
  fetchImpl = f;
}

export interface RequestOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  retries?: number;
  signal?: AbortSignal;
}

export async function request(url: string, opts: RequestOpts = {}): Promise<Response> {
  const retries = opts.retries ?? 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, {
        method: opts.method ?? 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
        redirect: 'follow',
      });
      // 429 / 5xx — повторяем с паузой
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after')) || 0;
        lastErr = new HttpError(res.status, url);
        if (attempt < retries) {
          await sleep(Math.max(retryAfter * 1000, 600 * 2 ** attempt));
          continue;
        }
      }
      return res;
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      lastErr = e;
      if (attempt < retries) await sleep(600 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function getJson<T>(url: string, opts: RequestOpts = {}): Promise<T> {
  const res = await request(url, opts);
  if (!res.ok) {
    let text = '';
    try {
      text = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new HttpError(res.status, url, `HTTP ${res.status} — ${url}${text ? `: ${text}` : ''}`);
  }
  return (await res.json()) as T;
}

export async function getText(url: string, opts: RequestOpts = {}): Promise<string> {
  const res = await request(url, { ...opts, headers: { Accept: '*/*', ...opts.headers } });
  if (!res.ok) throw new HttpError(res.status, url);
  return res.text();
}

export interface DownloadOpts {
  sha1?: string;
  signal?: AbortSignal;
  onBytes?: (n: number) => void;
  headers?: Record<string, string>;
}

/**
 * Скачивает файл во временный файл, проверяет sha1 и атомарно переносит.
 * Возвращает sha1 скачанного файла.
 */
export async function downloadFile(url: string, dest: string, opts: DownloadOpts = {}): Promise<string> {
  await mkdir(dirname(dest), { recursive: true });
  const tmp = `${dest}.part-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    let counted = 0;
    try {
      const res = await request(url, {
        signal: opts.signal,
        retries: 1,
        headers: { Accept: '*/*', ...opts.headers },
      });
      if (!res.ok || !res.body) throw new HttpError(res.status, url);
      const hash = createHash('sha1');
      const out = createWriteStream(tmp);
      const reader = res.body.getReader();
      await new Promise<void>((resolve, reject) => {
        out.on('error', reject);
        const pump = async () => {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              hash.update(value);
              counted += value.length;
              opts.onBytes?.(value.length);
              if (!out.write(value)) await new Promise((r) => out.once('drain', r));
            }
            out.end(() => resolve());
          } catch (e) {
            out.destroy();
            reject(e);
          }
        };
        void pump();
      });
      const digest = hash.digest('hex');
      if (opts.sha1 && digest.toLowerCase() !== opts.sha1.toLowerCase()) {
        throw new Error(`Контрольная сумма не совпала для ${url}`);
      }
      await rename(tmp, dest);
      return digest;
    } catch (e) {
      lastErr = e;
      opts.onBytes?.(-counted);
      await rm(tmp, { force: true });
      if (opts.signal?.aborted) throw e;
      if (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 429) break;
      await sleep(800 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Пул задач с ограничением параллельности. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
