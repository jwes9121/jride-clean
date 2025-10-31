/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    const csp = [
      "default-src 'self'",
      // Next uses inline bootstrap + sometimes eval in dev/bundles
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      // Styles for Next + Mapbox CDN CSS
      "style-src 'self' 'unsafe-inline' https://api.mapbox.com",
      // Workers (Mapbox needs blob worker)
      "worker-src 'self' blob:",
      // Images (map tiles and sprites can be data/blob)
      "img-src 'self' data: blob: https://api.mapbox.com https://*.tiles.mapbox.com",
      // Fonts (Mapbox fonts)
      "font-src 'self' data: https://api.mapbox.com",
      // XHR/fetch/websocket: Supabase + Mapbox
      "connect-src 'self' " +
        "https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com " +
        "https://*.supabase.co wss://*.supabase.co " +
        "https://*.supabase.in wss://*.supabase.in",
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
