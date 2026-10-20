// Managed by the Uplink installer (--with-backups). Do not edit: it is
// replaced when the installer runs again with --force.

/**
 * Repository backup fallback — the half of the backup feature that runs in a
 * CLIENT site, not in Uplink.
 *
 * A site reads Uplink live. When Uplink is unavailable — a network failure, a
 * timeout, an upstream 5xx, or the client deliberately switched Offline (423
 * UPLINK_CLIENT_OFFLINE_BY_USER) — it answers the same request from the
 * snapshot checked into the repository instead, with the same response shape
 * and the same visibility rules as /api/v1.
 *
 * It must NOT hide mistakes: 401, 403, 404, 400 and a malformed body are the
 * site's problem to see, so they never fall back. And it never retries — a
 * 423 is a person's decision, not a transient fault.
 *
 * This file is deliberately self-contained (no imports, no Node APIs) so it
 * can be shipped verbatim into a client repository. Loading the snapshot from
 * disk and performing the live fetch are injected by the caller. The snapshot
 * types below are the on-disk contract; src/lib/backup/snapshot.ts, which
 * writes the snapshot, is type-checked against them.
 *
 * See docs/repository-backup-fallback-proposal.md.
 */

// ---------------------------------------------------------------------------
// On-disk format
// ---------------------------------------------------------------------------

/** Bump when a change to the snapshot shape is not backwards-compatible. */
export const BACKUP_FORMAT_VERSION = 1;

/** The offline code the Online/Offline switch answers with (src/lib/clients/delivery-status.ts). */
export const CLIENT_OFFLINE_CODE = 'UPLINK_CLIENT_OFFLINE_BY_USER';

export type BackupStatus = 'published' | 'unlisted';

export interface BackupManifestFile {
  path: string;
  /**
   * SHA-256 of a JSON file. Null for a media or document file: Uplink never
   * downloads those bytes, so it cannot hash them — their version is in the
   * filename, and `size` is checked when they are copied.
   */
  sha256: string | null;
  size: number;
}

export interface BackupManifest {
  formatVersion: number;
  clientId: string;
  /** Origin of the Uplink instance the snapshot was taken from. */
  host: string;
  /**
   * The data is current as of this instant: the newest change of anything in
   * the snapshot (ISO 8601 UTC). NOT when the backup was taken — that would
   * change the tree on every run, and an unchanged workspace must produce no
   * diff. Null for an empty workspace.
   */
  dataAsOf: string | null;
  counts: {
    content: number;
    schemas: number;
    media: number;
    documents: number;
    settings: number;
    files: number;
  };
  /** What was left out on purpose, so a reviewer can see it was a choice. */
  omitted: {
    privateMedia: number;
    unlistedDocuments: number;
    unresolvedMediaReferences: number;
  };
  /** Every file in the snapshot except the manifest itself, sorted by path. */
  files: BackupManifestFile[];
  /**
   * "Serve images from the backup", set in Uplink → Backups: while Uplink is
   * up, images the backup holds at the same version are served from their
   * backed-up copy (preferBackupMedia). Absent means off — every image goes
   * through Uplink, sized for each screen.
   */
  imagesFromBackup?: true;
  /**
   * "Serve large images from the backup", set in Uplink → Backups: with
   * imagesFromBackup, originals wider than BACKUP_MEDIA_MAX_WIDTH are served
   * from their backed-up copy too. Absent means off.
   */
  wideImagesFromBackup?: true;
}

/** A content item, as GET /api/v1/content returns it. */
export interface BackupContentItem {
  id: string;
  type: 'page' | 'post' | 'custom' | 'list' | 'legal';
  title: string;
  slug: string;
  content: string;
  status: BackupStatus;
  schema: unknown;
  fields: unknown;
  parent_id: string | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
  /** Slugs the item was live under before. Present only when there are some. */
  previous_slugs?: string[];
  /** Posts only: computed from the body, as v1 serves them. */
  word_count?: number;
  reading_minutes?: number;
  /** Legal pages only: the body's h2/h3 headings, as v1 serves them. */
  toc?: Array<{ id: string; text: string; level: 2 | 3 }>;
}

/**
 * A legal page, exactly as GET /api/v1/legal returns it. A backup holds the
 * published and unlisted ones; the listing answers with published only.
 */
export interface BackupLegalPage {
  id: string;
  kind: string;
  title: string;
  slug: string;
  status: BackupStatus;
  updated_at: string;
  [field: string]: unknown;
}

/** A list schema, as GET /api/v1/schemas returns it. */
export interface BackupSchema {
  id: string;
  title: string;
  slug: string;
  status: 'published';
  schema: unknown[];
  item_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * A media asset, as GET /api/v1/media returns it — except `url`, which is the
 * host-relative path of the local copy, or null when no public copy exists
 * (a private asset is never written under public/).
 */
export interface BackupMediaAsset {
  id: string;
  title: string;
  alt_text: string | null;
  filename: string;
  file_size: number;
  mime_type: string;
  storage_path: string;
  width: number | null;
  height: number | null;
  folders: string[];
  tags: string[];
  uploaded_at: string;
  version: number;
  updated_at: string;
  blur_data_url: string | null;
  status: BackupStatus;
  is_private: boolean;
  serve_original: boolean;
  is_locked: boolean;
  lock_reason: string | null;
  locked_at: string | null;
  content_hash: string | null;
  url: string | null;
  /**
   * Where the file itself is in the repository, relative to its root — under
   * public/uplink-backup/media/ (also reachable at `url`) or, for a private
   * asset, uplink-backup/private-media/, which is never web-served: a site
   * route hands it out under its own rules (readUplinkBackupMedia in
   * lib/uplink-backup.ts). Null when the backup was taken without files.
   */
  backup_path: string | null;
}

/**
 * A site setting, as GET /api/v1/settings returns it, plus `sort_order` so the
 * reader can list settings in the same order. Settings have no status: every
 * one is live, so every one is backed up.
 */
export interface BackupSiteSetting {
  key: string;
  label: string;
  description: string;
  type: string;
  options: { value: string; label: string }[] | null;
  value: unknown;
  default_value: unknown;
  updated_at: string;
  sort_order: number;
}

/**
 * The business info, exactly as GET /api/v1/business-info returns it under
 * `data`: every field already derived (links, phone formats, icons, JSON-LD).
 * It is live data with no status, so a backup always holds it. Only
 * `updated_at` is relied on here; the rest is passed through as served.
 */
export interface BackupBusinessInfo {
  updated_at: string | null;
  [field: string]: unknown;
}

/**
 * The integrations — analytics tags and the cookie banner — exactly as GET
 * /api/v1/integrations returns them under `data`, every script already built.
 * Passed through as served; <UplinkIntegrations /> checks the shape itself.
 */
export interface BackupIntegrations {
  consent_default: unknown;
  integrations: unknown[];
}

/**
 * The theme, exactly as GET /api/v1/theme returns it under `data`: tokens,
 * every derived value and the ready-to-inline CSS, whose font files the
 * backup holds under public/uplink-backup/fonts/. Passed through as served;
 * <UplinkTheme /> checks the CSS itself.
 */
export interface BackupTheme {
  version: number;
  updated_at: string | null;
  css: string;
  [field: string]: unknown;
}

/**
 * Search & sharing, as GET /api/v1/seo serves it: `site` and `pages` are the
 * answer without a path; `none` is the answer for a path Uplink knows nothing
 * about (the reader fills in the path); `sitemap`, `robots`, `llms` and
 * `page_md` are its formats. Passed through as served; the site's
 * lib/uplink-seo.tsx checks the shape itself.
 */
export interface BackupSeo {
  site: { site_url?: string | null; home_title?: string | null; [field: string]: unknown };
  pages: { path: string; [field: string]: unknown }[];
  none: { open_graph?: Record<string, unknown>; [field: string]: unknown } | null;
  sitemap: unknown[];
  robots: unknown;
  llms: string | null;
  /** Each known page's plain-text version, by path. */
  page_md: Record<string, string>;
}

/**
 * The agency that looks after the site, as GET /api/v1/agency answers: the
 * WHOLE body, so `data: null` (no agency — show no credit) is a real answer,
 * unlike the installer's `null` placeholder. Passed through as served.
 */
export interface BackupAgency {
  data: Record<string, unknown> | null;
}

/** A document, as GET /api/v1/documents returns it, with `download_url` pointing at the local copy. */
export interface BackupDocument {
  id: string;
  title: string;
  filename: string;
  file_size: number;
  mime_type: string;
  storage_path: string;
  category: string;
  tags: string[];
  status: BackupStatus;
  version: number;
  uploaded_at: string;
  updated_at: string;
  download_url: string | null;
}

export interface BackupSnapshot {
  manifest: BackupManifest;
  content: BackupContentItem[];
  schemas: BackupSchema[];
  media: BackupMediaAsset[];
  documents: BackupDocument[];
  settings: BackupSiteSetting[];
  /**
   * Absent from a backup made before business info was backed up, and null in
   * the installer's placeholder: then the reader does not answer for it, and
   * the site keeps its own copy.
   */
  businessInfo?: BackupBusinessInfo | null;
  /**
   * Absent from a backup made before legal pages were backed up, and null in
   * the installer's placeholder: then the reader does not answer for them.
   */
  legal?: BackupLegalPage[] | null;
  /**
   * Absent from a backup made before integrations were backed up, and null in
   * the installer's placeholder: then the reader does not answer for them, and
   * the site renders no integrations while Uplink is away.
   */
  integrations?: BackupIntegrations | null;
  /**
   * Absent from a backup made before themes were backed up, and null in the
   * installer's placeholder: then the reader does not answer for it, and the
   * site keeps the fallbacks in app/uplink-theme.css.
   */
  theme?: BackupTheme | null;
  /**
   * Absent from a backup made before Search & sharing was backed up, and null
   * in the installer's placeholder: then the reader does not answer for it,
   * and every page keeps its own metadata.
   */
  seo?: BackupSeo | null;
  /**
   * Absent from a backup made before the agency was backed up, and null in the
   * installer's placeholder: then the reader does not answer for it, and the
   * site shows no agency credit while Uplink is away.
   */
  agency?: BackupAgency | null;
}

// ---------------------------------------------------------------------------
// When to fall back
// ---------------------------------------------------------------------------

export type LiveFailure =
  | { kind: 'network' }
  | { kind: 'timeout' }
  | { kind: 'http'; status: number; code?: string }
  | { kind: 'invalid-json' };

/**
 * Only failures that can reasonably mean "Uplink is unavailable". Everything
 * else is a configuration or content mistake the site must see.
 */
export function shouldServeBackup(failure: LiveFailure): boolean {
  switch (failure.kind) {
    case 'network':
    case 'timeout':
      return true;
    case 'http':
      if (failure.status === 423) return failure.code === CLIENT_OFFLINE_CODE;
      return failure.status >= 500 && failure.status <= 599;
    case 'invalid-json':
      return false;
  }
}

/** Thrown for any live failure the backup did not (or could not) cover. */
export class UplinkRequestError extends Error {
  readonly failure: LiveFailure;
  readonly status: number | null;
  readonly code: string | null;

  constructor(message: string, failure: LiveFailure) {
    super(message);
    this.name = 'UplinkRequestError';
    this.failure = failure;
    this.status = failure.kind === 'http' ? failure.status : null;
    this.code = failure.kind === 'http' ? failure.code ?? null : null;
  }
}

// ---------------------------------------------------------------------------
// Answering a request from the snapshot
// ---------------------------------------------------------------------------

export type SearchParamValue = string | number | boolean | null | undefined;

export type BackupAnswer =
  | { kind: 'ok'; body: { data: unknown; values?: Record<string, unknown> } }
  | { kind: 'not-found' }
  /** The snapshot does not hold what was asked for (drafts, an unknown endpoint). */
  | { kind: 'unsupported' };

function param(params: Record<string, SearchParamValue> | undefined, key: string): string | null {
  const value = params?.[key];
  if (value === undefined || value === null) return null;
  return String(value);
}

function normalizePath(pathname: string): string {
  // Accept 'api/v1/content', '/api/v1/content/', and full URLs.
  let path = pathname;
  const schemeEnd = path.indexOf('://');
  if (schemeEnd !== -1) {
    const slash = path.indexOf('/', schemeEnd + 3);
    path = slash === -1 ? '/' : path.slice(slash);
  }
  const query = path.indexOf('?');
  if (query !== -1) path = path.slice(0, query);
  if (!path.startsWith('/')) path = '/' + path;
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

function byUpdatedDesc(a: { updated_at: string }, b: { updated_at: string }): number {
  return a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0;
}

function byUploadedDesc(a: { uploaded_at: string }, b: { uploaded_at: string }): number {
  return a.uploaded_at < b.uploaded_at ? 1 : a.uploaded_at > b.uploaded_at ? -1 : 0;
}

function bySortOrder(
  a: { sort_order: number | null; created_at: string },
  b: { sort_order: number | null; created_at: string },
): number {
  // Mirrors v1: sort_order ascending with nulls last, then created_at ascending.
  if (a.sort_order !== b.sort_order) {
    if (a.sort_order === null) return 1;
    if (b.sort_order === null) return -1;
    return a.sort_order - b.sort_order;
  }
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

function isFeatured(fields: unknown): boolean {
  return !!fields && typeof fields === 'object' && (fields as Record<string, unknown>).featured === true;
}

function publishedAt(item: BackupContentItem): string {
  const fields = item.fields;
  const value = fields && typeof fields === 'object' ? (fields as Record<string, unknown>).published_at : null;
  return typeof value === 'string' ? value : '';
}

function byPublishedDesc(a: BackupContentItem, b: BackupContentItem): number {
  // Mirrors v1's post order: published_at newest first, then created_at newest first.
  const byDate = publishedAt(b).localeCompare(publishedAt(a));
  if (byDate !== 0) return byDate;
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

function answerContent(snapshot: BackupSnapshot, params?: Record<string, SearchParamValue>): BackupAnswer {
  const status = param(params, 'status');
  const type = param(params, 'type');
  const slug = param(params, 'slug');
  const parentId = param(params, 'parent_id');
  const featured = param(params, 'featured');

  // Drafts are never in a backup. Answering [] would claim there are none.
  if (status !== null && status !== 'published' && status !== 'unlisted') return { kind: 'unsupported' };

  let items = snapshot.content.filter((item) => {
    if (status !== null) return item.status === status;
    // v1: a slug lookup (the direct link) may reach unlisted; a collection may not.
    return slug !== null ? true : item.status === 'published';
  });
  if (type !== null) items = items.filter((item) => item.type === type);
  if (parentId !== null) items = items.filter((item) => item.parent_id === parentId);
  if (featured === 'true') items = items.filter((item) => isFeatured(item.fields));
  if (slug !== null) {
    const current = items.filter((item) => item.slug === slug);
    // v1: an old slug finds the item, which answers under its current slug.
    items = current.length > 0 ? current : items.filter((item) => (item.previous_slugs ?? []).includes(slug));
  }

  items = [...items].sort(parentId !== null ? bySortOrder : type === 'post' ? byPublishedDesc : byUpdatedDesc);

  if (slug !== null) {
    return items.length === 0 ? { kind: 'not-found' } : { kind: 'ok', body: { data: items[0] } };
  }
  return { kind: 'ok', body: { data: items } };
}

function answerSchemas(snapshot: BackupSnapshot, params?: Record<string, SearchParamValue>): BackupAnswer {
  const slug = param(params, 'slug');
  const schemas = [...snapshot.schemas].sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  if (slug === null) return { kind: 'ok', body: { data: schemas } };
  const match = schemas.find((schema) => schema.slug === slug);
  return match ? { kind: 'ok', body: { data: match } } : { kind: 'not-found' };
}

function answerMedia(snapshot: BackupSnapshot, params?: Record<string, SearchParamValue>): BackupAnswer {
  // updated_since is a sync cursor against live data; a snapshot cannot honour it truthfully.
  if (param(params, 'updated_since') !== null) return { kind: 'unsupported' };

  const idParam = param(params, 'id');
  const folder = param(params, 'folder');
  const mimeType = param(params, 'mime_type');
  const includePrivate = param(params, 'include_private') === 'true';

  let assets: BackupMediaAsset[];
  if (idParam !== null) {
    const ids = new Set(idParam.split(',').map((s) => s.trim()).filter(Boolean));
    assets = snapshot.media.filter((asset) => ids.has(asset.id));
  } else {
    assets = snapshot.media.filter(
      (asset) => asset.status === 'published' && (includePrivate || !asset.is_private),
    );
  }
  if (folder !== null) assets = assets.filter((asset) => asset.folders.includes(folder));
  if (mimeType !== null) assets = assets.filter((asset) => asset.mime_type === mimeType);

  return { kind: 'ok', body: { data: [...assets].sort(byUploadedDesc) } };
}

function answerDocuments(snapshot: BackupSnapshot, params?: Record<string, SearchParamValue>): BackupAnswer {
  const id = param(params, 'id');
  const status = param(params, 'status');
  const category = param(params, 'category');

  if (status !== null && status !== 'published' && status !== 'unlisted') return { kind: 'unsupported' };

  let documents = snapshot.documents.filter((doc) => {
    if (id !== null) return doc.id === id;
    if (status !== null) return doc.status === status;
    return doc.status === 'published';
  });
  if (category !== null) documents = documents.filter((doc) => doc.category === category);
  documents = [...documents].sort(byUploadedDesc);

  if (id !== null) {
    return documents.length === 0 ? { kind: 'not-found' } : { kind: 'ok', body: { data: documents[0] } };
  }
  return { kind: 'ok', body: { data: documents } };
}

const SETTING_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function answerSettings(snapshot: BackupSnapshot, params?: Record<string, SearchParamValue>): BackupAnswer {
  const key = param(params, 'key');
  // Mirrors v1: sort_order, then key; sort_order itself is not part of the response.
  const settings = [...(snapshot.settings ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((setting) => {
      // Not destructured away: a client's lint would flag the unused binding.
      const response: Partial<BackupSiteSetting> = { ...setting };
      delete response.sort_order;
      return response as Omit<BackupSiteSetting, 'sort_order'>;
    });

  if (key !== null) {
    const match = SETTING_KEY_PATTERN.test(key) ? settings.find((setting) => setting.key === key) : undefined;
    return match ? { kind: 'ok', body: { data: match } } : { kind: 'not-found' };
  }

  const values: Record<string, unknown> = {};
  for (const setting of settings) values[setting.key] = setting.value;
  return { kind: 'ok', body: { values, data: settings } };
}

function answerBusinessInfo(snapshot: BackupSnapshot): BackupAnswer {
  if (!snapshot.businessInfo || typeof snapshot.businessInfo !== 'object') return { kind: 'unsupported' };
  return { kind: 'ok', body: { data: snapshot.businessInfo } };
}

function answerAgency(snapshot: BackupSnapshot): BackupAnswer {
  const value = snapshot.agency;
  if (!value || typeof value !== 'object' || !('data' in value)) return { kind: 'unsupported' };
  return { kind: 'ok', body: { data: value.data ?? null } };
}

function answerIntegrations(snapshot: BackupSnapshot): BackupAnswer {
  const value = snapshot.integrations;
  if (!value || typeof value !== 'object' || !Array.isArray(value.integrations)) return { kind: 'unsupported' };
  return { kind: 'ok', body: { data: value } };
}

function answerTheme(snapshot: BackupSnapshot): BackupAnswer {
  const value = snapshot.theme;
  if (!value || typeof value !== 'object' || typeof value.css !== 'string') return { kind: 'unsupported' };
  return { kind: 'ok', body: { data: value } };
}

const SEO_PATH_PATTERN = /^\/([a-z0-9._~%-]+(\/[a-z0-9._~%-]+)*)?$/;

function answerSeo(snapshot: BackupSnapshot, params?: Record<string, SearchParamValue>): BackupAnswer {
  const seo = snapshot.seo;
  if (!seo || typeof seo !== 'object' || !Array.isArray(seo.pages)) return { kind: 'unsupported' };
  const format = param(params, 'format');
  const raw = param(params, 'path');
  const lowered = raw === null ? null : raw.trim().toLowerCase();
  const path = lowered === null ? null : lowered === '/' ? '/' : lowered.replace(/\/+$/, '') || '/';
  // v1 refuses a malformed path (400); that is not the backup's to answer.
  if (path !== null && !SEO_PATH_PATTERN.test(path)) return { kind: 'unsupported' };

  switch (format) {
    case 'sitemap':
      return { kind: 'ok', body: { data: seo.sitemap } };
    case 'robots':
      return { kind: 'ok', body: { data: seo.robots } };
    case 'llms':
      return { kind: 'ok', body: { data: seo.llms } };
    case 'page_md':
      return path === null ? { kind: 'unsupported' } : { kind: 'ok', body: { data: seo.page_md?.[path] ?? null } };
    case null:
      break;
    default:
      return { kind: 'unsupported' };
  }

  if (path === null) return { kind: 'ok', body: { data: { site: seo.site, pages: seo.pages } } };
  const page = seo.pages.find((p) => p.path === path);
  if (page) return { kind: 'ok', body: { data: page } };
  if (!seo.none) return { kind: 'unsupported' };
  // v1 never 404s a path: it answers with the site defaults, for that path.
  const siteUrl = typeof seo.site?.site_url === 'string' ? seo.site.site_url : null;
  const url = siteUrl ? (path === '/' ? `${siteUrl}/` : `${siteUrl}${path}`) : null;
  const title = path === '/' && typeof seo.site?.home_title === 'string' ? seo.site.home_title : null;
  return {
    kind: 'ok',
    body: {
      data: { ...seo.none, path, title, canonical: url, open_graph: { ...(seo.none.open_graph ?? {}), url, title } },
    },
  };
}

function answerLegal(snapshot: BackupSnapshot, params?: Record<string, SearchParamValue>): BackupAnswer {
  if (!Array.isArray(snapshot.legal)) return { kind: 'unsupported' };
  const kind = param(params, 'kind');
  const slug = param(params, 'slug');
  // v1 refuses both at once (400); that is not the backup's to answer.
  if (kind !== null && slug !== null) return { kind: 'unsupported' };

  if (kind === null && slug === null) {
    // v1: the listing is published pages only, already in footer order.
    return { kind: 'ok', body: { data: snapshot.legal.filter((page) => page.status === 'published') } };
  }

  let page = snapshot.legal.find((p) => (kind !== null ? p.kind === kind : p.slug === slug));
  if (!page && slug !== null) {
    // v1: an old slug finds the page, which answers under its current slug.
    const renamed = snapshot.content.find(
      (item) => item.type === 'legal' && (item.previous_slugs ?? []).includes(slug),
    );
    if (renamed) page = snapshot.legal.find((p) => p.id === renamed.id);
  }
  return page ? { kind: 'ok', body: { data: page } } : { kind: 'not-found' };
}

/**
 * Answers a /api/v1 request from the snapshot, applying the same visibility
 * rules as the live route. Only the listing/lookup endpoints are covered;
 * anything else is `unsupported`, and the caller surfaces the live failure.
 */
export function answerFromSnapshot(
  snapshot: BackupSnapshot,
  pathname: string,
  params?: Record<string, SearchParamValue>,
): BackupAnswer {
  switch (normalizePath(pathname)) {
    case '/api/v1/content':
      return answerContent(snapshot, params);
    case '/api/v1/schemas':
      return answerSchemas(snapshot, params);
    case '/api/v1/media':
      return answerMedia(snapshot, params);
    case '/api/v1/documents':
      return answerDocuments(snapshot, params);
    case '/api/v1/settings':
      return answerSettings(snapshot, params);
    case '/api/v1/business-info':
      return answerBusinessInfo(snapshot);
    case '/api/v1/agency':
      return answerAgency(snapshot);
    case '/api/v1/legal':
      return answerLegal(snapshot, params);
    case '/api/v1/integrations':
      return answerIntegrations(snapshot);
    case '/api/v1/theme':
      return answerTheme(snapshot);
    case '/api/v1/seo':
      return answerSeo(snapshot, params);
    default:
      return { kind: 'unsupported' };
  }
}

// ---------------------------------------------------------------------------
// Backed-up image files, while Uplink is up
// ---------------------------------------------------------------------------

/**
 * Uplink's image route sends an optimized copy at most this wide
 * (DEFAULT_MAX_WIDTH in src/lib/media/image-delivery.ts, which a test keeps in
 * step). The backup holds the uploaded original, so a wider one is not used:
 * a plain <img> would download far more than Uplink would have sent.
 */
export const BACKUP_MEDIA_MAX_WIDTH = 2000;

/** The formats Uplink's image route re-encodes; anything else it sends as uploaded. */
const OPTIMIZED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

const BACKUP_MEDIA_URL_PREFIX = '/uplink-backup/media/';

const backupMediaIndex = new WeakMap<BackupSnapshot, Map<string, BackupMediaAsset>>();

/**
 * The backed-up asset whose static file may stand in for `id` at `version`:
 * same id AND same version (so the very same bytes), a public copy under
 * public/, and not an original much larger than what Uplink would send.
 */
function substitutableBackupMedia(snapshot: BackupSnapshot, id: string, version: number): BackupMediaAsset | null {
  let index = backupMediaIndex.get(snapshot);
  if (!index) {
    index = new Map(snapshot.media.map((asset) => [asset.id, asset]));
    backupMediaIndex.set(snapshot, index);
  }
  const asset = index.get(id);
  if (!asset || asset.version !== version) return null;
  if (asset.is_private || !asset.url?.startsWith(BACKUP_MEDIA_URL_PREFIX)) return null;
  const sentAsUploaded = asset.serve_original || !OPTIMIZED_MIME_TYPES.has(asset.mime_type);
  const withinOptimizedSize = asset.width !== null && asset.width <= BACKUP_MEDIA_MAX_WIDTH;
  // A person chose this in Uplink → Backups for a site that resizes images itself.
  const wideAllowed = snapshot.manifest.wideImagesFromBackup === true;
  return sentAsUploaded || withinOptimizedSize || wideAllowed ? asset : null;
}

/**
 * Whether the LIVE asset may be handed out without the key. Visibility is
 * live-only: making an image private or taking it down does not change its
 * version, so the backup copy can still look public — it must never decide.
 * Fails closed: every live media object states both, and one that does not is
 * left to Uplink.
 */
function liveMayBePublic(record: Record<string, unknown>): boolean {
  return record.is_private === false && (record.status === 'published' || record.status === 'unlisted');
}

function withBackupMedia(value: unknown, snapshot: BackupSnapshot): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((entry) => {
      const mapped = withBackupMedia(entry, snapshot);
      if (mapped !== entry) changed = true;
      return mapped;
    });
    return changed ? next : value;
  }
  if (value === null || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  let next: Record<string, unknown> | null = null;
  for (const [key, entry] of Object.entries(record)) {
    const mapped = withBackupMedia(entry, snapshot);
    if (mapped !== entry) (next ??= { ...record })[key] = mapped;
  }

  const { id, version } = record;
  if (typeof id === 'string' && typeof version === 'number' && liveMayBePublic(record)) {
    const asset = substitutableBackupMedia(snapshot, id, version);
    if (asset) {
      next ??= { ...record };
      // The same two keys a backup answer points at the local file.
      for (const key of ['url', 'image_url']) {
        if (typeof record[key] === 'string') next[key] = asset.url;
      }
    }
  }
  return next ?? value;
}

/**
 * Points the images in a LIVE /api/v1 response at their backed-up static
 * files, wherever the backup holds the very same version — so they are served
 * from the site's own CDN instead of through Uplink's image route.
 *
 * Only when the manifest says imagesFromBackup (a person's choice in Uplink →
 * Backups). The backed-up file is the uploaded original: a site must resize it
 * itself (next/image with its optimizer on), or every phone downloads the
 * original instead of Uplink's copy sized for its screen. Off, nothing changes.
 *
 * Live data still decides everything: what is shown, its visibility, alt text
 * and dimensions. Only `url` / `image_url` of a media asset change, and only to
 * the path a backup answer would give — a site that already handles backup
 * answers needs nothing else. A replaced image has a new version and keeps its
 * live URL; one that is private or not published/unlisted LIVE is never
 * swapped, whatever the backup says; an original wider than
 * BACKUP_MEDIA_MAX_WIDTH is left to Uplink's optimized copy, unless the
 * manifest says wideImagesFromBackup (a person's choice in Uplink → Backups).
 *
 * Returns `body` itself when nothing changed, and never throws.
 */
export function preferBackupMedia<T>(body: T, snapshot: BackupSnapshot | null): T {
  if (!snapshot || snapshot.manifest?.imagesFromBackup !== true || snapshot.media.length === 0) return body;
  try {
    return withBackupMedia(body, snapshot) as T;
  } catch {
    return body;
  }
}

// ---------------------------------------------------------------------------
// Live first, backup second
// ---------------------------------------------------------------------------

export interface UplinkResult<T> {
  body: T;
  source: 'live' | 'backup';
  /** The snapshot's `dataAsOf` when served from backup; null when live. */
  dataAsOf: string | null;
}

export interface FallbackRequest {
  pathname: string;
  searchParams?: Record<string, SearchParamValue>;
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { code?: unknown } | null;
    return typeof body?.code === 'string' ? body.code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Performs `live` once. On success returns its JSON. On a failure that means
 * Uplink is unavailable, answers from the snapshot `loadSnapshot` provides.
 * Otherwise — or when there is no snapshot, or it cannot answer — throws an
 * UplinkRequestError describing the LIVE failure. A snapshot "not found"
 * becomes a 404 UplinkRequestError, so a site's not-found handling still runs.
 *
 * No retries, ever: a 423 is deliberate, and a 5xx retry storm helps nobody.
 */
export async function fetchWithBackupFallback<T>(
  request: FallbackRequest,
  live: () => Promise<Response>,
  loadSnapshot: () => Promise<BackupSnapshot | null>,
): Promise<UplinkResult<T>> {
  let failure: LiveFailure;
  let message: string;

  try {
    const response = await live();
    if (response.ok) {
      try {
        return { body: (await response.json()) as T, source: 'live', dataAsOf: null };
      } catch {
        throw new UplinkRequestError('Uplink API returned a malformed response', { kind: 'invalid-json' });
      }
    }
    failure = { kind: 'http', status: response.status, code: await readErrorCode(response) };
    message = `Uplink API error: ${response.status} ${response.statusText}`.trim();
  } catch (error) {
    if (error instanceof UplinkRequestError) throw error;
    failure = isTimeout(error) ? { kind: 'timeout' } : { kind: 'network' };
    message = `Uplink API unreachable: ${error instanceof Error ? error.message : String(error)}`;
  }

  if (!shouldServeBackup(failure)) throw new UplinkRequestError(message, failure);

  const snapshot = await loadSnapshot();
  if (!snapshot || snapshot.manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new UplinkRequestError(message, failure);
  }

  const answer = answerFromSnapshot(snapshot, request.pathname, request.searchParams);
  if (answer.kind === 'ok') {
    return { body: answer.body as T, source: 'backup', dataAsOf: snapshot.manifest.dataAsOf };
  }
  if (answer.kind === 'not-found') {
    throw new UplinkRequestError('Not found in Uplink backup', { kind: 'http', status: 404, code: 'not_found' });
  }
  throw new UplinkRequestError(message, failure);
}
