/**
 * Where this visitor is, for the Uplink cookie banner (lib/uplink-consent.tsx).
 * Written by the Uplink installer.
 *
 * - Answers only with what the host already puts on the request: the country,
 *   and the region where the host gives one (Quebec needs it). It looks nothing
 *   up, keeps nothing, and never sends it to Uplink.
 * - Every answer is per visitor, so nothing may keep it: no-store everywhere.
 * - A host that does not say (or a site without this route) gives no country,
 *   and the banner then asks the visitor, which is the safe side.
 */

export const dynamic = 'force-dynamic';

const NO_STORE = {
  'Cache-Control': 'private, no-store',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
};

function country(value: string | null | undefined): string | null {
  const code = (value ?? '').toUpperCase();
  // XX and T1 are Cloudflare's "unknown" and "Tor".
  return /^[A-Z]{2}$/.test(code) && code !== 'XX' ? code : null;
}

function region(value: string | null | undefined): string | null {
  const code = (value ?? '').toUpperCase();
  return /^[A-Z0-9]{1,3}$/.test(code) ? code : null;
}

export function GET(request: Request) {
  const headers = request.headers;
  // Vercel, then Cloudflare (country only).
  let place = {
    country: country(headers.get('x-vercel-ip-country') ?? headers.get('cf-ipcountry')),
    region: region(headers.get('x-vercel-ip-country-region')),
  };
  // Netlify: base64 JSON with country.code and subdivision.code.
  const netlify = headers.get('x-nf-geo');
  if (!place.country && netlify) {
    try {
      const geo = JSON.parse(atob(netlify));
      place = { country: country(geo?.country?.code), region: region(geo?.subdivision?.code) };
    } catch {
      // Unreadable: unknown.
    }
  }
  if (!place.country) place.region = null;
  return Response.json(place, { headers: NO_STORE });
}
