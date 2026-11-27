import 'server-only';
import type { ReactNode } from 'react';
import { getUplinkJson, isUplinkConfigError } from './uplink';
import { UplinkImage, type UplinkImageAsset } from './uplink-image';
import { UplinkJsonLd } from './uplink-seo';

/**
 * lib/uplink-products.tsx — written by the Uplink installer.
 *
 * A products list from Uplink (Content → New → Products): packages, services,
 * tickets, gift cards or digital items, each with photos, a price and a Buy
 * button that opens the business's own Stripe or Square payment link. On any
 * page:
 *
 *   import UplinkProducts from '@/lib/uplink-products';
 *   <UplinkProducts list="products" />
 *
 * Uplink runs no checkout: Stripe or Square take the payment, and a physical
 * product collects the shipping address and a flat shipping rate on the
 * payment link itself. There is no cart, stock count or tax here. An item
 * marked Sold out or Out of stock shows that instead of the button.
 *
 * Each card carries its schema.org Product + Offer JSON-LD (name, description,
 * photos, price, availability), rendered in the same place as the price so
 * search engines see only what a visitor does.
 *
 * It matches the site's Uplink theme (colours, radius, fonts) through the
 * --uplink-* variables <UplinkTheme /> renders. Pass className to place it,
 * unstyled to style .uplink-products yourself, or render to draw the products
 * with the site's own components (show each price where its JSON-LD is):
 *
 *   <UplinkProducts list="products" render={(products) => <MyGrid products={products} />} />
 *
 * getUplinkProducts(list) returns the same products for a page of your own,
 * such as /shop/[slug]. With repository backups, pass load={getUplinkJson}
 * from lib/uplink-backup. Changes in Uplink reach the site without a deploy
 * (the fetch is tagged uplink:content). If Uplink can't be reached, fallback renders
 * (nothing by default).
 */

type Loader = <T>(pathname: string, options?: { searchParams?: Record<string, string> }) => Promise<T>;

export interface UplinkProductOffer {
  /** The Stripe or Square payment link the Buy button opens. */
  url: string;
  provider: 'stripe' | 'square';
  /** The price as a visitor reads it, e.g. "CA$25.00". */
  price_display: string;
  /** in_stock, out_of_stock, sold_out, preorder or limited, or null when not set. */
  availability: string | null;
  /** The words for availability, e.g. "Sold out", or null. */
  availability_label: string | null;
  /** False when it is sold out or out of stock: show no Buy button. */
  available: boolean;
  /** "monthly" or "yearly" for a recurring price (price_display already says "/ month"), or null. */
  billing_period: 'monthly' | 'yearly' | null;
  /** The site page people order or book on before paying, when set in Uplink; search engines are sent there. */
  page_url: string | null;
}

export interface UplinkProduct {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  image: UplinkImageAsset | null;
  gallery: UplinkImageAsset[];
  /** Null when no usable payment link is set: show the product without a Buy button. */
  offer: UplinkProductOffer | null;
  /** What the Buy button says: the item's button text, or "Buy". */
  button_label: string;
  /** schema.org Product + Offer, for <UplinkJsonLd data={…} /> beside the price. */
  json_ld: Record<string, unknown> | null;
}

const PAYMENT_HOSTS: Record<string, 'stripe' | 'square'> = {
  'buy.stripe.com': 'stripe',
  'donate.stripe.com': 'stripe',
  'square.link': 'square',
  'checkout.square.site': 'square',
};
const AVAILABILITY_LABELS: Record<string, string> = {
  in_stock: 'In stock',
  out_of_stock: 'Out of stock',
  sold_out: 'Sold out',
  preorder: 'Pre-order',
  limited: 'Limited availability',
};
const UNAVAILABLE = ['out_of_stock', 'sold_out'];
const BUTTON_LABEL_MAX = 30;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function asset(value: unknown): UplinkImageAsset | null {
  const raw = record(value);
  if (!raw || typeof raw.id !== 'string' || typeof raw.image_url !== 'string') return null;
  if (typeof raw.mime_type === 'string' && !raw.mime_type.startsWith('image/')) return null;
  return raw as unknown as UplinkImageAsset;
}

function paymentLink(value: unknown): { url: string; provider: 'stripe' | 'square' } | null {
  if (typeof value !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
  const provider = PAYMENT_HOSTS[parsed.hostname.toLowerCase()];
  return provider ? { url: parsed.toString(), provider } : null;
}

function pageLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function offer(value: unknown): UplinkProductOffer | null {
  const raw = record(value);
  // json_ld is there only for an offer Uplink accepted.
  if (!raw || !record(raw.json_ld)) return null;
  const link = paymentLink(raw.url);
  const price = text(raw.price_display, 40);
  if (!link || !price) return null;
  const availability = typeof raw.availability === 'string' && raw.availability in AVAILABILITY_LABELS ? raw.availability : null;
  const billing = raw.billing_period === 'monthly' || raw.billing_period === 'yearly' ? raw.billing_period : null;
  return {
    ...link,
    price_display: price,
    availability,
    availability_label: availability ? AVAILABILITY_LABELS[availability] : null,
    available: !availability || !UNAVAILABLE.includes(availability),
    billing_period: billing,
    page_url: pageLink(raw.page_url),
  };
}

/** One item of a products list from GET /api/v1/content, or null when it is not one. */
export function parseUplinkProduct(value: unknown): UplinkProduct | null {
  const item = record(value);
  const fields = record(item?.fields);
  if (!item || !fields || typeof item.id !== 'string' || typeof item.slug !== 'string') return null;
  const name = text(fields.name, 200) ?? text(item.title, 200);
  if (!name) return null;
  const buy = offer(fields.offer);
  return {
    id: item.id,
    slug: item.slug,
    name,
    description: text(fields.description, 5000) ?? text(record(fields.offer)?.description, 5000),
    image: asset(fields.image),
    gallery: Array.isArray(fields.gallery)
      ? fields.gallery.map(asset).filter((a): a is UplinkImageAsset => a !== null)
      : [],
    offer: buy,
    button_label: text(fields.button_label, BUTTON_LABEL_MAX) ?? 'Buy',
    json_ld: buy ? (record(fields.offer)?.json_ld as Record<string, unknown>) : null,
  };
}

/** The published products of one list, in the order set in Uplink. [] when the list is missing or empty. */
export async function getUplinkProducts(list: string, load: Loader = getUplinkJson): Promise<UplinkProduct[]> {
  let listId: unknown;
  try {
    const body = await load<{ data: unknown }>('/api/v1/content', { searchParams: { slug: list, type: 'list' } });
    listId = record(body.data)?.id;
  } catch (error) {
    if ((error as { kind?: unknown } | null)?.kind === 'not_found') return [];
    throw error;
  }
  if (typeof listId !== 'string') return [];
  const body = await load<{ data: unknown }>('/api/v1/content', { searchParams: { parent_id: listId } });
  const items = Array.isArray(body.data) ? body.data : [];
  return items.map(parseUplinkProduct).filter((p): p is UplinkProduct => p !== null);
}

const STYLE = [
  ':where(.uplink-products){list-style:none;margin:0;padding:0;display:grid;gap:var(--uplink-space-lg,1.5rem);grid-template-columns:repeat(auto-fill,minmax(min(100%,16rem),1fr));color:var(--uplink-color-text,inherit)}',
  ':where(.uplink-product){display:flex;flex-direction:column;min-width:0;background:var(--uplink-color-surface,transparent);border:1px solid var(--uplink-color-border,rgba(127,127,127,.25));border-radius:var(--uplink-radius-lg,.75rem);overflow:hidden}',
  ':where(.uplink-product-media){display:flex;aspect-ratio:4/3;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;background:var(--uplink-color-primary-subtle,rgba(127,127,127,.08))}',
  ':where(.uplink-product-media)::-webkit-scrollbar{display:none}',
  ':where(.uplink-product-photo){position:relative;flex:0 0 100%;height:100%;scroll-snap-align:start}',
  ':where(.uplink-product-media[data-count]:not([data-count="1"]) .uplink-product-photo){flex-basis:88%}',
  ':where(.uplink-product-photo img){object-fit:cover}',
  ':where(.uplink-product-body){display:flex;flex-direction:column;gap:var(--uplink-space-sm,.5rem);padding:var(--uplink-space-md,1rem);flex:1}',
  ':where(.uplink-product-name){margin:0;font-family:var(--uplink-family-h3,inherit);font-size:var(--uplink-text-h4,1.125rem);font-weight:var(--uplink-weight-h3,600);line-height:1.3}',
  ':where(.uplink-product-price){margin:0;display:flex;flex-wrap:wrap;align-items:baseline;gap:.5rem;font-weight:600;font-size:1.0625em}',
  ':where(.uplink-product-availability){font-weight:500;font-size:.8125rem;color:var(--uplink-color-text-muted,inherit)}',
  ':where(.uplink-product-availability[data-available=false]){color:var(--uplink-color-danger,#b91c1c)}',
  ':where(.uplink-product-description){margin:0;color:var(--uplink-color-text-muted,inherit);white-space:pre-line}',
  ':where(.uplink-product-buy){margin-top:auto;align-self:flex-start;display:inline-block;font:inherit;font-weight:600;text-decoration:none;cursor:pointer;background:var(--uplink-color-primary,#111827);color:var(--uplink-color-on-primary,#fff);border-radius:var(--uplink-radius-button,var(--uplink-radius-md,.5rem));padding:.7rem 1.4rem}',
  ':where(a.uplink-product-buy):hover{background:var(--uplink-color-primary-hover,var(--uplink-color-primary,#1f2937))}',
  ':where(a.uplink-product-buy):focus-visible{outline:2px solid var(--uplink-color-primary,#2563eb);outline-offset:2px}',
  ':where(.uplink-product-buy[aria-disabled=true]){background:var(--uplink-color-border,#d4d4d8);color:var(--uplink-color-text-muted,#52525b);cursor:not-allowed}',
].join('');

function Photos({ product, sizes, priority }: { product: UplinkProduct; sizes: string; priority: boolean }) {
  const photos = [product.image, ...product.gallery].filter((a): a is UplinkImageAsset => a !== null);
  if (photos.length === 0) return null;
  return (
    <div className="uplink-product-media" data-count={photos.length}>
      {photos.map((photo, i) => (
        <div key={photo.id + '-' + i} className="uplink-product-photo">
          <UplinkImage
            asset={photo}
            fill
            sizes={sizes}
            priority={priority && i === 0}
            alt={photo.altText ?? photo.alt_text ?? (i === 0 ? product.name : '')}
          />
        </div>
      ))}
    </div>
  );
}

/** @component UplinkProducts */
export default async function UplinkProducts({
  list = 'products',
  load = getUplinkJson,
  sizes = '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 400px',
  headingLevel = 3,
  priority = false,
  className,
  unstyled = false,
  render,
  fallback = null,
}: {
  /** The products list's slug in Uplink, e.g. "products". */
  list?: string;
  load?: Loader;
  /** How wide a card's photo is shown. The default suits the built-in grid. */
  sizes?: string;
  /** The heading level of each product's name. */
  headingLevel?: 2 | 3 | 4;
  /** Set when the grid is the first thing on the page: the first row's photos load first. */
  priority?: boolean;
  className?: string;
  unstyled?: boolean;
  render?: (products: UplinkProduct[]) => ReactNode;
  fallback?: ReactNode;
}) {
  let products: UplinkProduct[];
  try {
    products = await getUplinkProducts(list, load);
  } catch (error) {
    if (isUplinkConfigError(error)) throw error;
    return <>{fallback}</>;
  }
  if (products.length === 0) return <>{fallback}</>;

  if (render) {
    return (
      <>
        {render(products)}
        {products.map((p) => (p.json_ld ? <UplinkJsonLd key={p.id} data={p.json_ld} /> : null))}
      </>
    );
  }

  const Heading = ('h' + headingLevel) as 'h2' | 'h3' | 'h4';
  return (
    <>
      {unstyled ? null : <style href="uplink-products" precedence="low">{STYLE}</style>}
      <ul className={['uplink-products', className].filter(Boolean).join(' ')} data-uplink-products={list}>
        {products.map((product, i) => (
          <li key={product.id} id={product.slug} className="uplink-product">
            <Photos product={product} sizes={sizes} priority={priority && i < 3} />
            <div className="uplink-product-body">
              <Heading className="uplink-product-name">{product.name}</Heading>
              {product.offer ? (
                <p className="uplink-product-price">
                  {product.offer.price_display}
                  {product.offer.availability_label ? (
                    <span className="uplink-product-availability" data-available={product.offer.available}>
                      {product.offer.availability_label}
                    </span>
                  ) : null}
                </p>
              ) : null}
              {product.description ? <p className="uplink-product-description">{product.description}</p> : null}
              {product.offer ? (
                product.offer.available ? (
                  <a className="uplink-product-buy" href={product.offer.url} data-uplink-buy={product.offer.provider}>
                    {product.button_label}
                  </a>
                ) : (
                  <span className="uplink-product-buy" aria-disabled="true">
                    {product.offer.availability_label}
                  </span>
                )
              ) : null}
              {product.json_ld ? <UplinkJsonLd data={product.json_ld} /> : null}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export { UplinkProducts };
