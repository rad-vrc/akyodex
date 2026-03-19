import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'Akyoずかん - VRChat Avatar Encyclopedia',
        short_name: 'Akyoずかん',
        description: 'VRChatに潜むなぞ生物アバター「Akyo」を700体以上、そしてAkyo要素のあるワールドを50種類以上収録したAkyoコンテンツの図鑑サイト',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#667eea',
        icons: [
            {
                src: '/images/akyodexIcon-16.png',
                sizes: '16x16',
                type: 'image/png',
            },
            {
                src: '/images/akyodexIcon-32.png',
                sizes: '32x32',
                type: 'image/png',
            },
            {
                src: '/images/akyodexIcon-48.png',
                sizes: '48x48',
                type: 'image/png',
            },
            {
                src: '/images/akyodexIcon-192.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'maskable',
            },
            {
                src: '/images/akyodexIcon-512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable',
            },
            {
                src: '/images/apple-touch-icon-180.png',
                sizes: '180x180',
                type: 'image/png',
            },
        ],
        categories: ['entertainment', 'social'],
        lang: 'ja-JP',
        dir: 'ltr',
        orientation: 'portrait-primary',
    }
}
