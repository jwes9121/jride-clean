/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    const csp = [
      "default-src '\''self'\''",
      "base-uri '\''self'\''",
      "form-action '\''self'\''",
      "script-src '\''self'\''",
      "worker-src '\''self'\'' blob:",
      "style-src '\''self'\'' '\''unsafe-inline'\'' blob:",   // <- allow blob: styles too
      "img-src '\''self'\'' data: blob: https://*",
      "font-src '\''self'\'' data:",
      "connect-src '\''self'\'' https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com https://*.mapbox.com",
      "child-src '\''self'\'' blob:",
      "frame-ancestors '\''self'\''"
    ].join("; ");
    return [
      { source: "/:path*", headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "X-XSS-Protection", value: "0" },
        { key: "Permissions-Policy", value: "geolocation=(self), microphone=(), camera=()" }
      ]},
    ];
  },
};
export default nextConfig;
