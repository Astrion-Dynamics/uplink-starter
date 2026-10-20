import { getUplinkJson, UplinkError } from '../../../lib/uplink';

/**
 * Theme previews for lib/uplink-theme-preview.tsx. Written by the Uplink installer.
 *
 * - Answers only for a preview token Uplink made for THIS site: it asks
 *   /api/v1/theme?preview=… with the site's key, and Uplink refuses another
 *   site's token, so a leaked link shows nothing anywhere else.
 * - Every answer belongs to one browser: never stored by this site's CDN or by
 *   Next.js.
 */

export const dynamic = 'force-dynamic';

const TOKEN = /^uthp_[A-Za-z0-9_-]{43}$/;
const NO_STORE = { 'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store' };

type PreviewBody = {
  data?: { css?: unknown; base_css?: unknown; preview?: { label?: unknown; expires_at?: unknown } };
};

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  if (!TOKEN.test(token)) return Response.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });

  try {
    const body = await getUplinkJson<PreviewBody>('/api/v1/theme', {
      searchParams: { preview: token },
      cache: 'no-store',
      next: { revalidate: 0 },
    });
    const data = body.data ?? {};
    return Response.json(
      {
        css: typeof data.css === 'string' ? data.css : '',
        base_css: typeof data.base_css === 'string' ? data.base_css : '',
        label: typeof data.preview?.label === 'string' ? data.preview.label : null,
        expires_at: typeof data.preview?.expires_at === 'string' ? data.preview.expires_at : null,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    const ended = error instanceof UplinkError && error.kind === 'not_found';
    return Response.json(
      { error: ended ? 'This theme preview has ended.' : 'The theme preview could not be loaded.' },
      { status: ended ? 404 : 502, headers: NO_STORE },
    );
  }
}
