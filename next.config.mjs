/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    // Allow Mapbox worker and requests
    const csp = [
      "default-src 'self'",
      // allow styles (Next inlines styles, Mapbox CSS)
      "style-src 'self' 'unsafe-inline' https://api.mapbox.com",
      // scripts from self
      "script-src 'self'",
      // worker for mapbox (blob worker)
      "worker-src 'self' blob:",
      // images (map tiles can be data/blob)
      "img-src 'self' data: blob: https://api.mapbox.com https://*.tiles.mapbox.com",
      // fonts (Mapbox fonts)
      "font-src 'self' data: https://api.mapbox.com",
      // connections to Mapbox APIs
      "connect-src 'self' https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com",
      // media fallback
      "media-src 'self' data: blob:",
      // base
      "base-uri 'self'"
    ].join('; ');
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "geolocation=(self)" }
        ]
      }
    ];
  }
};
export default nextConfig;
