'use client';

import Image, { type ImageProps } from 'next/image';

/**
 * lib/uplink-image.tsx — written by the Uplink installer.
 *
 * The standard way to show an image from Uplink. It does what a fast page on
 * a phone needs, so no component has to remember it:
 *
 *   1. Sized for the screen. Every srcset entry is a real file close to that
 *      width (Uplink's next step up, AVIF or WebP as the browser allows), so a
 *      phone showing a photo 200 px wide downloads a ~640 px file, not the
 *      2000 px copy a desktop hero needs. sizes is required: it tells the
 *      browser how wide the image is shown, and a wrong guess is the main cost.
 *   2. Served by this site. Uplink image URLs are rewritten to /api/media/{id}
 *      (app/api/media/[id]/route.ts), which this site's CDN caches.
 *   3. A blurred preview in its exact space, from blur_data_url.
 *
 * Pass priority to the image a page opens on (the hero, the first row of a
 * grid); everything else loads lazily as it scrolls into view.
 *
 * Never render a media field's url: it is a signed link to the uploaded
 * original — often a 5–10 MB phone photo. This component ignores it.
 */

/** A media field, or an item of GET /api/v1/media. */
export interface UplinkImageAsset {
  id: string;
  /** A media field's image URL. */
  image_url?: string | null;
  /** GET /api/v1/media's image URL (a media field's url is ignored — see above). */
  url?: string | null;
  width?: number | null;
  height?: number | null;
  mime_type?: string | null;
  /** The alt text chosen for this field; wins over the asset's own. */
  altText?: string | null;
  alt_text?: string | null;
  blur_data_url?: string | null;
}

const UPLINK_IMAGE_PATH = /\/api\/v1\/media\/([0-9a-f-]{36})\/image$/i;
const BACKUP_PREFIX = '/uplink-backup/';
const PROXY_PREFIX = '/api/media/';

/**
 * Where this site loads an asset from: its backed-up static copy when the
 * backup holds this version (lib/uplink-backup.ts sets that), otherwise this
 * site's proxy. Null when the asset has nothing that may be shown (a draft,
 * or a private image — which only a route that checks sign-in may serve).
 */
export function uplinkImageSrc(asset: UplinkImageAsset): string | null {
  for (const candidate of [asset.image_url, asset.url]) {
    if (!candidate) continue;
    if (candidate.startsWith(BACKUP_PREFIX)) return candidate;
    let parsed: URL;
    try {
      parsed = new URL(candidate, 'http://site.invalid');
    } catch {
      continue;
    }
    const match = UPLINK_IMAGE_PATH.exec(parsed.pathname);
    if (match && parsed.searchParams.has('v')) return PROXY_PREFIX + match[1] + parsed.search;
  }
  return null;
}

/**
 * next/image loader: turns each srcset width into a file of that width.
 * Uplink resizes proxy URLs; a backed-up static file goes through Next.js's
 * own optimizer like any file in public/ (keep images.unoptimized off).
 */
export function uplinkImageLoader({ src, width, quality }: { src: string; width: number; quality?: number }): string {
  if (src.startsWith(PROXY_PREFIX)) {
    // The editor chose "Serve original": the same bytes at every width.
    if (src.includes('original=1')) return src;
    return src + '&w=' + width + '&q=' + (quality ?? 75);
  }
  return '/_next/image?url=' + encodeURIComponent(src) + '&w=' + width + '&q=75';
}

/** SVG would be rasterized and GIF would stop moving: sent as uploaded. */
const SENT_AS_UPLOADED = /^image\/(svg\+xml|gif)$/;

export type UplinkImageProps = Omit<ImageProps, 'src' | 'alt' | 'loader' | 'placeholder' | 'blurDataURL' | 'sizes'> & {
  asset: UplinkImageAsset;
  /**
   * How wide the image is shown, e.g. "(max-width: 768px) 50vw, 320px" for a
   * two-column grid on phones. It decides which file each screen downloads.
   */
  sizes: string;
  alt?: string;
};

export function UplinkImage({ asset, sizes, alt, fill, width, height, unoptimized, ...rest }: UplinkImageProps) {
  const src = uplinkImageSrc(asset);
  if (!src) return null;

  const w = width ?? asset.width ?? undefined;
  const h = height ?? asset.height ?? undefined;
  // Without both dimensions the image fills its (sized, position: relative) parent.
  const box = !fill && w && h ? { width: w, height: h } : { fill: true };

  return (
    <Image
      {...rest}
      {...box}
      src={src}
      alt={alt ?? asset.altText ?? asset.alt_text ?? ''}
      sizes={sizes}
      loader={uplinkImageLoader}
      unoptimized={unoptimized || SENT_AS_UPLOADED.test(asset.mime_type ?? '')}
      placeholder={asset.blur_data_url ? 'blur' : 'empty'}
      blurDataURL={asset.blur_data_url ?? undefined}
      // Lets Uplink's site check see the image came through here (the Uplink Score).
      data-uplink-image={asset.id}
    />
  );
}
