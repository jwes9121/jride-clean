/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // TEMP: no custom headers. This removes the restrictive CSP causing script/style blocks.
  async headers() {
    return [];
  },
};
export default nextConfig;
