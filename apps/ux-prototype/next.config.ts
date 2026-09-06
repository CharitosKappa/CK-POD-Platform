import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins: ['localhost', '127.0.0.1', '192.168.68.56'],
  reactStrictMode: true,
};

export default nextConfig;
