/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Security headers for all routes
  async headers() {
    const csp = [
      // NO 'unsafe-eval' needed when using the CSP build
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      // scripts restricted to self + allow web workers via blob for Mapbox worker
      "script-src 'self'",
      // Mapbox GL worker uses blob: URL
      "worker-src 'self' blob:",
      // style needs inline because Mapbox injects runtime styles (or you can prehost fonts/styles yourself)
      "style-src 'self' 'unsafe-inline'",
      // images can come from data/blob and mapbox/tiles domains
      "img-src 'self' data: blob: https://*",
      // fonts can be data: if you inline or host, keep 'self'
      "font-src 'self' data:",
      // XHR/WebSocket endpoints Mapbox uses
      "connect-src 'self' https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com https://*.mapbox.com",
      // child-src deprecated in favor of worker-src but keep for older browsers
      "child-src 'self' blob:",
      // frame-ancestors to avoid clickjacking
      "frame-ancestors 'self'"
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-XSS-Protection', value: '0' },
          { key: 'Permissions-Policy', value: 'geolocation=(self), microphone=(), camera=()' }
        ],
      },
    ];
  },
};

export default nextConfig;
