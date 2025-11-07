/** @type {import("next").NextConfig} */

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self';",
      // Allow Next, Mapbox, Supabase, and inline scripts Mapbox needs
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://api.mapbox.com https://*.tiles.mapbox.com https://events.mapbox.com;",
      "style-src 'self' 'unsafe-inline' https://api.mapbox.com https://fonts.googleapis.com;",
      "img-src 'self' data: blob: https://api.mapbox.com https://*.tiles.mapbox.com https://events.mapbox.com;",
      "font-src 'self' data: https://fonts.gstatic.com;",
      "connect-src 'self' https://api.mapbox.com https://*.tiles.mapbox.com https://events.mapbox.com https://*.supabase.co wss://*.supabase.co;",
      "worker-src 'self' blob:;",
      "object-src 'none';",
      "base-uri 'self';",
      "frame-ancestors 'self';",
      "form-action 'self';"
    ].join(" ")
  }
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders
      }
    ];
  }
};

export default nextConfig;