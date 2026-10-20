import { uplinkLlmsText } from '../../lib/uplink-seo';

// app/llms.txt/route.ts — written by the Uplink installer. The plain-text index
// AI tools read (llmstxt.org), built by Uplink from Search & sharing. Not found
// when the person turned AI tools off.
export async function GET() {
  const text = await uplinkLlmsText(null);
  if (text === null) return new Response('Not found', { status: 404 });
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
