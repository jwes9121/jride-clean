/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow Google profile photos for <Image />
  images: {
    domains: ["lh3.googleusercontent.com"],
  },

  // Keep rendering dynamic to avoid any redirect-cache loops
  reactStrictMode: true,
  output: "standalone",
  cacheHandler: false,
  experimental: {
    staleTimes: { dynamic: 0 },
  },

  // Send no-store headers by default (safe while we stabilize)
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
    ];
  },
};

export default nextConfig;
