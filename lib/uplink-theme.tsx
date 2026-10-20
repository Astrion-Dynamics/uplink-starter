import 'server-only';
import { getUplinkJson } from './uplink';
import UplinkThemePreview from './uplink-theme-preview';

/**
 * lib/uplink-theme.tsx — written by the Uplink installer.
 *
 * Puts the theme set in Uplink → Workspace → Theme on every page: the colours,
 * fonts, text sizes and spacing as --uplink-* CSS variables, the font files
 * (served from this site's own domain by app/api/uplink-fonts/[file]/route.ts)
 * and at most two font preloads. Render it once, in the root layout's <head>:
 *
 *   <html lang="en">
 *     <head><UplinkTheme /></head>
 *     <body>…</body>
 *   </html>
 *
 * Map your classes onto the variables with app/uplink-theme.css (Tailwind) or
 * use them directly: color: var(--uplink-color-text).
 *
 * A change in Uplink reaches the site without a deploy: the fetch is tagged
 * uplink:theme, which Uplink's webhook revalidates.
 *
 * <UplinkTheme base /> also sets element defaults (body, h1–h6, links) with
 * zero specificity, so a new site gets sensible headings with no classes and
 * your own classes always win. Off by default, so installing changes nothing.
 *
 * If Uplink can't be reached, nothing is rendered and the fallbacks in
 * app/uplink-theme.css apply. A site with repository backups passes the
 * backup reader, so its look survives while Uplink is away:
 *
 *   import { getUplinkJson } from '@/lib/uplink-backup';
 *   <UplinkTheme load={getUplinkJson} />
 *
 * It also renders <UplinkThemePreview /> (lib/uplink-theme-preview.tsx), which
 * shows a theme someone is trying out in Uplink — only in the browser that
 * opened the preview link — and nothing for anyone else.
 */

type Loader = <T>(pathname: string) => Promise<T>;

const FONT_FILE = /^[a-f0-9]{64}\.woff2$/;
const FONT_PATH = '/api/uplink-fonts/';
const MAX_CSS = 32 * 1024;

/** Uplink builds this CSS from checked values; check again that nothing can leave the <style> element. */
function safeCss(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_CSS) return '';
  if (/[<>\\]|@import|javascript:/i.test(value)) return '';
  return value;
}

function preloads(data: Record<string, unknown>): string[] {
  const fonts = data.fonts;
  if (typeof fonts !== 'object' || fonts === null) return [];
  const list = (fonts as { preload?: unknown }).preload;
  if (!Array.isArray(list)) return [];
  return list.filter((file): file is string => typeof file === 'string' && FONT_FILE.test(file)).slice(0, 2);
}

/** @component UplinkTheme */
export default async function UplinkTheme({ load = getUplinkJson, base = false }: { load?: Loader; base?: boolean }) {
  let data: Record<string, unknown> = {};
  try {
    const body = await load<{ data: unknown }>('/api/v1/theme');
    if (typeof body.data === 'object' && body.data !== null) data = body.data as Record<string, unknown>;
  } catch {
    data = {};
  }
  const css = safeCss(data.css) + (base ? safeCss(data.base_css) : '');
  return (
    <>
      {preloads(data).map((file) => (
        <link key={file} rel="preload" href={FONT_PATH + file} as="font" type="font/woff2" crossOrigin="anonymous" />
      ))}
      {/* data-uplink-theme lets Uplink's "Check site" see the component is installed. */}
      <style data-uplink-theme="1" dangerouslySetInnerHTML={{ __html: css }} />
      <UplinkThemePreview base={base} />
    </>
  );
}
