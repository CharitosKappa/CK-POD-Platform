import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins: ['192.168.68.56'],
  reactStrictMode: true,
};

export default nextConfig;
