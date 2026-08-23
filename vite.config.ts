import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'

/**
 * Production 빌드 시 index.html에 CSP meta 태그 주입
 * - dev 모드는 미적용 (HMR·inline script 깨짐 방지)
 * - frame-ancestors는 meta에서 무시되므로 LocalWebServer 측 HTTP 헤더로 별도 설정 필요
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
    "connect-src 'self'",
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

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
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
    // 공개 후보 산출물에 내부 어댑터·소스 원문이 포함되지 않도록 source map 비활성화
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
    open: true
  },

  optimizeDeps: {
    include: ['pdfjs-dist', 'paper', 'pdf-lib']
  }
}))
