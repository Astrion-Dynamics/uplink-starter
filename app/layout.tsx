import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { faviconHref, getBusinessInfo } from '@/lib/site';
import { getUplinkJson } from '@/lib/uplink-backup';
import UplinkIntegrations from '@/lib/uplink-integrations';
import UplinkTheme from '@/lib/uplink-theme';
import './globals.css';

// Each page's title, description and share card come from uplinkMetadata()
// (Uplink → Workspace → Search & sharing); the favicon from Business Info.
export async function generateMetadata(): Promise<Metadata> {
  const business = await getBusinessInfo();
  const icon = business?.favicon ? faviconHref(business.favicon) : null;
  return icon ? { icons: { icon } } : {};
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <UplinkTheme base load={getUplinkJson} />
      </head>
      <body className="bg-background font-body text-text antialiased">
        {children}
        <UplinkIntegrations load={getUplinkJson} />
      </body>
    </html>
  );
}
