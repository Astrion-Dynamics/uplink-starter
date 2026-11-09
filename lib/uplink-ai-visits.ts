/**
 * Uplink Analytics: AI tools reading this site.
 *
 * ChatGPT, Claude, Perplexity and other AI tools fetch pages themselves and
 * never run JavaScript, so the visitor script can't count them. Call
 * reportAiVisit(request) from the site's proxy (proxy.ts on Next.js 16,
 * middleware.ts on 15) and hand what it returns to event.waitUntil(): it tells
 * Uplink which page an AI tool fetched, after the page is answered, and does
 * nothing at all for anyone else. It sends the path and the user agent, never
 * a query string, cookie or IP address. Uplink counts it only while Uplink
 * Analytics is on (Uplink → Integrations) and shows it in Workspace → Traffic.
 *
 *   import type { NextFetchEvent, NextRequest } from 'next/server';
 *   import { reportAiVisit } from './lib/uplink-ai-visits';
 *
 *   export function proxy(request: NextRequest, event: NextFetchEvent) {
 *     const report = reportAiVisit(request);
 *     if (report) event.waitUntil(report);
 *   }
 */

/** A quick, broad test; Uplink names each tool precisely. */
const AI_AGENT_HINT =
  /gptbot|chatgpt-user|oai-searchbot|claude|anthropic|perplexity|mistralai|duckassist|meta-external|cloudvertex|applebot-extended|amazonbot|youbot|bytespider|ccbot|cohere|diffbot|timpibot/i;

export function reportAiVisit(request: Request): Promise<void> | null {
  const userAgent = request.headers.get('user-agent') || '';
  if (!AI_AGENT_HINT.test(userAgent)) return null;
  const apiKey = process.env.UPLINK_API_KEY;
  if (!apiKey) return null;
  const host = process.env.UPLINK_HOST || 'https://www.uplinkcms.com';
  const path = new URL(request.url).pathname;
  return fetch(host.replace(/\/+$/, '') + '/api/v1/ai-visits', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, user_agent: userAgent.slice(0, 512) }),
    signal: AbortSignal.timeout(3000),
  }).then(
    () => undefined,
    () => undefined,
  );
}
