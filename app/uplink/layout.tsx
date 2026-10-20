import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Uplink',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      'max-image-preview': 'none',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
};

interface UplinkLayoutProps {
  children: React.ReactNode;
}

/** @component UplinkLayout */
export default function UplinkLayout({ children }: UplinkLayoutProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100dvh',
        overflow: 'hidden',
        background: '#050505',
        zIndex: 2147483647,
      }}
    >
      {children}
    </div>
  );
}
