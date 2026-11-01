import 'server-only';

// ---------------------------------------------------------------------------
// Shared types — mirror the shapes returned by the Uplink API.
// Import these in your server components and API routes for type safety.
// ---------------------------------------------------------------------------

export type ContentStatus = 'draft' | 'published' | 'unlisted';

/** A single field definition within a list schema (from GET /api/v1/schemas). */
export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'url' | 'boolean' | 'number' | 'select' | 'radio' | 'image' | 'media' | 'json' | 'object';
  description?: string;
  required?: boolean;
  options?: string[];
  fields?: FieldDef[];
}

/** A list schema item returned by GET /api/v1/schemas. */
export interface SchemaItem {
  id: string;
  slug: string;
  name: string;
  schema: FieldDef[];
}

/**
 * A content item returned by GET /api/v1/content. Keys are snake_case, exactly
 * as the API sends them.
 */
export interface ContentItem {
  id: string;
  type: 'page' | 'post' | 'custom' | 'list' | 'legal';
  title: string;
  slug: string;
  /** Old slugs a renamed item was live at; a slug lookup also matches these. */
  previous_slugs: string[];
  content: string;
  status: ContentStatus;
  /** Set on list items: the id of the list they belong to. */
  parent_id: string | null;
  sort_order: number | null;
  schema: FieldDef[] | null;
  fields: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  /** Posts only: computed from the body each time the post is served. */
  word_count?: number;
  reading_minutes?: number;
}

// ---------------------------------------------------------------------------

/**
 * What went wrong, so callers can decide without matching message strings:
 *
 *   config     UPLINK_HOST / UPLINK_API_KEY are wrong or missing (3xx, 401, 403).
 *              Nothing will fix itself — fail the build rather than hide sections.
 *   not_found  404: the thing asked for does not exist or is not published.
 *   offline    423: someone switched this client's delivery Offline in Uplink to
 *              test the site's fallbacks. Render the fallback.
 *   server     Uplink answered with some other error (usually 5xx).
 *   network    Uplink could not be reached at all.
 */
export type UplinkErrorKind = 'config' | 'not_found' | 'offline' | 'server' | 'network';

export class UplinkError extends Error {
  readonly kind: UplinkErrorKind;
  /** HTTP status, or 0 when no response was received. */
  readonly status: number;
  /** Uplink's machine-readable code, e.g. "missing_authorization", when it sent one. */
  readonly code: string | undefined;

  constructor(message: string, kind: UplinkErrorKind, status: number, code?: string) {
    super(message);
    this.name = 'UplinkError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/**
 * True for a misconfiguration: wrong host, missing/invalid key, a redirect.
 * Rethrow these — at build time that fails the deploy, which is what you want:
 * a site that silently renders with every CMS section hidden is worse than a
 * failed deploy that names the fix.
 */
export function isUplinkConfigError(error: unknown): error is UplinkError {
  return error instanceof UplinkError && error.kind === 'config';
}

function getRequiredEnv(name: string, value: string | undefined) {
  if (!value) {
    throw new UplinkError(
      'Missing ' + name + '. Add it to your .env.local file before calling the Uplink API.',
      'config',
      0,
    );
  }

  return value;
}

function kindForStatus(status: number): UplinkErrorKind {
  if (status === 401 || status === 403) return 'config';
  if (status === 404) return 'not_found';
  if (status === 423) return 'offline';
  return 'server';
}

export interface UplinkRequestOptions extends RequestInit {
  searchParams?: Record<string, string | number | boolean | null | undefined>;
}

/**
 * Fallback revalidation window, in seconds.
 *
 * With a webhook registered in Uplink, edits arrive within seconds and this
 * value never comes into play. It is the safety net for the case where the
 * webhook is misconfigured, disabled, or its delivery fails permanently — the
 * site still catches up on its own rather than serving stale content forever.
 */
const FALLBACK_REVALIDATE_SECONDS = 3600;

/**
 * Which generation of this helper the site runs, sent as the Uplink-Site-Kit
 * header so Uplink can tell its errors are loud (the Uplink Score). Bumped
 * only by the installer.
 */
export const SITE_KIT_GENERATION = 1;

/**
 * Cache tags attached to every Uplink fetch, so an incoming webhook can
 * invalidate exactly the affected responses via revalidateTag.
 *
 * This scheme MUST stay in step with the tags Uplink sends — see
 * src/lib/webhooks/tags.ts in the CMS. If they drift, revalidation silently
 * stops working while everything still appears configured.
 */
function uplinkCacheTags(
  pathname: string,
  searchParams?: UplinkRequestOptions['searchParams']
): string[] {
  const tags = ['uplink'];
  const slug = searchParams?.slug;
  const parentId = searchParams?.parent_id;

  if (pathname.includes('/media')) {
    tags.push('uplink:media');
  } else if (pathname.includes('/documents')) {
    tags.push('uplink:documents');
  } else if (pathname.includes('/settings')) {
    tags.push('uplink:settings');
  } else if (pathname.includes('/business-info')) {
    tags.push('uplink:business-info');
  } else if (pathname.includes('/integrations')) {
    // The cookie banner links the published legal pages.
    tags.push('uplink:integrations', 'uplink:content');
  } else if (pathname.endsWith('/agency')) {
    tags.push('uplink:agency');
  } else if (pathname.endsWith('/theme')) {
    tags.push('uplink:theme');
  } else if (pathname.endsWith('/seo')) {
    // Built from posts, legal pages and the business name as well.
    tags.push('uplink:seo', 'uplink:content', 'uplink:business-info');
  } else {
    // /content and /schemas both read content_items.
    tags.push('uplink:content');
    if (slug) tags.push('uplink:content:' + String(slug));
    if (parentId) tags.push('uplink:list:' + String(parentId));
  }

  return tags;
}

export async function getUplinkJson<T>(
  pathname: string,
  options: UplinkRequestOptions = {}
): Promise<T> {
  // Uplink's address is built in; UPLINK_HOST only overrides it (a preview or local Uplink).
  const host = process.env.UPLINK_HOST || 'https://www.uplinkcms.com';
  const apiKey = getRequiredEnv('UPLINK_API_KEY', process.env.UPLINK_API_KEY);
  const { searchParams, headers, next, ...init } = options;
  const url = new URL(pathname, host.endsWith('/') ? host : host + '/');

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null) {
        continue;
      }

      url.searchParams.set(key, String(value));
    }
  }

  const mergedHeaders = new Headers(headers);
  mergedHeaders.set('Authorization', 'Bearer ' + apiKey);
  mergedHeaders.set('Accept', 'application/json');
  // Tells Uplink which helper the site reads it with, for the Uplink Score; lib/uplink-backup.ts adds fallback=1.
  if (!mergedHeaders.has('Uplink-Site-Kit')) mergedHeaders.set('Uplink-Site-Kit', 'uplink=' + SITE_KIT_GENERATION);

  // Only needed when UPLINK_HOST is a protected preview deployment: Vercel
  // turns the request away before Uplink sees the key unless it carries the
  // bypass secret. Leave it unset for production.
  const bypass = process.env.UPLINK_PROTECTION_BYPASS;
  if (bypass) mergedHeaders.set('x-vercel-protection-bypass', bypass);

  // Caller-supplied tags and revalidate win; the defaults only fill the gaps.
  const nextOptions = (next ?? {}) as { tags?: string[]; revalidate?: number | false };
  const mergedNext = {
    ...nextOptions,
    tags: [...new Set([...uplinkCacheTags(pathname, searchParams), ...(nextOptions.tags ?? [])])],
    revalidate:
      nextOptions.revalidate !== undefined ? nextOptions.revalidate : FALLBACK_REVALIDATE_SECONDS,
  };

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: mergedHeaders,
      next: mergedNext,
      // Never follow a redirect. When one crosses origins (http -> https, or
      // uplinkcms.com -> www.uplinkcms.com) fetch drops the Authorization
      // header, the request arrives with no key, and the 401 that comes back
      // looks exactly like "nothing is published".
      redirect: 'manual',
    });
  } catch (cause) {
    throw new UplinkError(
      'Could not reach Uplink at ' + url.origin + ': ' + (cause instanceof Error ? cause.message : String(cause)),
      'network',
      0,
    );
  }

  // A browser runtime reports a manual redirect as an opaque status 0.
  if ((response.status >= 300 && response.status < 400) || response.type === 'opaqueredirect') {
    const location = response.headers.get('location');
    const target = location ? new URL(location, url).origin : null;
    throw new UplinkError(
      target
        ? 'UPLINK_HOST redirects to ' + target + '. Set UPLINK_HOST to ' + target +
            ' — following the redirect would drop the API key.'
        : 'UPLINK_HOST (' + url.origin + ') answered with a redirect. Set it to the exact host ' +
            'shown next to the API key in Uplink (e.g. https://www.uplinkcms.com).',
      'config',
      response.status,
    );
  }

  if (!response.ok) {
    // Uplink's errors are JSON: { error, code? }. Keep its explanation.
    let detail = response.statusText;
    let code: string | undefined;
    try {
      const body = (await response.json()) as { error?: string; code?: string };
      if (body.error) detail = body.error;
      code = body.code;
    } catch {
      // Not JSON — the status line is all there is.
    }
    throw new UplinkError(
      'Uplink API error ' + response.status + ' for ' + url.pathname + ': ' + detail,
      kindForStatus(response.status),
      response.status,
      code,
    );
  }

  return response.json() as Promise<T>;
}
