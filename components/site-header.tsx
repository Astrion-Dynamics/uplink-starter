import Link from 'next/link';
import { getBusinessInfo } from '@/lib/site';
import { UplinkImage } from '@/lib/uplink-image';

const LOGO_HEIGHT = 40;

// The logo, name and call to action come from Uplink → Business Info. Never
// add a logo file or a phone number here: change it in Uplink.
export async function SiteHeader() {
  const business = await getBusinessInfo();
  const logo = business?.logo;
  const logoWidth = logo?.width && logo?.height ? Math.round((LOGO_HEIGHT * logo.width) / logo.height) : null;
  const cta = business?.cta?.href ? business.cta : null;

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-site items-center justify-between gap-items px-gutter py-4">
        <Link href="/" className="flex items-center gap-3 font-heading text-h5">
          {logo && logoWidth ? (
            <UplinkImage
              asset={logo}
              width={logoWidth}
              height={LOGO_HEIGHT}
              sizes={logoWidth + 'px'}
              alt={logo.alt_text ?? business?.name ?? 'Home'}
              priority
            />
          ) : (
            <span>{business?.name ?? 'Home'}</span>
          )}
        </Link>
        {cta?.href ? (
          <a href={cta.href} className="rounded-button bg-primary px-4 py-2 text-on-primary hover:bg-primary-hover">
            {cta.label ?? 'Get in touch'}
          </a>
        ) : null}
      </div>
    </header>
  );
}
