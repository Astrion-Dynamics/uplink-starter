import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import UplinkAnnouncement from '@/lib/uplink-announcement';
import { getUplinkJson } from '@/lib/uplink-backup';

// Every visitor-facing page lives in this (site) group, so the header and
// footer wrap them and not the /uplink studio page. The announcement bar
// (Uplink → Workspace → Announcements) comes first, above the header, and
// renders nothing until one is switched on.
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <UplinkAnnouncement load={getUplinkJson} />
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </>
  );
}
