import type { MetadataRoute } from 'next';
import { uplinkRobots } from '../lib/uplink-seo';

// app/robots.ts — written by the Uplink installer. Uplink's rules, including
// the "Let AI tools read this site" switch in Uplink → Search & sharing.
export default async function robots(): Promise<MetadataRoute.Robots> {
  return uplinkRobots({ rules: [{ userAgent: '*', allow: '/', disallow: '/uplink' }] });
}
