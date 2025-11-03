/** @type {import('next').NextConfig} */
const dev = process.env.NODE_ENV !== "production";

const scriptSrc = [
  "'self'",
  "'unsafe-inline'",
  "blob:",
  "https://cdn.vercel-insights.com",
  "https://api.mapbox.com",
  "https://events.mapbox.com",
];
const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc.join(" ")}`,
  "style-src 'self' 'unsafe-inline' https://api.mapbox.com",
  "img-src 'self' data: blob: https://api.mapbox.com",
  "connect-src 'self' https://api.mapbox.com https://events.mapbox.com",
  "worker-src 'self' blob:",
  "font-src 'self' data:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig = {
  reactStrictMode: true,
  webpack(config, { dev }) {
    if (dev) {
      // Avoid eval in dev so CSP can be strict
      config.devtool = "source-map";
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [{ key: "Content-Security-Policy", value: csp }],
      },
    ];
  },
};
export default nextConfig;