'use client';

import Image, { type ImageProps } from 'next/image';
import { useEffect, useState, type CSSProperties, type VideoHTMLAttributes } from 'react';

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
 * grid); everything else loads lazily as it scrolls into view. priority also
 * sets fetchpriority="high": next/image's priority alone only preloads it.
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
    // The editor chose "Serve original": the same bytes at every width. A
    // video's poster is a still Uplink made, so it is sized all the same.
    if (src.includes('original=1') && !src.includes('poster=1')) return src;
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

export function UplinkImage({ asset, sizes, alt, fill, width, height, unoptimized, fetchPriority, ...rest }: UplinkImageProps) {
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
      fetchPriority={fetchPriority ?? (rest.priority ? 'high' : undefined)}
      // Lets Uplink's site check see the image came through here (the Uplink Score).
      data-uplink-image={asset.id}
    />
  );
}

/** A video media field: an image asset's keys plus the video's own copies. */
export interface UplinkVideoAsset extends UplinkImageAsset {
  /** The poster still Uplink takes from the video (versioned URL with &poster=1). */
  poster_url?: string | null;
  /** The phone copy (720p), or null when there is none. */
  mobile_url?: string | null;
  /** The desktop copy (1080p), or null when there is none. */
  desktop_url?: string | null;
}

export type UplinkVideoProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, 'src' | 'poster' | 'children'> & {
  asset: UplinkVideoAsset;
  /**
   * How wide the video is shown, e.g. "100vw" for a full-width hero. It picks
   * the poster file each screen downloads, exactly like UplinkImage's sizes.
   */
  sizes: string;
  /** The video the page opens on (a hero): its poster loads first, never lazily. */
  priority?: boolean;
};

/** Fills the positioned parent, cropped to cover it. */
const FILL: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' };

/**
 * Calls start once the page has loaded and the browser is idle. Returns the
 * cleanup for useEffect.
 */
function afterPageLoad(start: () => void): () => void {
  let idle = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (typeof requestIdleCallback === 'function') idle = requestIdleCallback(start, { timeout: 2000 });
    else timer = setTimeout(start, 200);
  };
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
  return () => {
    window.removeEventListener('load', schedule);
    if (idle) cancelIdleCallback(idle);
    if (timer) clearTimeout(timer);
  };
}

/**
 * A background or hero video from Uplink. It fills its parent, which must be
 * positioned (relative or absolute) and sized, and crops to cover it.
 *
 *   1. The poster is a sized image, not <video poster>: a poster attribute
 *      has no srcset, so every phone downloaded the full 1920 px still. Here
 *      it is an image with a srcset of Uplink's poster copies, under the
 *      video, with its blurred preview; the video covers it once it plays.
 *   2. Phones get the 720p copy, everyone else the 1080p copy, and the
 *      original is the last resort (a copy that fails falls through to it).
 *   3. Muted, looping, inline and autoplaying by default, and hidden from
 *      screen readers unless given an aria-label: a loop that only sets a
 *      mood is decoration. Pass any of these props to change them.
 *   4. The video starts once the page has loaded; until then the poster
 *      shows. A hero video is megabytes the page does not need to open: an
 *      autoplaying one started at once competes with the page for the
 *      network, and Lighthouse, which stops at load, logs the cut-off download
 *      as a console error. A video without a poster starts at once.
 *
 * className and style go on both the poster and the video, e.g. "-z-10".
 */
export function UplinkVideo({ asset, sizes, priority, className, style, ...rest }: UplinkVideoProps) {
  const src = uplinkImageSrc(asset);
  const poster = asset.poster_url ? uplinkImageSrc({ id: asset.id, image_url: asset.poster_url }) : null;
  const [started, setStarted] = useState(!poster);
  useEffect(() => (started ? undefined : afterPageLoad(() => setStarted(true))), [started]);
  if (!src) return null;
  // Copies exist only behind this site's proxy; a backed-up file is the original alone.
  const proxied = src.startsWith(PROXY_PREFIX);
  const fill = { ...FILL, ...style };

  return (
    <>
      {poster && (
        <Image
          src={poster}
          alt=""
          aria-hidden
          fill
          sizes={sizes}
          loader={uplinkImageLoader}
          priority={priority}
          fetchPriority={priority ? 'high' : undefined}
          placeholder={asset.blur_data_url ? 'blur' : 'empty'}
          blurDataURL={asset.blur_data_url ?? undefined}
          className={className}
          style={fill}
          data-uplink-image={asset.id}
        />
      )}
      {started && (
        <video
          autoPlay
          muted
          loop
          playsInline
          preload={priority ? 'auto' : 'metadata'}
          aria-hidden={rest['aria-label'] ? undefined : true}
          {...rest}
          className={className}
          style={fill}
        >
          {proxied && asset.mobile_url && <source media="(max-width: 767px)" src={src + '&w=1280'} type="video/mp4" />}
          {proxied && asset.desktop_url && <source src={src + '&w=1920'} type="video/mp4" />}
          <source src={src} type={asset.mime_type ?? undefined} />
        </video>
      )}
    </>
  );
}
