import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  cacheComponents: true,
  turbopack: {},
  async headers() {
    return [
      {
        source: '/:path*{/}?',
        headers: [
          {
            key: 'X-Accel-Buffering',
            value: 'no',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
