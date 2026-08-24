import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'

export default defineConfig({
  plugins: [svelte({ hot: false })],
  resolve: {
    alias: {
      '$lib': resolve(__dirname, './src/lib')
    },
    conditions: ['browser']
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
    setupFiles: ['./tests/unit/setup.ts'],
    coverage: {
      provider: 'v8',
      // 공개 패키지의 라이브러리뿐 아니라 실제 조립 UI도 계측한다. 0% 컴포넌트가
      // lib-only 합계 뒤에 숨지 않도록 전체 src를 모수로 삼고 영역별 기준을 함께 둔다.
      include: ['src/**/*.{ts,svelte}'],
      reporter: ['text', 'html', 'json-summary'],
      reportOnFailure: true,
      thresholds: {
        // 전체 source 기준선. 컴포넌트 직접 테스트가 늘어날 때 수치만 상향한다.
        statements: 82,
        branches: 75,
        functions: 78,
        lines: 85,
        // 기존 lib 품질 기준은 전체 모수 확장과 무관하게 유지한다.
        'src/lib/**/*.{ts,svelte.ts}': {
          statements: 91,
          branches: 84,
          functions: 91,
          lines: 94
        },
        // UI 조립층은 현재 직접 실행되는 경로에 맞춘 첫 단계 하한이다.
        'src/components/**/*.svelte': {
          statements: 57,
          branches: 38,
          functions: 55,
          lines: 56
        },
        'src/components/{ErrorToast,PdfScrollViewer,PdfThumbnail,PdfThumbnailList,TextInputOverlay,ToolOptionsSheet,UserCanvasDataList}.svelte': {
          statements: 66,
          branches: 46,
          functions: 63,
          lines: 64
        },
        'src/components/toolbar/**/*.svelte': {
          statements: 88,
          branches: 68,
          functions: 90,
          lines: 85
        },
        // PdfViewer에서 분리한 핵심 controller 계층의 회귀 하한.
        'src/lib/viewer/**/*.ts': {
          statements: 71,
          branches: 61,
          functions: 60,
          lines: 77
        },
        'src/lib/viewer/pageLayerCoordinator.svelte.ts': {
          statements: 74,
          branches: 60,
          functions: 61,
          lines: 84
        },
        'src/lib/viewer/viewerBridgeController.ts': {
          statements: 81,
          branches: 80,
          functions: 82,
          lines: 84
        },
        'src/lib/viewer/viewerInteractionController.svelte.ts': {
          statements: 58,
          branches: 49,
          functions: 35,
          lines: 61
        },
        'src/lib/viewer/viewerReviewController.svelte.ts': {
          statements: 82,
          branches: 69,
          functions: 78,
          lines: 93
        },
        'src/lib/accessibility/**/*.ts': {
          statements: 86,
          branches: 80,
          functions: 94,
          lines: 92
        },
        'src/lib/pdf/pdfCanvasFlatten.ts': {
          statements: 93,
          branches: 87,
          functions: 98,
          lines: 95
        },
        'src/lib/pdf/{pdfFlattenFont,pdfStructTreeLayer}.ts': {
          statements: 90,
          branches: 70,
          functions: 95,
          lines: 98
        },
        'src/components/PdfPageDomLayers.svelte': {
          statements: 76,
          branches: 55,
          functions: 80,
          lines: 78
        },
        'src/components/PdfScrollViewer.svelte': {
          statements: 52,
          branches: 26,
          functions: 47,
          lines: 51
        },
        'src/components/PdfSearchBar.svelte': {
          statements: 90,
          branches: 68,
          functions: 80,
          lines: 90
        },
        // 최상위 조립 컴포넌트도 0%로 되돌아가지 않도록 shell lifecycle 기준선을 둔다.
        'src/components/PdfViewer.svelte': {
          statements: 30,
          branches: 5,
          functions: 15,
          lines: 32
        },
        'src/lib/scroll/{renderCache,pageStateManager,visibilityManager,scrollMode,lowResPreview}.svelte.ts': {
          statements: 95,
          branches: 90,
          functions: 95,
          lines: 95
        },
        'src/lib/canvas/{canvasState,userOverlay}.svelte.ts': {
          statements: 95,
          branches: 90,
          functions: 95,
          lines: 95
        },
        'src/lib/history/historyManager.svelte.ts': {
          statements: 95,
          branches: 90,
          functions: 95,
          lines: 95
        },
        'src/lib/pdf/{pdfLoader,pdfRenderer}.svelte.ts': {
          statements: 95,
          branches: 90,
          functions: 95,
          lines: 95
        },
        'src/lib/utils/{pdfFlatten,pathOutline}.ts': {
          statements: 95,
          branches: 90,
          functions: 95,
          lines: 95
        },
        'src/lib/tools/{drawingMode,eraserMode,highlighterMode,selectionMode,shapeTools,textMode}.svelte.ts': {
          statements: 95,
          branches: 90,
          functions: 95,
          lines: 95
        }
      }
    }
  }
})
