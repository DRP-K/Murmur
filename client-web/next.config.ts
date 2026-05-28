import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === 'production'
const distDir = process.env.NEXT_DIST_DIR ?? 'dist'

const nextConfig: NextConfig = {
  ...(isProd ? { output: 'export', distDir } : {}),
  allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;
