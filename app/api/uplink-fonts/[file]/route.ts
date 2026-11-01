/**
 * Uplink theme fonts, served from this site's own origin.
 * Written by the Uplink installer; the CSS <UplinkTheme /> renders points here.
 *
 * - A visitor's browser talks only to this site — never to Google or Uplink —
 *   so fonts need no cookie-banner entry, and the API key stays on the server.
 * - Each file is named by its SHA-256, so its bytes never change: this site's
 *   CDN keeps it for a year, and only the first visitor per edge region waits.
 * - If Uplink does not answer (down, or switched Offline), the copy in
 *   public/uplink-backup/fonts/ is used when the site has repository backups.
 */

const FONT_FILE = /^[a-f0-9]{64}\.woff2$/;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!FONT_FILE.test(file)) return new Response('Not found', { status: 404, headers: NO_STORE });

  const host = process.env.UPLINK_HOST || 'https://www.uplinkcms.com';
  const apiKey = process.env.UPLINK_API_KEY;
  if (!apiKey) {
    return new Response('UPLINK_API_KEY must be set', { status: 500, headers: NO_STORE });
  }

  const headers = new Headers({ Authorization: 'Bearer ' + apiKey });
  // Only for a protected preview UPLINK_HOST; unset in production.
  const bypass = process.env.UPLINK_PROTECTION_BYPASS;
  if (bypass) headers.set('x-vercel-protection-bypass', bypass);

  let res: Response | null = null;
  try {
    // A redirect would drop the key on the way (see lib/uplink.ts), so none is followed.
    res = await fetch(new URL('/api/v1/theme/fonts/' + file, host), { headers, redirect: 'manual', cache: 'no-store' });
  } catch {
    res = null;
  }

  if (!res || res.status !== 200 || !res.body) {
    await res?.body?.cancel();
    // The repository backup's copy, when there is one (a 404 there otherwise). Never cached.
    return new Response(null, {
      status: 307,
      headers: { Location: new URL('/uplink-backup/fonts/' + file, request.url).toString(), ...NO_STORE },
    });
  }

  return new Response(res.body, {
    headers: {
      'Content-Type': 'font/woff2',
      'Cache-Control': IMMUTABLE,
      'CDN-Cache-Control': IMMUTABLE,
    },
  });
}
