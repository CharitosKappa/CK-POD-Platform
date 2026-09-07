import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins: ['localhost', '127.0.0.1', '192.168.1.122'],
  reactStrictMode: true,
};

export default nextConfig;
