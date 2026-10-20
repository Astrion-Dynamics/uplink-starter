import 'server-only';

// Managed by the Uplink installer (--with-backups). Replaced with --force.
//
// A drop-in for './uplink': import getUplinkJson from here instead, and when
// Uplink cannot be reached, answers 5xx, or the client was switched Offline
// (423 UPLINK_CLIENT_OFFLINE_BY_USER), the site is served from the backup
// committed under uplink-backup/ — with the same visibility rules as the API.
//
// It never hides a mistake: a wrong key or host (401/403), a 404, a 400 and a
// malformed response are thrown as before. It never retries.
//
// While Uplink is up, and only if "Serve images from the backup" is on in
// Uplink → Backups, an image the backup holds at the very same version is
// pointed at its static copy under public/uplink-backup/media/, so it loads
// from the site's own CDN (see preferBackupMedia in ./uplink-fallback). That
// copy is the original: render it with <UplinkImage>, and keep next/image's
// optimizer on, so each screen still gets a file its own size.
//
// Refresh the backup with: npm run uplink:backup

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getUplinkJson as getLiveUplinkJson, SITE_KIT_GENERATION, UplinkError, type UplinkRequestOptions } from './uplink';
import {
  BACKUP_FORMAT_VERSION,
  answerFromSnapshot,
  preferBackupMedia,
  shouldServeBackup,
  type BackupSnapshot,
  type LiveFailure,
} from './uplink-fallback';

export * from './uplink';

export interface UplinkResult<T> {
  data: T;
  /** 'backup' when Uplink was unavailable and the committed backup answered. */
  source: 'live' | 'backup';
  /** When served from backup: the data is current as of this time. Null when live. */
  dataAsOf: string | null;
}

let backup: Promise<BackupSnapshot | null> | null = null;

/**
 * The committed backup, or null when there is none yet (the installer's
 * placeholder) or it is from an incompatible format. The JSON is bundled at
 * build time, so a deploy carries the backup that was committed with it.
 */
export function loadUplinkBackup(): Promise<BackupSnapshot | null> {
  backup ??= (async () => {
    const [manifest, content, schemas, media, documents, settings, businessInfo, legal, integrations, theme, seo, agency] = await Promise.all([
      import('../uplink-backup/manifest.json'),
      import('../uplink-backup/content.json'),
      import('../uplink-backup/schemas.json'),
      import('../uplink-backup/media.json'),
      import('../uplink-backup/documents.json'),
      import('../uplink-backup/settings.json'),
      import('../uplink-backup/business-info.json'),
      import('../uplink-backup/legal.json'),
      import('../uplink-backup/integrations.json'),
      import('../uplink-backup/theme.json'),
      import('../uplink-backup/seo.json'),
      import('../uplink-backup/agency.json'),
    ]);
    const snapshot = {
      manifest: manifest.default,
      content: content.default,
      schemas: schemas.default,
      media: media.default,
      documents: documents.default,
      settings: settings.default,
      businessInfo: businessInfo.default,
      legal: legal.default,
      integrations: integrations.default,
      theme: theme.default,
      seo: seo.default,
      agency: agency.default,
    } as unknown as BackupSnapshot;
    if (snapshot.manifest.formatVersion !== BACKUP_FORMAT_VERSION || snapshot.manifest.dataAsOf === null) {
      return null;
    }
    return snapshot;
  })().catch(() => null);
  return backup;
}

/** Only the failures that can mean "Uplink is unavailable" — see shouldServeBackup. */
function liveFailure(error: unknown): LiveFailure | null {
  if (!(error instanceof UplinkError)) return null;
  if (error.kind === 'network') return { kind: 'network' };
  if (error.status > 0) return { kind: 'http', status: error.status, code: error.code };
  return null;
}

let warned = false;

/** Like getUplinkJson, and says where the answer came from. */
export async function getUplinkJsonWithSource<T>(
  pathname: string,
  options: UplinkRequestOptions = {}
): Promise<UplinkResult<T>> {
  try {
    // Tells Uplink the site reads it through this fallback (the Uplink Score's resilience checks).
    const headers = new Headers(options.headers);
    headers.set('Uplink-Site-Kit', 'uplink=' + SITE_KIT_GENERATION + '; fallback=1');
    const data = await getLiveUplinkJson<T>(pathname, { ...options, headers });
    return { data: preferBackupMedia(data, await loadUplinkBackup()), source: 'live', dataAsOf: null };
  } catch (error) {
    const failure = liveFailure(error);
    if (!failure || !shouldServeBackup(failure)) throw error;

    const snapshot = await loadUplinkBackup();
    if (!snapshot) throw error;

    const answer = answerFromSnapshot(snapshot, pathname, options.searchParams);
    if (answer.kind === 'not-found') {
      throw new UplinkError('Not found in the Uplink backup: ' + pathname, 'not_found', 404, 'not_found');
    }
    if (answer.kind !== 'ok') throw error;

    if (!warned) {
      warned = true;
      console.warn(
        '[uplink] ' + (error instanceof Error ? error.message : 'Uplink unavailable') +
          ' — serving the repository backup (data as of ' + snapshot.manifest.dataAsOf + ').'
      );
    }
    return { data: answer.body as T, source: 'backup', dataAsOf: snapshot.manifest.dataAsOf };
  }
}

/** Drop-in replacement for getUplinkJson from './uplink', with the backup behind it. */
export async function getUplinkJson<T>(pathname: string, options: UplinkRequestOptions = {}): Promise<T> {
  return (await getUplinkJsonWithSource<T>(pathname, options)).data;
}

const BACKUP_FILE = /^(public\/)?uplink-backup\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

/**
 * The backed-up file of one media asset, for a site route that serves images
 * itself (a proxy that adds the API key, say) to answer with when Uplink
 * cannot be reached. Null when the backup does not hold it.
 *
 * For a public image, prefer its "url" from the backup: it is a static file
 * under public/. This is for PRIVATE images (backed up with
 * "npm run uplink:backup -- --include-private"), which live in
 * uplink-backup/private-media/ — never web-served, so only your route, under
 * your own rules, hands them out. On Vercel that route must bundle the folder;
 * in next.config:
 *   outputFileTracingIncludes: { '/your/image/route': ['./uplink-backup/private-media/**'] }
 */
export async function readUplinkBackupMedia(
  id: string
): Promise<{ bytes: Uint8Array; contentType: string; version: number } | null> {
  const snapshot = await loadUplinkBackup();
  const asset = snapshot?.media.find((m) => m.id === id);
  const file = asset?.backup_path;
  if (!asset || !file || !BACKUP_FILE.test(file) || file.split('/').includes('..')) return null;
  try {
    // turbopackIgnore: a dynamic path from process.cwd() would otherwise trace the
    // whole project into every function importing this file. The route that calls
    // this bundles the folder itself (outputFileTracingIncludes, above).
    const bytes = await readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), file));
    return { bytes: new Uint8Array(bytes), contentType: asset.mime_type, version: asset.version };
  } catch {
    return null;
  }
}
