/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      { source: "/auth/callback", destination: "/auth/callback-info", permanent: true },
    ];
  },
};
module.exports = nextConfig;
