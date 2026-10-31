import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RepoRadar',
    short_name: 'Radar',
    description: '懂你口味的开源项目雷达',
    start_url: '/feed',
    display: 'standalone',
    background_color: '#f5f7fb',
    theme_color: '#2563eb',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  }
}
