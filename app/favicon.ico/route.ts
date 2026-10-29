import { getUplinkJson } from '../../lib/uplink';

// app/favicon.ico/route.ts — written by the Uplink installer. The favicon from
// Uplink → Workspace → Business Info, at the address browsers, Google and
// Vercel look for first. A <link rel="icon"> alone is not enough: the Vercel
// dashboard and many crawlers only ever ask for /favicon.ico, and Google
// shows a grey globe when that address has nothing. Sent as a PNG inside an
// .ico, the one format every reader of /favicon.ico understands. Revalidated
// with Business Info (the uplink:business-info tag); not found when Business
// Info has no favicon.

export const revalidate = 3600;

const UPLINK_IMAGE_PATH = /\/api\/v1\/media\/([0-9a-f-]{36})\/image$/i;
const SIZE = 128;

function notFound() {
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

/** The asset's id and version, from the URL Business Info gives for it. */
function source(imageUrl: string | null | undefined): { id: string; version: string } | null {
  if (!imageUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(imageUrl, 'http://site.invalid');
  } catch {
    return null;
  }
  const match = UPLINK_IMAGE_PATH.exec(parsed.pathname);
  const version = parsed.searchParams.get('v');
  return match && version ? { id: match[1], version } : null;
}

/** A PNG wrapped in a one-image .ico (PNG entries are read since Windows Vista). */
function pngToIco(png: Uint8Array): ArrayBuffer | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.length < 24 || signature.some((byte, i) => png[i] !== byte)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const ico = new Uint8Array(22 + png.length);
  const out = new DataView(ico.buffer);
  out.setUint16(2, 1, true); // an icon
  out.setUint16(4, 1, true); // holding one image
  ico[6] = width >= 256 ? 0 : width; // 0 means 256
  ico[7] = height >= 256 ? 0 : height;
  out.setUint16(10, 1, true); // colour planes
  out.setUint16(12, 32, true); // bits per pixel
  out.setUint32(14, png.length, true);
  out.setUint32(18, 22, true); // where the PNG starts
  ico.set(png, 22);
  return ico.buffer;
}

export async function GET() {
  let favicon: { image_url?: string | null } | null = null;
  try {
    const body = await getUplinkJson<{ data: { favicon?: { image_url?: string | null } | null } | null }>(
      '/api/v1/business-info',
    );
    favicon = body.data?.favicon ?? null;
  } catch {
    return notFound();
  }
  const asset = source(favicon?.image_url);
  const host = process.env.UPLINK_HOST;
  const apiKey = process.env.UPLINK_API_KEY;
  if (!asset || !host || !apiKey) return notFound();

  const upstream = new URL('/api/v1/media/' + asset.id + '/image', host);
  upstream.searchParams.set('v', asset.version);
  upstream.searchParams.set('w', String(SIZE));
  upstream.searchParams.set('format', 'png');
  const headers = new Headers({ Authorization: 'Bearer ' + apiKey, Accept: 'image/png' });
  // Only for a protected preview UPLINK_HOST; unset in production.
  const bypass = process.env.UPLINK_PROTECTION_BYPASS;
  if (bypass) headers.set('x-vercel-protection-bypass', bypass);

  let res: Response;
  try {
    res = await fetch(upstream, {
      headers,
      redirect: 'manual',
      next: { tags: ['uplink', 'uplink:business-info', 'uplink:media'], revalidate },
    });
  } catch {
    return notFound();
  }
  if (res.status !== 200) {
    await res.body?.cancel();
    return notFound();
  }

  const bytes = await res.arrayBuffer();
  const ico = pngToIco(new Uint8Array(bytes));
  // "Serve original" on a non-PNG favicon: send it as it is rather than nothing.
  return new Response(ico ?? bytes, {
    headers: {
      'Content-Type': ico ? 'image/x-icon' : (res.headers.get('content-type') ?? 'application/octet-stream'),
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
