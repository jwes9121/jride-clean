/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { appDir: true },
  // no output:"export" here; we want SSR on Vercel
};
module.exports = nextConfig;
