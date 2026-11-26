import 'server-only';
import type { ReactNode } from 'react';
import { getUplinkJson } from './uplink';

/**
 * lib/uplink-reviews.tsx — written by the Uplink installer.
 *
 * What customers said, from Uplink → Workspace → Reviews, on any page:
 *
 *   import UplinkReviews from '@/lib/uplink-reviews';
 *   <UplinkReviews />                    // every approved review, featured first
 *   <UplinkReviews featured limit={3} /> // the three featured ones, e.g. on the home page
 *
 * Only reviews a person approved in Uplink are shown. It renders their stars,
 * words, name and date, plus the schema.org Review and AggregateRating JSON-LD
 * for exactly the reviews on the page, so search engines and AI tools read
 * them. Never write reviews or their JSON-LD into site code: add them in
 * Uplink (or with the connector's set_review) and they reach the site without
 * a deploy (the fetch is tagged uplink:reviews, which Uplink's webhook
 * revalidates).
 *
 * It matches the site's Uplink theme through the --uplink-* variables
 * <UplinkTheme /> renders. Pass className to place it, or unstyled to style
 * .uplink-reviews yourself. With no approved reviews, or if Uplink can't be
 * reached, `fallback` renders instead (nothing by default).
 *
 * To build your own layout, read the same data with getUplinkReviews() and
 * render <UplinkJsonLd data={reviews.json_ld} /> from lib/uplink-seo beside it.
 */

type Loader = <T>(pathname: string) => Promise<T>;

export interface UplinkReview {
  id: string;
  author_name: string;
  rating: number | null;
  title: string | null;
  body: string;
  reviewed_on: string | null;
  source_label: string;
  source_url: string | null;
  featured: boolean;
}

export interface UplinkReviews {
  reviews: UplinkReview[];
  summary: { count: number; rated_count: number; average: number | null };
  json_ld: Record<string, unknown> | null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

/** The approved reviews from GET /api/v1/reviews, or null when Uplink can't be reached. */
export async function getUplinkReviews(
  { featured = false, limit, load = getUplinkJson }: { featured?: boolean; limit?: number; load?: Loader } = {},
): Promise<UplinkReviews | null> {
  const query = new URLSearchParams();
  if (featured) query.set('featured', 'true');
  if (limit) query.set('limit', String(limit));
  const qs = query.toString();
  try {
    const body = await load<{ data?: unknown; summary?: unknown; json_ld?: unknown }>('/api/v1/reviews' + (qs ? '?' + qs : ''));
    const reviews: UplinkReview[] = [];
    for (const item of Array.isArray(body.data) ? body.data : []) {
      if (typeof item !== 'object' || item === null) continue;
      const r = item as Record<string, unknown>;
      const author = text(r.author_name, 80);
      const words = text(r.body, 2000);
      if (typeof r.id !== 'string' || !author || !words) continue;
      const rating = typeof r.rating === 'number' && r.rating >= 1 && r.rating <= 5 ? Math.round(r.rating) : null;
      const url = text(r.source_url, 500);
      reviews.push({
        id: r.id,
        author_name: author,
        rating,
        title: text(r.title, 120),
        body: words,
        reviewed_on: text(r.reviewed_on, 10),
        source_label: text(r.source_label, 40) ?? '',
        source_url: url && url.startsWith('https://') ? url : null,
        featured: r.featured === true,
      });
    }
    const s = (body.summary ?? {}) as Record<string, unknown>;
    return {
      reviews,
      summary: {
        count: typeof s.count === 'number' ? s.count : reviews.length,
        rated_count: typeof s.rated_count === 'number' ? s.rated_count : 0,
        average: typeof s.average === 'number' ? s.average : null,
      },
      json_ld: body.json_ld && typeof body.json_ld === 'object' ? (body.json_ld as Record<string, unknown>) : null,
    };
  } catch {
    return null;
  }
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const CSS = `
:where(.uplink-reviews){display:grid;gap:var(--uplink-space-md,1rem);grid-template-columns:repeat(auto-fill,minmax(min(100%,18rem),1fr));color:var(--uplink-color-text,inherit);font:inherit}
:where(.uplink-review){margin:0;display:flex;flex-direction:column;gap:.75rem;padding:var(--uplink-space-md,1.25rem);background:var(--uplink-color-surface,transparent);border:1px solid var(--uplink-color-border,#e4e4e7);border-radius:var(--uplink-radius-lg,var(--uplink-radius-md,.75rem))}
:where(.uplink-review-stars){display:flex;gap:.125rem;color:var(--uplink-color-accent,var(--uplink-color-primary,#f59e0b))}
:where(.uplink-review-stars svg){width:1.1em;height:1.1em}
:where(.uplink-review-title){margin:0;font-weight:600}
:where(.uplink-review blockquote){margin:0;white-space:pre-line;line-height:1.55}
:where(.uplink-review figcaption){margin-top:auto;font-size:.9375em;color:var(--uplink-color-text-muted,currentColor)}
:where(.uplink-review figcaption a){color:inherit}
`;

function Stars({ rating }: { rating: number }) {
  return (
    <div className="uplink-review-stars" role="img" aria-label={rating + ' out of 5 stars'}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} viewBox="0 0 20 20" aria-hidden="true">
          <path
            fill={n <= rating ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.4"
            d="M10 1.8l2.5 5.2 5.7.8-4.1 4 1 5.6L10 14.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8z"
          />
        </svg>
      ))}
    </div>
  );
}

function formatDate(day: string): string {
  const date = new Date(day + 'T12:00:00Z');
  return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** @component UplinkReviews */
export default async function UplinkReviews({
  featured = false,
  limit,
  load = getUplinkJson,
  className,
  unstyled = false,
  fallback = null,
}: {
  /** Only the reviews featured in Uplink. */
  featured?: boolean;
  /** At most this many (1–100). */
  limit?: number;
  load?: Loader;
  className?: string;
  unstyled?: boolean;
  fallback?: ReactNode;
}) {
  const data = await getUplinkReviews({ featured, limit, load });
  if (!data || data.reviews.length === 0) return <>{fallback}</>;
  return (
    <>
      {unstyled ? null : (
        <style href="uplink-reviews" precedence="low">
          {CSS}
        </style>
      )}
      <div className={['uplink-reviews', className].filter(Boolean).join(' ')} data-uplink-reviews="">
        {data.reviews.map((review) => (
          <figure key={review.id} className="uplink-review">
            {review.rating ? <Stars rating={review.rating} /> : null}
            {review.title ? <p className="uplink-review-title">{review.title}</p> : null}
            <blockquote>{review.body}</blockquote>
            <figcaption>
              <strong>{review.author_name}</strong>
              {review.reviewed_on ? <> · <time dateTime={review.reviewed_on}>{formatDate(review.reviewed_on)}</time></> : null}
              {review.source_label && review.source_url ? (
                <> · <a href={review.source_url} target="_blank" rel="noopener noreferrer">{review.source_label}</a></>
              ) : null}
            </figcaption>
          </figure>
        ))}
      </div>
      {data.json_ld ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: scriptJson(data.json_ld) }} /> : null}
    </>
  );
}

export { UplinkReviews };
