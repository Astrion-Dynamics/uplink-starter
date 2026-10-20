import type { NextConfig } from 'next';

// Images from Uplink go through this site's own /api/media route and
// <UplinkImage> (lib/uplink-image.tsx), so no remote image hosts are needed.
// Keep next/image's optimizer on: backed-up images rely on it.
const nextConfig: NextConfig = {};

export default nextConfig;
