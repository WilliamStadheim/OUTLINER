import type { NextConfig } from 'next';

// In development the Python API runs on :8000 (npm run api). On Vercel, /api/* is served by the
// Python function in api/index.py. LOCAL_API=1 points a production build (next build/start) at the
// local API too, for testing the built app on this machine.
const localApi = process.env.NODE_ENV === 'development' || process.env.LOCAL_API === '1';

const nextConfig: NextConfig = {
  devIndicators: false, // the badge sits on top of the download button
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
