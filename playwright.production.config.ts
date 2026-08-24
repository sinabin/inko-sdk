import { createE2eConfig } from './playwright.config'

/** 동일 기능 E2E를 최적화된 Vite production build/preview에서 재실행한다. */
export default createE2eConfig('production')
