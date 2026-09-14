import { networkInterfaces } from 'node:os';
import type { NextConfig } from 'next';

import { getAllowedDevelopmentOrigins } from './lib/dev-origins';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  // Next uses this only in development. Deriving the active LAN addresses keeps
  // physical-device previews working when the machine receives a new DHCP address.
  allowedDevOrigins: getAllowedDevelopmentOrigins(networkInterfaces()),
  transpilePackages: ['@let-it-be/observability', '@let-it-be/editor-schema'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy-Report-Only',
            value:
              "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; connect-src 'self';",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
