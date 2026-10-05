// Общие типы для main- и renderer-процессов Guloxy MC.

export type Source = 'modrinth' | 'curseforge';
export type Loader = 'fabric' | 'quilt' | 'forge' | 'neoforge';
export type ContentKind = 'mod' | 'resourcepack' | 'shader';
export type ReleaseChannel = 'release' | 'beta' | 'alpha';
export type BuildTarget = 'official' | 'shared' | 'prism' | 'mrpack' | 'cfzip';

export const LOADER_NAMES: Record<Loader, string> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
};

export const KIND_DIRS: Record<ContentKind, string> = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
};

/** Карточка проекта в каталоге (общая для обоих источников). */
export interface CatalogItem {
  source: Source;
  projectId: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  iconUrl?: string;
  downloads: number;
  kind: ContentKind;
  categories: string[];
  clientSide?: 'required' | 'optional' | 'unsupported' | 'unknown';
  url: string;
  /** Скриншот из галереи проекта (обложка карточки). */
  cover?: string;
  updatedAt?: string;
}

export interface SearchQuery {
  source: Source;
  query: string;
  kind: ContentKind;
  mcVersion: string;
  loader: Loader;
  sort: 'relevance' | 'downloads' | 'updated' | 'newest';
  offset: number;
  limit: number;
}

export interface SearchResult {
  items: CatalogItem[];
  total: number;
}

/** Конкретный файл конкретной версии мода. */
export interface ModFile {
  source: Source;
  projectId: string;
  versionId: string;
  versionName: string;
  fileName: string;
  url: string;
  sha1?: string;
  sha512?: string;
  size: number;
  channel: ReleaseChannel;
  gameVersions: string[];
  loaders: string[];
  published: string;
  dependencies: FileDependency[];
}

export interface FileDependency {
  source: Source;
  projectId?: string;
  versionId?: string;
  type: 'required' | 'optional' | 'incompatible' | 'embedded';
}

export interface PackEntry {
  /** Уникальный ключ: `${source}:${projectId}` */
  key: string;
  source: Source;
  projectId: string;
  slug: string;
  title: string;
  author: string;
  iconUrl?: string;
  kind: ContentKind;
  /** Закреплённая версия (versionId) — иначе берётся самая свежая совместимая. */
  pinnedVersionId?: string;
  /** Версия закреплена автоматически при устранении конфликта. */
  autoPinned?: boolean;
  addedBy: 'user' | 'dependency' | 'auto';
  /** Ключи записей, которым нужна эта запись. */
  requiredBy: string[];
  /** Почему добавлено автоматически. */
  reason?: string;
  enabled: boolean;
}

export interface Pack {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  mcVersion: string;
  loader: Loader;
  /** Конкретная версия загрузчика или 'latest'. */
  loaderVersion: string;
  memoryMb: number;
  jvmArgs: string;
  icon?: string;
  /** Большая картинка для шапки сборки (скриншот одного из модов). */
  cover?: string;
  accent: string;
  allowBeta: boolean;
  entries: PackEntry[];
  createdAt: number;
  updatedAt: number;
  lastBuild?: BuildReport;
}

export type IssueLevel = 'error' | 'warning' | 'info' | 'fixed';

export interface Issue {
  level: IssueLevel;
  title: string;
  detail?: string;
  entryKey?: string;
  /** Машинный код проблемы, чтобы её можно было исправить автоматически. */
  code?: 'no-version';
}

export interface ResolvedEntry {
  entry: PackEntry;
  file?: ModFile;
  /** Ключ «канонической» записи: modrinth projectId, если известен. */
  identity: string;
}

export interface ResolveResult {
  pack: Pack;
  resolved: ResolvedEntry[];
  issues: Issue[];
  added: PackEntry[];
}

export type BuildStage =
  | 'resolve'
  | 'download'
  | 'verify'
  | 'loader'
  | 'install'
  | 'done';

export interface BuildProgress {
  stage: BuildStage;
  message: string;
  /** 0..1 внутри стадии */
  progress: number;
  bytesDone?: number;
  bytesTotal?: number;
}

export interface BuildLog {
  t: number;
  level: 'info' | 'ok' | 'warn' | 'error';
  text: string;
}

export interface BuildOutput {
  target: BuildTarget;
  path: string;
  note?: string;
}

export interface BuildReport {
  ok: boolean;
  finishedAt: number;
  durationMs: number;
  modCount: number;
  totalBytes: number;
  issues: Issue[];
  outputs: BuildOutput[];
  loaderVersion: string;
}

export interface BuildRequest {
  packId: string;
  targets: BuildTarget[];
  /** Путь для экспорта архивов (если не указан — спрашивает диалог). */
  exportDir?: string;
}

export interface Settings {
  curseforgeApiKey: string;
  /** В сборку приложения встроен ключ CurseForge (только для чтения). */
  builtinCurseforgeKey?: boolean;
  preferSource: Source;
  concurrency: number;
  minecraftDir: string;
  prismInstancesDir: string;
  javaPath: string;
  defaultMemoryMb: number;
  reduceMotion: boolean;
}

export interface LoaderVersionInfo {
  version: string;
  stable: boolean;
}

export interface McVersionInfo {
  version: string;
  type: 'release' | 'snapshot';
  date: string;
}

/** Кадр для витрины на главной. */
export interface Showcase {
  title: string;
  image: string;
  thumb: string;
  url: string;
}

export interface ProjectDetails {
  item: CatalogItem;
  body: string;
  gallery: string[];
  links: { label: string; url: string }[];
  versions: ModFile[];
}

/** API, которое preload выставляет в window.guloxy */
export interface GuloxyApi {
  window: {
    minimize(): void;
    maximize(): void;
    close(): void;
  };
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
    detectPaths(): Promise<{ minecraftDir: string; prismInstancesDir: string; java: string[] }>;
  };
  meta: {
    mcVersions(): Promise<McVersionInfo[]>;
    loaderVersions(loader: Loader, mcVersion: string): Promise<LoaderVersionInfo[]>;
    showcase(): Promise<Showcase[]>;
  };
  catalog: {
    search(q: SearchQuery): Promise<SearchResult>;
    details(source: Source, projectId: string, mcVersion: string, loader: Loader, kind: ContentKind): Promise<ProjectDetails>;
  };
  packs: {
    list(): Promise<Pack[]>;
    save(pack: Pack): Promise<Pack>;
    remove(id: string): Promise<void>;
    resolve(id: string): Promise<ResolveResult>;
    importFile(): Promise<Pack | null>;
    /** Подбирает обложку сборки из галерей её модов. */
    cover(id: string, next?: boolean): Promise<string | null>;
  };
  build: {
    start(req: BuildRequest): Promise<BuildReport>;
    cancel(): void;
    onProgress(cb: (p: BuildProgress) => void): () => void;
    onLog(cb: (l: BuildLog) => void): () => void;
  };
  shell: {
    openPath(p: string): void;
    openExternal(url: string): void;
    pickDir(title: string): Promise<string | null>;
  };
}
