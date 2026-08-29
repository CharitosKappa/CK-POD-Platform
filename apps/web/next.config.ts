import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  transpilePackages: ['@let-it-be/observability', '@let-it-be/editor-schema'],
};

export default nextConfig;
