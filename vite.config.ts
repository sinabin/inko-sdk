import { defineConfig, loadEnv, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'

/**
 * Production 빌드 시 index.html에 CSP meta 태그 주입
 * - dev 모드는 미적용 (HMR·inline script 깨짐 방지)
 * - frame-ancestors는 meta에서 무시되므로 호스트 서버·리버스프록시의 HTTP 헤더로 별도 설정 필요
 * - style-src 'unsafe-inline'은 Svelte 컴포넌트의 동적 style="..." 바인딩 호환을 위해 유지
 */
function cspInjectionPlugin(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "img-src 'self' blob: data:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    // exportPdf()/exportFlattenedPdf() 바이트를 Blob URL로 다시 여는 SDK 계약과 일치
    "connect-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'"
  ].join('; ')

  return {
    name: 'pdfv-csp-injection',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`
      )
    }
  }
}

/** 공개 릴리스 산출물에 특정 배포 호스트 origin이 굽히는 것을 차단 */
export function assertPublicReleaseOriginPolicy(
  publicReleaseFlag: string | undefined,
  allowedOrigins: string | undefined
): void {
  const isPublicRelease = ['1', 'true'].includes((publicReleaseFlag ?? '').trim().toLowerCase())
  if (isPublicRelease && (allowedOrigins ?? '').trim()) {
    throw new Error(
      'Public release builds require VITE_ALLOWED_ORIGINS to be empty; use a private host build for deployment-specific origins.'
    )
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  assertPublicReleaseOriginPolicy(env.INKO_PUBLIC_RELEASE, env.VITE_ALLOWED_ORIGINS)

  return {
    plugins: [svelte(), cspInjectionPlugin()],
    base: './',

    resolve: {
      alias: {
        '$lib': resolve(__dirname, './src/lib')
      }
    },

    // production 빌드에서 디버그 로그 제거 (정보 누설 방지·번들 축소)
    // console.error/warn은 보존 — errorReporter 채널과 함께 디버깅 단서 유지
    esbuild: mode === 'production'
      ? { pure: ['console.log', 'console.debug', 'console.info', 'console.trace'] }
      : {},

    build: {
      target: 'es2020',
      outDir: 'dist',
      // 공개 산출물에 내부 어댑터·소스 원문이 포함되지 않도록 source map 비활성화
      sourcemap: false,
      rollupOptions: {
        external: [
          /^tests\//,
          /\.test\.ts$/,
          /\.spec\.ts$/
        ],
        output: {
          manualChunks: {
            'pdfjs': ['pdfjs-dist'],
            'paper': ['paper'],
            'pdf-lib': ['pdf-lib']
          }
        }
      }
    },

    server: {
      port: 5173,
      strictPort: false,
      open: true,
      // Playwright trace/report 기록이 dev viewer를 HMR reload하지 않도록 격리
      watch: {
        ignored: [
          '**/tests/e2e/.results/**',
          '**/tests/e2e/report/**',
          '**/test-results/**',
          '**/playwright-report/**'
        ]
      }
    },

    optimizeDeps: {
      include: ['pdfjs-dist', 'paper', 'pdf-lib']
    }
  }
})
