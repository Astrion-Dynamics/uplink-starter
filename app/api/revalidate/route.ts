import { revalidateTag } from 'next/cache';

/**
 * POST /api/revalidate
 *
 * Receives change notifications from Uplink and drops the cached responses they
 * affect, so an edit in the CMS appears here within seconds instead of waiting
 * out the fallback revalidate window in lib/uplink.ts.
 *
 * Register this URL under API Keys -> Webhooks in Uplink. That screen shows the
 * signing secret exactly once; add it as UPLINK_WEBHOOK_SECRET to the host's
 * environment variables (Vercel, Netlify, ...). Uplink cannot reach a local
 * dev server, so .env.local does not need it.
 */

const TOLERANCE_SECONDS = 300;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function expectedSignature(secret: string, timestamp: string, rawBody: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(timestamp + '.' + rawBody)
  );
  return Array.from(new Uint8Array(signed))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function POST(request: Request) {
  const secret = process.env.UPLINK_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: 'UPLINK_WEBHOOK_SECRET is not set' }, { status: 503 });
  }

  // The signature covers the bytes as sent. Re-serialising parsed JSON will not
  // round-trip, so the raw text must be read before anything parses it.
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-uplink-signature');
  const timestampHeader = request.headers.get('x-uplink-timestamp');

  if (!signatureHeader || !timestampHeader) {
    return Response.json({ error: 'Missing signature headers' }, { status: 401 });
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return Response.json({ error: 'Malformed timestamp' }, { status: 401 });
  }

  // Bounds how long a captured delivery stays replayable.
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > TOLERANCE_SECONDS) {
    return Response.json({ error: 'Timestamp outside tolerance window' }, { status: 401 });
  }

  const [version, provided] = signatureHeader.split('=', 2);
  if (version !== 'v1' || !provided) {
    return Response.json({ error: 'Unsupported signature version' }, { status: 401 });
  }

  const expected = await expectedSignature(secret, timestampHeader, rawBody);
  if (!timingSafeEqual(provided, expected)) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as { tags?: string[]; event?: string };
  const tags = payload.tags ?? [];

  // Expire at once: { expire: 0 } is Next 16's documented choice for a webhook
  // ('max' would hand the next visitor the stale page). Next 15 takes one
  // argument and already expires at once; the cast type-checks on both.
  const expireNow = revalidateTag as (tag: string, profile: { expire: number }) => void;
  for (const tag of tags) {
    expireNow(tag, { expire: 0 });
  }

  return Response.json({ revalidated: tags.length, event: payload.event ?? null });
}
