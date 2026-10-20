import 'server-only';
import { getUplinkJson } from './uplink';
import { UplinkIntegrationsClient, type UplinkCredit } from './uplink-consent';

/**
 * lib/uplink-integrations.tsx — written by the Uplink installer.
 *
 * Renders the integrations set up in Uplink → Integrations — Google Analytics,
 * the cookie banner — on every page. Put it once in the root layout:
 *
 *   <body>
 *     {children}
 *     <UplinkIntegrations />
 *   </body>
 *
 * A change in Uplink reaches the site without a deploy: the fetch is tagged
 * uplink:integrations, which Uplink's webhook revalidates.
 *
 * It also carries the Uplink credit for developers when Uplink sends one: a
 * <meta name="generator"> tag and one console message, nothing a visitor sees.
 * Whether it is sent is decided in Uplink (White label); leave it to Uplink
 * rather than removing it here.
 *
 * A font service set up there (Adobe Fonts) arrives as a stylesheet, rendered
 * here as a <link> React hoists into <head> — only a use.typekit.net kit URL.
 *
 * If Uplink can't be reached, nothing renders — no tracking is the safe
 * failure. A site with repository backups passes the backup reader instead,
 * so its tags keep working while Uplink is away:
 *
 *   import { getUplinkJson } from '@/lib/uplink-backup';
 *   <UplinkIntegrations load={getUplinkJson} />
 */

type Loader = <T>(pathname: string) => Promise<T>;

/** The credit, only when Uplink sent a well-formed one; otherwise nothing is shown. */
function readCredit(data: unknown): UplinkCredit | null {
  if (typeof data !== 'object' || data === null) return null;
  const credit = (data as { credit?: unknown }).credit;
  if (typeof credit !== 'object' || credit === null) return null;
  const { name, url, message } = credit as Record<string, unknown>;
  if (typeof name !== 'string' || !/^[A-Za-z0-9 .-]{1,40}$/.test(name)) return null;
  if (typeof url !== 'string' || !url.startsWith('https://') || url.length > 300) return null;
  if (typeof message !== 'string' || message.length > 500) return null;
  return { name, url, message };
}

/** A font service's stylesheet: only an Adobe Fonts kit URL is ever rendered. */
const FONT_SERVICE_STYLESHEET = /^https:\/\/use\.typekit\.net\/[a-z0-9]{6,8}\.css$/;

function readStylesheets(data: unknown): string[] {
  if (typeof data !== 'object' || data === null) return [];
  const integrations = (data as { integrations?: unknown }).integrations;
  if (!Array.isArray(integrations)) return [];
  const hrefs: string[] = [];
  for (const item of integrations) {
    const styles = typeof item === 'object' && item !== null ? (item as { styles?: unknown }).styles : null;
    if (!Array.isArray(styles)) continue;
    for (const style of styles) {
      const href = typeof style === 'object' && style !== null ? (style as { href?: unknown }).href : null;
      if (typeof href === 'string' && FONT_SERVICE_STYLESHEET.test(href) && !hrefs.includes(href)) hrefs.push(href);
    }
  }
  return hrefs;
}

/** @component UplinkIntegrations */
export default async function UplinkIntegrations({ load = getUplinkJson }: { load?: Loader }) {
  // Lets Uplink's "Check site" see the component is installed, whether or not Uplink answered.
  const marker = <span hidden data-uplink-integrations="1" />;
  let data: unknown = null;
  try {
    data = (await load<{ data: unknown }>('/api/v1/integrations')).data;
  } catch {
    return marker;
  }
  const credit = readCredit(data);
  const stylesheets = readStylesheets(data);
  return (
    <>
      {marker}
      {credit && <meta name="generator" content={credit.name} />}
      {stylesheets.length > 0 && <link rel="preconnect" href="https://use.typekit.net" crossOrigin="anonymous" />}
      {stylesheets.map((href) => (
        <link key={href} rel="stylesheet" href={href} precedence="default" />
      ))}
      <UplinkIntegrationsClient data={data} credit={credit} />
    </>
  );
}
