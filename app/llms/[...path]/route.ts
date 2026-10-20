import { uplinkLlmsText } from '../../../lib/uplink-seo';

// app/llms/[...path]/route.ts — written by the Uplink installer. One page in
// plain text for AI tools, linked from /llms.txt: /llms/about.md is /about,
// /llms/index.md the home page. It carries every question the page answers,
// including the ones set to "AI only".
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const joined = '/' + path.join('/');
  if (!joined.endsWith('.md')) return new Response('Not found', { status: 404 });
  const pagePath = joined === '/index.md' ? '/' : joined.slice(0, -3);
  const text = await uplinkLlmsText(pagePath);
  if (text === null) return new Response('Not found', { status: 404 });
  return new Response(text, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}
