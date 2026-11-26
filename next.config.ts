import type { NextConfig } from 'next';

// In development the Python API runs on :8000 (npm run api). On Vercel, /api/* is served by the
// Python function in api/index.py. LOCAL_API=1 points a production build (next build/start) at the
// local API too, for testing the built app on this machine.
const localApi = process.env.NODE_ENV === 'development' || process.env.LOCAL_API === '1';

const nextConfig: NextConfig = {
  devIndicators: false, // the badge sits on top of the download button
  // Locally one Python process does all the geometry, so a request can wait behind another's; wait as
  // long as Vercel would (maxDuration 300 s) instead of failing after the proxy's default 30 s.
  experimental: { proxyTimeout: 300_000 },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: localApi ? 'http://127.0.0.1:8000/api/:path*' : '/api/',
      },
    ];
  },
};

export default nextConfig;
