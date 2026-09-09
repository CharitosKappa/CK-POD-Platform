import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  // Explicitly allow the current local-network host to load Next dev assets on a phone.
  // This is used only by `next dev`; deployed production hosts are unaffected.
  allowedDevOrigins: ['127.0.0.1', 'localhost', '192.168.1.122'],
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
        ],
      },
    ];
  },
};

export default nextConfig;
