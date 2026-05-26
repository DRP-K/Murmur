import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  distDir: 'dist',
  allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;
