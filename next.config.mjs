/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    // Relaxed enough for Next.js inline scripts + Mapbox worker/tiles.
    // Tighten later with nonces/hashes if you want.
    const csp = [
      "default-src 'self'",
      // Next uses some inline bootstrap scripts; allow them
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      // Styles (Next + Mapbox CSS)
      "style-src 'self' 'unsafe-inline' https://api.mapbox.com",
      // Workers (Mapbox)
      "worker-src 'self' blob:",
      // Images (tiles may be data/blob)
      "img-src 'self' data: blob: https://api.mapbox.com https://*.tiles.mapbox.com",
      // Fonts (Mapbox fonts)
      "font-src 'self' data: https://api.mapbox.com",
      // XHR/fetch to Mapbox APIs
      "connect-src 'self' https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com",
      // Media fallbacks
      "media-src 'self' data: blob:",
      // Base
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
