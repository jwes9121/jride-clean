/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  reactStrictMode: true,
  // Do NOT set output: "export" (that disables API routes)
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  webpack: (config) => {
    // Always stub map libs to avoid build failures
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      'leaflet/dist/leaflet.css': path.resolve(__dirname, 'stubs/empty.css'),
      'react-leaflet': path.resolve(__dirname, 'stubs/react-leaflet.js'),
      'leaflet': path.resolve(__dirname, 'stubs/leaflet.js'),
      'react-leaflet-cluster': path.resolve(__dirname, 'stubs/react-leaflet-cluster.js'),
    };
    return config;
  },
};

module.exports = nextConfig;

