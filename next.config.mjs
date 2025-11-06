/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { appDir: true },
  // keep SSR (no output:"export")
};
export default nextConfig;
