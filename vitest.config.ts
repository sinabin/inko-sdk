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
      include: ['src/lib/**/*.{ts,svelte.ts}'],
      reporter: ['text', 'html', 'json-summary'],
      reportOnFailure: true,
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
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
