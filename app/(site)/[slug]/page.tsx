import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { getLegalPage } from '@/lib/site';
import { getUplinkJson } from '@/lib/uplink-backup';
import { UplinkPageQA, UplinkPageSeo, uplinkMetadata } from '@/lib/uplink-seo';

type Params = { params: Promise<{ slug: string }> };

// Legal pages (Uplink → Workspace → Legal) at /{slug} — /terms-of-service,
// /privacy-policy — which is where Search & sharing lists them. Uplink never
// writes legal text: the business provides it, and it is shown exactly as
// published. Any other slug is a 404 until a page is built for it.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  return uplinkMetadata('/' + slug, {}, getUplinkJson);
}

export default async function SlugPage({ params }: Params) {
  const { slug } = await params;
  const page = await getLegalPage(slug);
  if (!page) notFound();
  // A renamed page keeps answering at its old slug: send visitors on.
  if (page.slug !== slug) permanentRedirect('/' + page.slug);

  const path = '/' + page.slug;
  return (
    <article className="mx-auto max-w-readable px-gutter py-section">
      <UplinkPageSeo path={path} load={getUplinkJson} />
      <h1 className="font-heading text-h1">{page.title}</h1>
      {page.effective_date ? (
        <p className="mt-2 text-small text-text-muted">Effective {formatDate(page.effective_date)}</p>
      ) : null}
      {/* Cleaned by Uplink on every read: no scripts, styles or handlers. */}
      <div className="site-prose mt-8" dangerouslySetInnerHTML={{ __html: page.body_html }} />
      <UplinkPageQA path={path} load={getUplinkJson} />
    </article>
  );
}

function formatDate(value: string): string {
  const date = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
