import 'server-only';
import { cache, type ReactNode } from 'react';
import type { Metadata, MetadataRoute } from 'next';
import { getUplinkJson } from './uplink';

/**
 * lib/uplink-seo.tsx — written by the Uplink installer.
 *
 * Search & sharing: how each page appears in search results, AI answers and
 * share cards, set in Uplink → Workspace → Search & sharing (often by an
 * agent). Uplink builds everything — the title with the site name, the
 * description, Open Graph and X cards, schema.org JSON-LD, the questions a
 * page answers — so a page never hard-codes its metadata:
 *
 *   // app/about/page.tsx
 *   export const generateMetadata = () => uplinkMetadata('/about', { title: 'About us' });
 *
 *   export default async function About() {
 *     return (
 *       <>
 *         <UplinkPageSeo path="/about" />
 *         …the page…
 *         <UplinkPageQA path="/about" />   // the Q&A spot: wherever the questions go
 *       </>
 *     );
 *   }
 *
 * The second argument of uplinkMetadata() is the page's own metadata: it is
 * used for anything Uplink leaves unset, and for everything when Uplink can't
 * be reached. The fetch is tagged uplink:seo, so a change in Uplink reaches
 * the site without a deploy.
 *
 * Put <UplinkPageQA> on EVERY page, even one with no questions yet: the person
 * decides in Uplink whether its questions are shown, collapsed or for AI tools
 * only, and nobody touches the code again. It always leaves an empty marker
 * (data-uplink-qa) so Uplink's Check site can tell the spot is there.
 *
 * A site with repository backups passes the backup reader as `load`:
 *   import { getUplinkJson } from '@/lib/uplink-backup';
 *   uplinkMetadata('/about', { title: 'About us' }, getUplinkJson);
 */

type Loader = <T>(pathname: string, options?: { searchParams?: Record<string, string> }) => Promise<T>;

export interface UplinkSeoImage {
  id: string;
  version: number;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  mime_type: string;
  image_url: string;
  serve_original?: boolean;
}

export interface UplinkFaqItem {
  question: string;
  answer: string;
}

export interface UplinkPageSeoData {
  path: string;
  kind: string;
  entry: boolean;
  label: string | null;
  title: string | null;
  title_template: string | null;
  description: string | null;
  summary: string | null;
  canonical: string | null;
  robots: { index: boolean; follow: boolean };
  open_graph: {
    type: string;
    title: string | null;
    description: string | null;
    url: string | null;
    site_name: string | null;
    image: UplinkSeoImage | null;
    published_time: string | null;
    modified_time: string | null;
  };
  x: { card: string; site: string | null; title: string | null; description: string | null; image: UplinkSeoImage | null };
  faq: { display: string; items: UplinkFaqItem[]; json_ld: Record<string, unknown> | null };
  json_ld: Record<string, unknown>[];
  verification: { google: string | null; bing: string | null };
}

function isPageSeo(value: unknown): value is UplinkPageSeoData {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.path === 'string' && !!v.robots && !!v.open_graph && !!v.faq && Array.isArray(v.json_ld);
}

/**
 * One page's Search & sharing, or null when Uplink can't be reached. Cached per
 * request, so generateMetadata, <UplinkPageSeo> and <UplinkPageQA> share one fetch.
 */
export const getPageSeo = cache(async (path: string, load: Loader = getUplinkJson): Promise<UplinkPageSeoData | null> => {
  try {
    const body = await load<{ data: unknown }>('/api/v1/seo', { searchParams: { path } });
    return isPageSeo(body?.data) ? body.data : null;
  } catch {
    return null;
  }
});

const UPLINK_IMAGE = /\/api\/v1\/media\/([0-9a-f-]{36})\/image$/i;
const SHARE_WIDTH = 1200;

/**
 * A share image as a URL on this site: through its own image route
 * (app/api/media/[id]/route.ts) at 1200 px, which share crawlers get in the
 * original format. Relative; Next.js makes it absolute with metadataBase.
 */
export function uplinkShareImageUrl(image: UplinkSeoImage): string | null {
  if (image.image_url.startsWith('/uplink-backup/')) return image.image_url;
  let parsed: URL;
  try {
    parsed = new URL(image.image_url, 'http://site.invalid');
  } catch {
    return null;
  }
  const match = UPLINK_IMAGE.exec(parsed.pathname);
  if (!match || !parsed.searchParams.has('v')) return null;
  const original = parsed.searchParams.has('original') || /^image\/(svg\+xml|gif)$/.test(image.mime_type);
  return '/api/media/' + match[1] + parsed.search + (original ? '' : '&w=' + SHARE_WIDTH);
}

function shareImages(image: UplinkSeoImage | null) {
  if (!image) return undefined;
  const url = uplinkShareImageUrl(image);
  if (!url) return undefined;
  const scale = image.width && image.width > SHARE_WIDTH ? SHARE_WIDTH / image.width : 1;
  return [
    {
      url,
      width: image.width ? Math.round(image.width * scale) : undefined,
      height: image.height ? Math.round(image.height * scale) : undefined,
      alt: image.alt_text ?? undefined,
    },
  ];
}

/**
 * The page's metadata from Uplink, over the page's own (`fallback`). Uplink
 * wins field by field where it has a value; the rest is the fallback's.
 */
export async function uplinkMetadata(path: string, fallback: Metadata = {}, load?: Loader): Promise<Metadata> {
  const seo = await getPageSeo(path, load);
  if (!seo) return fallback;

  const ownTitle = typeof fallback.title === 'string' ? fallback.title : null;
  const title = seo.title
    ? { absolute: seo.title }
    : ownTitle && seo.title_template
      ? { absolute: seo.title_template.replace('%s', ownTitle) }
      : fallback.title;
  const description = seo.description ?? fallback.description;
  const og = seo.open_graph;
  const images = shareImages(og.image);

  const metadata: Metadata = {
    ...fallback,
    title,
    description,
    alternates: { ...fallback.alternates, canonical: seo.canonical ?? fallback.alternates?.canonical },
    openGraph: {
      ...(fallback.openGraph ?? {}),
      type: og.type === 'article' ? 'article' : 'website',
      title: og.title ?? ownTitle ?? undefined,
      description: og.description ?? description ?? undefined,
      url: og.url ?? undefined,
      siteName: og.site_name ?? undefined,
      ...(images ? { images } : {}),
      ...(og.published_time ? { publishedTime: og.published_time } : {}),
      ...(og.modified_time ? { modifiedTime: og.modified_time } : {}),
    } as Metadata['openGraph'],
    twitter: {
      ...(fallback.twitter ?? {}),
      card: seo.x.card === 'summary_large_image' && images ? 'summary_large_image' : 'summary',
      ...(seo.x.site ? { site: seo.x.site } : {}),
      title: seo.x.title ?? ownTitle ?? undefined,
      description: seo.x.description ?? description ?? undefined,
      ...(images ? { images: images.map((image) => image.url) } : {}),
    } as Metadata['twitter'],
  };
  if (!seo.robots.index) metadata.robots = { index: false, follow: seo.robots.follow };
  if (seo.verification.google || seo.verification.bing) {
    metadata.verification = {
      ...fallback.verification,
      ...(seo.verification.google ? { google: seo.verification.google } : {}),
      ...(seo.verification.bing ? { other: { 'msvalidate.01': seo.verification.bing } } : {}),
    };
  }
  if (!fallback.metadataBase && seo.canonical) metadata.metadataBase = new URL(new URL(seo.canonical).origin);
  return metadata;
}

/** JSON for a <script> tag: "<" escaped, so no value can close the tag. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** The page's schema.org JSON-LD (page type, breadcrumbs, article). Never the FAQ — <UplinkPageQA> owns that. */
export async function UplinkPageSeo({ path, load }: { path: string; load?: Loader }) {
  const seo = await getPageSeo(path, load);
  if (!seo || seo.json_ld.length === 0) return null;
  return (
    <>
      {seo.json_ld.map((node, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: scriptJson(node) }} />
      ))}
    </>
  );
}

const QA_STYLE = [
  ':where(.uplink-qa){margin-block:var(--uplink-section,3rem);}',
  ':where(.uplink-qa h2){font-family:var(--uplink-family-h2,inherit);font-size:var(--uplink-text-h2,1.5rem);',
  'font-weight:var(--uplink-weight-h2,700);line-height:var(--uplink-leading-h2,1.25);margin:0 0 var(--uplink-space-md,1rem);}',
  ':where(.uplink-qa-item){border-top:1px solid var(--uplink-color-border,rgba(127,127,127,.3));padding-block:var(--uplink-space-md,1rem);}',
  ':where(.uplink-qa-q){font-family:var(--uplink-family-h3,inherit);font-weight:var(--uplink-weight-h3,600);margin:0;}',
  ':where(summary.uplink-qa-q){cursor:pointer;}',
  ':where(.uplink-qa-a){color:var(--uplink-color-text-muted,inherit);margin:var(--uplink-space-sm,.5rem) 0 0;}',
  ':where(.uplink-qa-a p){margin:0 0 var(--uplink-space-sm,.5rem);}',
].join('');

function Answer({ text }: { text: string }) {
  return (
    <div className="uplink-qa-a">
      {text.split(/\n{2,}/).map((paragraph, i) => (
        <p key={i}>{paragraph.split('\n').flatMap((line, j) => (j > 0 ? [<br key={j} />, line] : [line]))}</p>
      ))}
    </div>
  );
}

/**
 * The Q&A spot. Shows the page's questions the way the person chose in Uplink:
 * a list (shown), accordions (collapsed), or nothing (ai_only). Styled with the
 * Uplink theme's variables at zero specificity, so the site's own classes win;
 * pass `render` to draw the questions with the site's own components.
 *
 * The FAQPage markup is written here and only here, in the same render that
 * shows the questions: Google penalises FAQ markup for questions a visitor
 * can't see, so a page without this spot can never carry it.
 */
export async function UplinkPageQA({
  path,
  heading = 'Frequently asked questions',
  className,
  render,
  load,
}: {
  path: string;
  heading?: string | null;
  className?: string;
  render?: (items: UplinkFaqItem[], display: 'shown' | 'collapsed') => ReactNode;
  load?: Loader;
}) {
  const seo = await getPageSeo(path, load);
  const faq = seo?.faq;
  const display = faq?.display === 'shown' || faq?.display === 'collapsed' ? faq.display : null;
  if (!faq || !display || faq.items.length === 0) {
    return <div data-uplink-qa={path} hidden />;
  }

  return (
    <section data-uplink-qa={path} className={className ? 'uplink-qa ' + className : 'uplink-qa'}>
      {faq.json_ld ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: scriptJson(faq.json_ld) }} /> : null}
      {render ? (
        render(faq.items, display)
      ) : (
        <>
          <style>{QA_STYLE}</style>
          {heading ? <h2>{heading}</h2> : null}
          {faq.items.map((item, i) =>
            display === 'collapsed' ? (
              <details key={i} className="uplink-qa-item">
                <summary className="uplink-qa-q">{item.question}</summary>
                <Answer text={item.answer} />
              </details>
            ) : (
              <div key={i} className="uplink-qa-item">
                <h3 className="uplink-qa-q">{item.question}</h3>
                <Answer text={item.answer} />
              </div>
            ),
          )}
        </>
      )}
    </section>
  );
}

/** For app/sitemap.ts: every page, post and legal page Uplink knows, or `fallback` when it can't be reached. */
export async function uplinkSitemap(fallback: MetadataRoute.Sitemap = [], load: Loader = getUplinkJson): Promise<MetadataRoute.Sitemap> {
  try {
    const body = await load<{ data: { url: string | null; last_modified: string | null }[] }>('/api/v1/seo', {
      searchParams: { format: 'sitemap' },
    });
    if (!Array.isArray(body?.data)) return fallback;
    return body.data
      .filter((entry) => typeof entry.url === 'string')
      .map((entry) => ({ url: entry.url as string, ...(entry.last_modified ? { lastModified: entry.last_modified } : {}) }));
  } catch {
    return fallback;
  }
}

/** For app/robots.ts: Uplink's rules (including the AI tools switch), or `fallback`. */
export async function uplinkRobots(fallback: MetadataRoute.Robots, load: Loader = getUplinkJson): Promise<MetadataRoute.Robots> {
  try {
    const body = await load<{
      data: { rules: { user_agent: string | string[]; allow?: string; disallow?: string | string[] }[]; sitemap: string | null };
    }>('/api/v1/seo', { searchParams: { format: 'robots' } });
    if (!Array.isArray(body?.data?.rules)) return fallback;
    return {
      rules: body.data.rules.map((rule) => ({ userAgent: rule.user_agent, allow: rule.allow, disallow: rule.disallow })),
      ...(body.data.sitemap ? { sitemap: body.data.sitemap } : {}),
    };
  } catch {
    return fallback;
  }
}

/** llms.txt, or one page's plain-text version (a path); null when AI tools are off or Uplink can't be reached. */
export async function uplinkLlmsText(path: string | null, load: Loader = getUplinkJson): Promise<string | null> {
  try {
    const body = await load<{ data: string | null }>('/api/v1/seo', {
      searchParams: path === null ? { format: 'llms' } : { format: 'page_md', path },
    });
    return typeof body?.data === 'string' ? body.data : null;
  } catch {
    return null;
  }
}
