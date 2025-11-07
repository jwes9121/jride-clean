/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Stop Next from passing deprecated ESLint options during build
  eslint: { ignoreDuringBuilds: true },

  // If you previously had experimental.appdir or appdir, delete it.
  // Next 14 already uses the app router by default.
};

export default nextConfig;
