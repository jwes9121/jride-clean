/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { domains: ["lh3.googleusercontent.com"] },
  reactStrictMode: true,
  output: "standalone",
  cacheHandler: false,
  experimental: { staleTimes: { dynamic: 0 } },

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

  async redirects() {
    return [
      { source: "/dashboard", destination: "/dash", permanent: false },
    ];
  },
};

export default nextConfig;
