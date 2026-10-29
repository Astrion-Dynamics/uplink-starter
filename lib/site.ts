import 'server-only';
import { cache } from 'react';
import { UplinkError } from './uplink';
import { getUplinkJson } from './uplink-backup';
import type { UplinkImageAsset } from './uplink-image';

/**
 * lib/site.ts — what every page of this site reads from Uplink.
 *
 * Reads go through ./uplink-backup, so the site answers from the backup in
 * uplink-backup/ when Uplink cannot be reached. A wrong key or host is thrown
 * (a failed build that names the fix beats a site with every section hidden);
 * anything else Uplink cannot answer leaves that part of the page out.
 */

export interface BusinessInfo {
  name: string | null;
  legal_name: string | null;
  tagline: string | null;
  logo: (UplinkImageAsset & { version: number }) | null;
  favicon: (UplinkImageAsset & { version: number }) | null;
  phone: { display: string; href: string } | null;
  email: { display: string; href: string } | null;
  address: { lines: string[]; maps_href: string } | null;
  cta: { label: string | null; href: string | null } | null;
  social: Array<{ platform: string; label: string; href: string }>;
}

export interface LegalPage {
  kind: string;
  title: string;
  slug: string;
  nav_label: string | null;
  effective_date: string | null;
  body_html: string;
}

async function read<T>(pathname: string, searchParams?: Record<string, string>): Promise<T | null> {
  try {
    const body = await getUplinkJson<{ data: T }>(pathname, { searchParams });
    return body.data ?? null;
  } catch (error) {
    if (error instanceof UplinkError && error.kind === 'config') throw error;
    if (!(error instanceof UplinkError && error.kind === 'not_found')) {
      console.error('[uplink] ' + pathname + ': ' + (error instanceof Error ? error.message : String(error)));
    }
    return null;
  }
}

export const getBusinessInfo = cache(() => read<BusinessInfo>('/api/v1/business-info'));

export const getLegalPages = cache(async () => (await read<LegalPage[]>('/api/v1/legal')) ?? []);

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const getLegalPage = cache((slug: string) =>
  SLUG.test(slug) ? read<LegalPage>('/api/v1/legal', { slug }) : Promise.resolve(null),
);

const UPLINK_IMAGE_PATH = /\/api\/v1\/media\/([0-9a-f-]{36})\/image$/i;

/**
 * The favicon's address: /favicon.ico (app/favicon.ico/route.ts), where the
 * Vercel dashboard and Google look for it, with its media id and version so a
 * browser fetches a new one when it changes in Uplink (and the Uplink Score can
 * tell it is the Business Info favicon). A backed-up copy is linked as is.
 */
export function faviconHref(asset: UplinkImageAsset): string | null {
  const candidate = asset.image_url ?? asset.url;
  if (!candidate) return null;
  if (candidate.startsWith('/uplink-backup/')) return candidate;
  let parsed: URL;
  try {
    parsed = new URL(candidate, 'http://site.invalid');
  } catch {
    return null;
  }
  const match = UPLINK_IMAGE_PATH.exec(parsed.pathname);
  const version = parsed.searchParams.get('v');
  if (!match || !version) return null;
  return '/favicon.ico?media=' + match[1] + '&v=' + version;
}
