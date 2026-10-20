import type { Metadata } from 'next';
import { getBusinessInfo } from '@/lib/site';
import { getUplinkJson } from '@/lib/uplink-backup';
import { UplinkPageQA, UplinkPageSeo, uplinkMetadata } from '@/lib/uplink-seo';

export function generateMetadata(): Promise<Metadata> {
  return uplinkMetadata('/', {}, getUplinkJson);
}

// The home page. It starts with the business's name, tagline and call to
// action from Uplink → Business Info. Build the rest from Uplink content
// (lists of sections, services, team …) — never from text written here.
export default async function HomePage() {
  const business = await getBusinessInfo();
  const cta = business?.cta?.href ? business.cta : null;

  return (
    <>
      <UplinkPageSeo path="/" load={getUplinkJson} />
      <section className="mx-auto max-w-site px-gutter py-section">
        <h1 className="font-heading text-h1">{business?.name ?? 'This site is being set up'}</h1>
        {business?.tagline ? <p className="mt-4 max-w-readable text-lead text-text-muted">{business.tagline}</p> : null}
        {cta?.href ? (
          <a
            href={cta.href}
            className="mt-8 inline-block rounded-button bg-primary px-6 py-3 text-on-primary hover:bg-primary-hover"
          >
            {cta.label ?? 'Get in touch'}
          </a>
        ) : null}
      </section>
      <div className="mx-auto max-w-site px-gutter">
        <UplinkPageQA path="/" load={getUplinkJson} />
      </div>
    </>
  );
}
