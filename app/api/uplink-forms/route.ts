/**
 * app/api/uplink-forms/route.ts — written by the Uplink installer.
 *
 * Where <UplinkForm /> (lib/uplink-form.tsx) sends a message, and tells Uplink
 * a form was seen or started. It adds the site's Uplink key on the server, so
 * the key never reaches a browser, and passes on the visitor's IP address and
 * browser for Uplink's spam limits only (Uplink keeps neither).
 *
 * Only this site's own pages can send through it: a browser always names the
 * page's origin on a POST, and any other origin is refused.
 */

export const dynamic = 'force-dynamic';

const MAX_BODY = 64 * 1024;
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NO_STORE = { 'Cache-Control': 'no-store' };

function sameSite(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || new URL(request.url).host;
  try {
    return new URL(origin).host === host.split(',')[0].trim();
  } catch {
    return false;
  }
}

function visitorIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (forwarded || request.headers.get('x-real-ip') || '').slice(0, 64);
}

export async function POST(request: Request) {
  if (!sameSite(request)) return Response.json({ error: 'Not allowed' }, { status: 403, headers: NO_STORE });
  const raw = await request.text().catch(() => '');
  let body: Record<string, unknown> = {};
  try {
    body = raw && raw.length <= MAX_BODY ? JSON.parse(raw) : {};
  } catch {
    body = {};
  }
  const action = body.action;
  const form = typeof body.form === 'string' && KEY.test(body.form) ? body.form : null;
  if (!form || (action !== 'submit' && action !== 'view' && action !== 'start')) {
    return Response.json({ error: 'The form could not be read.' }, { status: 400, headers: NO_STORE });
  }

  const apiKey = process.env.UPLINK_API_KEY;
  const host = (process.env.UPLINK_HOST || 'https://www.uplinkcms.com').replace(/\/+$/, '');
  if (!apiKey) {
    console.error('UPLINK_API_KEY is not set: <UplinkForm /> cannot send messages.');
    return Response.json({ error: 'This form cannot send messages right now.' }, { status: 503, headers: NO_STORE });
  }
  const headers: Record<string, string> = {
    Authorization: 'Bearer ' + apiKey,
    'Content-Type': 'application/json',
    'Uplink-Visitor-IP': visitorIp(request),
    'Uplink-Visitor-UA': (request.headers.get('user-agent') || '').slice(0, 512),
  };
  const bypass = process.env.UPLINK_PROTECTION_BYPASS;
  if (bypass) headers['x-vercel-protection-bypass'] = bypass;
  const path = typeof body.path === 'string' ? body.path.slice(0, 512) : '/';

  if (action !== 'submit') {
    await fetch(host + '/api/v1/forms/events', {
      method: 'POST',
      headers,
      body: JSON.stringify({ form, path, event: action }),
      redirect: 'manual',
      signal: AbortSignal.timeout(3000),
    }).catch(() => undefined);
    return new Response(null, { status: 204, headers: NO_STORE });
  }

  try {
    const response = await fetch(host + '/api/v1/forms/submit', {
      method: 'POST',
      headers,
      body: JSON.stringify({ form, path, values: body.values, hp: body.hp, elapsed_ms: body.elapsed_ms }),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    const answer = (await response.json().catch(() => ({}))) as {
      ok?: unknown;
      error?: unknown;
      fields?: unknown;
      redirect_url?: unknown;
    };
    if (response.ok) {
      // Where the form sends the visitor on to (a payment link), as Uplink worked it out: https only.
      const next = typeof answer.redirect_url === 'string' && answer.redirect_url.startsWith('https://') ? answer.redirect_url : null;
      return Response.json(next ? { ok: true, redirect_url: next } : { ok: true }, { headers: NO_STORE });
    }
    if (response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 400)) {
      console.error('Uplink refused the form (' + response.status + '): check UPLINK_API_KEY and UPLINK_HOST.');
    }
    return Response.json(
      {
        error: typeof answer.error === 'string' ? answer.error : 'Your message could not be sent. Please try again.',
        fields: typeof answer.fields === 'object' && answer.fields !== null ? answer.fields : undefined,
      },
      { status: response.status >= 400 && response.status < 600 ? response.status : 502, headers: NO_STORE },
    );
  } catch {
    return Response.json({ error: 'Your message could not be sent. Please try again in a minute.' }, { status: 502, headers: NO_STORE });
  }
}
