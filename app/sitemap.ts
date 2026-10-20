import type { MetadataRoute } from 'next';
import { uplinkSitemap } from '../lib/uplink-seo';

// app/sitemap.ts — written by the Uplink installer. Every page, blog post and
// legal page in Uplink → Search & sharing; pages hidden from search are left
// out. Add any of the site's own entries to the fallback, used when Uplink
// can't be reached.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return uplinkSitemap([]);
}
