/**
 * Uplink images and videos, served from this site's own origin.
 * Written by the Uplink installer; <UplinkImage> (lib/uplink-image.tsx) points
 * every image here.
 *
 * - The API key stays on the server: the browser only ever sees this URL.
 * - This site's CDN keeps every size it sends. Uplink's own CDN never stores
 *   an image, so without this every new visitor waits on Uplink for every
 *   image; with it, only the first visitor to ask for a size does.
 * - w, h and q are forwarded, so each srcset entry is a real, smaller file
 *   (and w=1280 on a video is its phone copy); poster=1 is a video's poster still.
 * - Range is forwarded, so a phone can start a video before it has all of it.
 * - Only versioned URLs (?v=) are served: their bytes never change, which is
 *   what makes keeping them at the edge safe.
 * - A private image is refused. Uplink marks it Cache-Control: private, and
 *   this route answers anyone, without a key — which a private image must never
 *   reach. Serve those from a route of your own that checks who is signed in.
 */

const FORWARDED_PARAMS = ['v', 'w', 'h', 'q', 'original', 'poster'];
const FORWARDED_REQUEST_HEADERS = ['accept', 'range', 'if-none-match'];
const PASSED_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'cache-control',
  'etag',
  'vary',
];
const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const incoming = new URL(request.url).searchParams;
  if (!MEDIA_ID.test(id) || !/^[0-9]+$/.test(incoming.get('v') ?? '')) {
    return new Response('Not found', { status: 404, headers: NO_STORE });
  }

  const host = process.env.UPLINK_HOST;
  const apiKey = process.env.UPLINK_API_KEY;
  if (!host || !apiKey) {
    return new Response('UPLINK_HOST and UPLINK_API_KEY must be set', { status: 500, headers: NO_STORE });
  }

  const upstream = new URL('/api/v1/media/' + id + '/image', host);
  for (const name of FORWARDED_PARAMS) {
    const value = incoming.get(name);
    if (value !== null) upstream.searchParams.set(name, value);
  }

  const headers = new Headers({ Authorization: 'Bearer ' + apiKey });
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Only for a protected preview UPLINK_HOST; unset in production.
  const bypass = process.env.UPLINK_PROTECTION_BYPASS;
  if (bypass) headers.set('x-vercel-protection-bypass', bypass);

  let res: Response;
  try {
    // no-store: this route's own answer is what gets cached, at the CDN. A
    // redirect would drop the key on the way (see lib/uplink.ts), so none is followed.
    res = await fetch(upstream, { headers, redirect: 'manual', cache: 'no-store' });
  } catch {
    return new Response('Uplink could not be reached', { status: 502, headers: NO_STORE });
  }

  const cacheControl = res.headers.get('cache-control') ?? '';
  if (/\bprivate\b/.test(cacheControl)) {
    await res.body?.cancel();
    return new Response('Not found', { status: 404, headers: NO_STORE });
  }

  if (res.status !== 200 && res.status !== 206 && res.status !== 304) {
    await res.body?.cancel();
    // 404: replaced or unpublished. 423: switched Offline in Uplink. Never cached.
    return new Response(null, { status: res.status >= 500 || res.status < 400 ? 502 : res.status, headers: NO_STORE });
  }

  const out = new Headers();
  for (const name of PASSED_RESPONSE_HEADERS) {
    const value = res.headers.get(name);
    if (value) out.set(name, value);
  }
  // Uplink tells its own CDN not to store images; that header is deliberately
  // not passed on. This site's CDN may keep a complete, public, versioned file
  // as long as a browser may (Vary: Accept keeps AVIF, WebP and JPEG apart).
  // A copy Uplink sends only for now (not immutable) is never kept.
  if (res.status === 200 && /\bpublic\b/.test(cacheControl) && /\bimmutable\b/.test(cacheControl)) {
    out.set('CDN-Cache-Control', cacheControl);
  }

  return new Response(res.status === 304 ? null : res.body, { status: res.status, headers: out });
}
