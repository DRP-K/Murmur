import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === 'production'

const nextConfig: NextConfig = {
  ...(isProd ? { output: 'export', distDir: 'dist' } : {}),
  allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;
