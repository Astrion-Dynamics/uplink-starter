import type { NextFetchEvent, NextRequest } from 'next/server';
import { reportAiVisit } from './lib/uplink-ai-visits';

/** Tells Uplink when an AI tool fetches a page (lib/uplink-ai-visits.ts). Changes nothing else. */
export function proxy(request: NextRequest, event: NextFetchEvent) {
  const report = reportAiVisit(request);
  if (report) event.waitUntil(report);
}

export const config = {
  // Pages and the files AI tools read (robots.txt, llms.txt, sitemap.xml), not the app's own assets.
  matcher: ['/((?!_next/|api/|uplink(?:/|$)|favicon\\.ico|.*\\.(?:png|jpe?g|gif|webp|avif|svg|ico|css|js|map|woff2?)$).*)'],
};
