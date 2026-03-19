import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Cloudflare Pages compatibility settings
  images: {
    // Image optimization configuration
    // To enable Cloudflare Images:
    // 1. Set NEXT_PUBLIC_ENABLE_CLOUDFLARE_IMAGES=true
    // 2. Set NEXT_PUBLIC_CLOUDFLARE_IMAGES_ACCOUNT_HASH=your_account_hash
    // Keep Next.js optimization enabled by default so responsive srcset works
    // for R2/remote images even when Cloudflare Images is disabled.
    unoptimized: process.env.NODE_ENV === 'development',

    // Use custom loader when Cloudflare Images is enabled
    ...(process.env.NEXT_PUBLIC_ENABLE_CLOUDFLARE_IMAGES === 'true' && {
      loader: 'custom',
      loaderFile: './src/lib/cloudflare-image-loader.ts',
    }),

    // Image formats and sizes
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],

    // Remote patterns for image sources
    remotePatterns: [
      // localhost only in development
      ...(process.env.NODE_ENV === 'development' ? [{
        protocol: 'http' as const,
        hostname: 'localhost',
        port: '3000',
        pathname: '/**',
      }] : []),
      {
        protocol: 'https',
        hostname: 'imagedelivery.net', // Cloudflare Images CDN
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.akyodex.com', // R2 fallback
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '**.vrchat.com', // VRChat API fallback
        pathname: '/**',
      },
    ],
    // Next.js 16 compatibility: local patterns for API image proxy
    localPatterns: [
      {
        pathname: '/api/avatar-image',
      },
      {
        pathname: '/api/vrc-world-image',
      },
    ],
  },

  // 301 Redirects (Legacy -> New)
  async redirects() {
    return [
      // index.html (no query) -> /zukan
      {
        source: '/index.html',
        destination: '/zukan',
        permanent: true,
      },
      // index.html?id=XXX -> /zukan?id=XXX
      {
        source: '/index.html',
        has: [
          {
            type: 'query',
            key: 'id',
            value: '(?<id>[0-9A-Za-z]+)',
          },
        ],
        destination: '/zukan?id=:id',
        permanent: true,
      },
      // Legacy share.html -> /zukan
      {
        source: '/share.html',
        destination: '/zukan',
        permanent: true,
      },
      // Legacy /share -> /zukan
      {
        source: '/share',
        destination: '/zukan',
        permanent: true,
      },
    ];
  },

  // Security Headers
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          },
        ],
      },
      {
        source: '/_next/image',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000',
          },
        ],
      },
      // Static image assets (local files in /public/images/)
      {
        source: '/images/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=2592000, s-maxage=2592000, immutable',
          },
        ],
      },
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },

  // Environment variable validation
  env: {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || 'https://akyodex.com',
    NEXT_PUBLIC_R2_BASE: process.env.NEXT_PUBLIC_R2_BASE || 'https://images.akyodex.com',
  },

  // React strict mode
  reactStrictMode: true,

  // Optimization
  poweredByHeader: false,
  compress: true,

  // Next.js 16 features

};

const hasSentryBuildConfig = Boolean(
  process.env.SENTRY_ORG && process.env.SENTRY_PROJECT && process.env.SENTRY_AUTH_TOKEN
);

const sentryWrappedConfig = hasSentryBuildConfig
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      ...(process.env.NODE_ENV === 'production'
        ? {
            bundleSizeOptimizations: {
              excludeDebugStatements: true,
            },
          }
        : {}),
    })
  : nextConfig;

export default sentryWrappedConfig;
