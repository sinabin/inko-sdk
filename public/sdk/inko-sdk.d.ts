// Type definitions for inko-pdf-sdk
// Inko — self-hosted PDF editing-state SDK

export interface UserCanvasEntry {
  canvasId: string;
  userName: string;
  canvasData: string;
  enabled?: boolean;
  /** Marks the current editable version and opts this list into exactly-one version-history selection. */
  isCurrent?: boolean;
  /** ISO or yyyy-MM-dd HH:mm:ss timestamp shown in the history panel. */
  registeredAt?: string;
  /** @deprecated Legacy alias accepted for compatibility. Use registeredAt. */
  regDt?: string;
  [key: string]: unknown;
}

export interface ViewerTheme {
  /** Primary/accent color — active tool, focus, highlights (default #1890ff) */
  primaryColor?: string;
  /** Save button color (default green) */
  saveColor?: string;
  /** History panel color (default purple) */
  historyColor?: string;
  /** Brand logo image URL shown in the toolbar */
  logoUrl?: string;
  /** Direct CSS custom-property overrides — e.g. { '--radius-md': '12px', 'color-surface': '#fafafa' } */
  cssVars?: Record<string, string>;
}

export type ToolName = 'select' | 'pen' | 'highlighter' | 'eraser' | 'text' | 'shape' | 'rectangle' | 'circle' | 'line';

export interface ViewerTools {
  /** Which drawing tools to show (default: all) */
  enabled?: ToolName[];
  /** Tool selected on load */
  defaultTool?: ToolName;
  /** Default brush color (hex) */
  defaultColor?: string;
  /** Default brush width */
  defaultWidth?: number;
  /** Toolbar feature toggles (default: all enabled) */
  features?: {
    save?: boolean;
    history?: boolean;
    thumbnails?: boolean;
    /**
     * Bookmark panel showing the PDF's embedded outline.
     * The button only appears when the loaded document actually has an outline.
     */
    bookmarks?: boolean;
    zoom?: boolean;
    orientation?: boolean;
    undoRedo?: boolean;
    pageNav?: boolean;
  };
}

export interface ViewerOptions {
  /** URL of the hosted viewer index.html (required) */
  src: string;
  /** PDF to load on mount — use pdfUrl OR pdfBase64, not both */
  pdfUrl?: string;
  pdfBase64?: string;
  fileName?: string;
  readOnly?: boolean;
  /**
   * Previously saved canvas state from onSave — passed through as-is.
   * Restores the editable annotation state on load.
   * Version metadata and history remain the host application's responsibility.
   */
  initialCanvasData?: string;
  width?: string;
  height?: string;
  title?: string;
  iframeAttributes?: Record<string, string>;
  /** Theme / white-label customization — brand colors, logo, CSS variable overrides */
  theme?: ViewerTheme;
  /** Tool & toolbar customization — which tools/features show, default brush */
  tools?: ViewerTools;
  /** Built-in UI language: 'ko' (default) or 'en'. Custom languages via `messages`. */
  locale?: string;
  /** Per-key UI string overrides (custom language or wording tweaks) */
  messages?: Record<string, string>;
  onReady?: () => void;
  onPdfLoaded?: () => void;
  /** Fired on every annotation change — use for autosave (debounce recommended) */
  onChange?: (canvasData: string) => void;
  /** Response to viewer.save() */
  onSave?: (canvasData: string, ok: boolean, message: string) => void;
  onClose?: () => void;
  onError?: (err: Error | unknown) => void;
}

export interface ViewerInstance {
  readonly iframe: HTMLIFrameElement;
  /** Replace current PDF with a URL-based document */
  loadPdfUrl(url: string, fileName?: string, canvasData?: string, readOnly?: boolean): void;
  /** Replace current PDF with a Base64-encoded document */
  loadPdfBase64(base64: string, fileName?: string, canvasData?: string, readOnly?: boolean): void;
  /**
   * Load annotation entries into the history panel.
   * Without isCurrent, entries are independent collaboration/review overlays (multi-select).
   * When one entry has isCurrent: true, the list becomes version history with exactly-one selection.
   * Restore the editable current state through initialCanvasData or loadPdfUrl/loadPdfBase64.
   */
  loadUserCanvasOverlay(list: UserCanvasEntry[]): void;
  /** Request save — result delivered via onSave callback */
  save(): void;
  /** Clear annotations on the current page */
  clear(): void;
  /** Apply theme / tools / locale / messages at runtime (partial update) */
  applyConfig(config: { theme?: ViewerTheme; tools?: ViewerTools; locale?: string; messages?: Record<string, string> }): void;
  /** Last canvasData received from onChange (autosave cache) */
  getLastCanvasData(): string;
  /** Tear down iframe and remove event listeners */
  destroy(): void;
  isReady(): boolean;
}

export interface InkoStatic {
  /**
   * Mount the Inko PDF viewer inside the given container.
   * @param target CSS selector string or Element
   * @param options Viewer configuration
   */
  mount(target: string | Element, options: ViewerOptions): ViewerInstance;
  readonly MESSAGE_TYPES: Readonly<{
    LOAD_PDF_BASE64: 'loadPdfBase64';
    LOAD_PDF_FROM_URL: 'loadPdfFromUrl';
    LOAD_USER_CANVAS: 'loadUserCanvasData';
    SAVE_CANVAS: 'saveCanvas';
    CLEAR_CANVAS: 'clearCurrentCanvas';
    APPLY_CONFIG: 'applyConfig';
    VIEWER_READY: 'viewerReady';
    PDF_LOADED: 'pdfLoaded';
    CANVAS_CHANGED: 'canvasDataChanged';
    SAVE_RESPONSE: 'saveCanvasResponse';
    CLOSE_VIEWER: 'closeViewer';
    SET_ORIENTATION: 'setOrientation';
  }>;
  readonly version: string;
}

declare const Inko: InkoStatic;
export default Inko;

declare global {
  interface Window {
    Inko: InkoStatic;
  }
}
