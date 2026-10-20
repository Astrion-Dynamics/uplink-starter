import Link from 'next/link';
import { getBusinessInfo, getLegalPages } from '@/lib/site';
import { CookieSettingsLink } from '@/lib/uplink-consent';

// Contact details and social links from Uplink → Business Info, legal pages
// from Uplink → Legal, and the cookie banner's settings link. Uplink builds
// every link (tel:, mailto:, maps, profiles): render href, never build one.
export async function SiteFooter() {
  const [business, legal] = await Promise.all([getBusinessInfo(), getLegalPages()]);

  return (
    <footer className="mt-section border-t border-border">
      <div className="mx-auto grid max-w-site gap-items px-gutter py-8 text-small text-text-muted">
        {business && (business.phone || business.email || business.address) ? (
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {business.phone ? (
              <li>
                <a href={business.phone.href} className="hover:text-text">
                  {business.phone.display}
                </a>
              </li>
            ) : null}
            {business.email ? (
              <li>
                <a href={business.email.href} className="hover:text-text">
                  {business.email.display}
                </a>
              </li>
            ) : null}
            {business.address ? (
              <li>
                <a href={business.address.maps_href} className="hover:text-text">
                  {business.address.lines.join(', ')}
                </a>
              </li>
            ) : null}
          </ul>
        ) : null}
        {business && business.social.length > 0 ? (
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {business.social.map((profile) => (
              <li key={profile.href}>
                <a href={profile.href} className="hover:text-text" rel="me noopener">
                  {profile.label}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <nav aria-label="Legal">
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {legal.map((page) => (
              <li key={page.slug}>
                <Link href={'/' + page.slug} className="hover:text-text">
                  {page.nav_label ?? page.title}
                </Link>
              </li>
            ))}
            <li>
              <CookieSettingsLink className="hover:text-text" />
            </li>
          </ul>
        </nav>
        {business?.name ? (
          <p>
            © {new Date().getFullYear()} {business.legal_name ?? business.name}
          </p>
        ) : null}
      </div>
    </footer>
  );
}
