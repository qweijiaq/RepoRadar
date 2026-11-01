import path from 'node:path'
import type { NextConfig } from 'next'

try {
  // 方便直接沿用仓库根目录的 .env（CLI 与 Web 共用）
  process.loadEnvFile('../../.env')
} catch {
  // 根目录 .env 不存在时，使用 apps/web/.env.local 或进程环境变量
}

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR?.trim() || '.next',
  allowedDevOrigins: ['127.0.0.1'],
  // Docker 镜像只在构建时开启 standalone，不影响本地 pnpm build / pnpm start。
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // monorepo 下必须把追踪根目录指到仓库根，standalone 才会带上 workspace 依赖。
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
  transpilePackages: ['@repo-radar/core'],
  serverExternalPackages: ['pg'],
  webpack: (config) => {
    // core 是 NodeNext 源码包，内部 import 使用 .js 后缀；让 webpack 也能解析到 .ts
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    }
    return config
  },
}

export default nextConfig
