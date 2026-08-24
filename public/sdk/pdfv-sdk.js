/**
 * Inko SDK — self-hosted iframe integration
 *
 * 호스트 웹 앱에 Inko 뷰어를 임베드하는 의존성 없는 브라우저 래퍼입니다.
 *
 * Usage:
 *   const viewer = Inko.mount('#container', {
 *     src:        '/inko/viewer/index.html',     // 뷰어 호스팅 URL (필수)
 *     pdfUrl:     '/files/document.pdf',         // OR pdfBase64
 *     fileName:   'document.pdf',
 *     readOnly:   false,
 *     initialCanvasData: '...',                  // 자체 DB에서 받아온 직전 onSave canvasData (그대로 전달)
 *     onReady:    () => {},
 *     onPdfLoaded:() => {},
 *     onChange:   (canvasData) => {},            // 편집 발생 시
 *     onSave:     (canvasData, ok, msg) => {},   // viewer.save() 응답
 *     onClose:    () => {},
 *     onError:    (err) => {},
 *     // ── 커스터마이징 (모두 선택적, 미지정 시 기본값 유지) ──
 *     theme:    { primaryColor:'#1e6fff', saveColor:'#16a34a', historyColor:'#7c3aed', logoUrl:'/logo.svg', cssVars:{ '--radius-md':'10px' } },
 *     tools:    { enabled:['pen','highlighter','text','shape'], defaultTool:'pen', defaultColor:'#e8a045', defaultWidth:4,
 *                 features:{ save:true, history:true, thumbnails:true, bookmarks:true, zoom:true, orientation:true, undoRedo:true, pageNav:true } },
 *     locale:   'en',                            // 내장: 'ko'(기본) · 'en'. 그 외 언어는 messages로
 *     messages: { 'tool.pen':'Stylo' },          // 키별 UI 문구 오버라이드(커스텀 언어·문구)
 *   });
 *
 *   viewer.save();                 // 캔버스 저장 요청 → onSave 콜백
 *   viewer.loadPdfUrl(url, name);  // 다른 PDF로 교체
 *   viewer.loadUserCanvasOverlay(list); // isCurrent 없으면 복수 검토 레이어, 있으면 단일 선택 버전 이력
 *   viewer.clear();
 *   viewer.applyConfig({ theme, tools, locale, messages }); // 런타임 커스터마이징 부분 갱신
 *   viewer.destroy();
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.Inko = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ========== 메시지 타입 (iframe 내 postMessageBridge.ts와 동일) ==========
  var MSG = Object.freeze({
    // SDK → iframe (송신)
    LOAD_PDF_BASE64:     'loadPdfBase64',
    LOAD_PDF_FROM_URL:   'loadPdfFromUrl',
    LOAD_USER_CANVAS:    'loadUserCanvasData',
    SAVE_CANVAS:         'saveCanvas',
    CLEAR_CANVAS:        'clearCurrentCanvas',
    APPLY_CONFIG:        'applyConfig',
    // iframe → SDK (수신)
    VIEWER_READY:        'viewerReady',
    PDF_LOADED:          'pdfLoaded',
    CANVAS_CHANGED:      'canvasDataChanged',
    SAVE_RESPONSE:       'saveCanvasResponse',
    CLOSE_VIEWER:        'closeViewer',
    SET_ORIENTATION:     'setOrientation',
  });

  /** src URL의 origin을 추출 — 상대경로면 현재 origin */
  function deriveOrigin(src) {
    try {
      var u = new URL(src, window.location.href);
      return u.origin;
    } catch (_) {
      return window.location.origin;
    }
  }

  /** target을 element로 정규화 — string이면 querySelector */
  function resolveTarget(target) {
    if (typeof target === 'string') {
      var el = document.querySelector(target);
      if (!el) throw new Error('[Inko SDK] target not found: ' + target);
      return el;
    }
    if (target && target.nodeType === 1) return target;
    throw new Error('[Inko SDK] target must be a CSS selector or Element');
  }

  function noop() {}

  /** mount 옵션에서 커스터마이징 설정만 추출 — 하나라도 있으면 객체, 없으면 null */
  function buildConfig(options) {
    var cfg = {};
    var has = false;
    if (options.theme)    { cfg.theme = options.theme;       has = true; }
    if (options.tools)    { cfg.tools = options.tools;       has = true; }
    if (options.locale)   { cfg.locale = options.locale;     has = true; }
    if (options.messages) { cfg.messages = options.messages; has = true; }
    return has ? cfg : null;
  }

  /**
   * 뷰어 인스턴스 생성 및 마운트
   * @param {string|Element} target  컨테이너 선택자 또는 엘리먼트
   * @param {object} options
   * @returns {object} viewer instance
   */
  function mount(target, options) {
    if (!options || typeof options !== 'object') {
      throw new Error('[Inko SDK] options is required');
    }
    if (!options.src) {
      throw new Error('[Inko SDK] options.src (viewer URL) is required');
    }

    var container = resolveTarget(target);
    var iframeOrigin = deriveOrigin(options.src);

    // 이벤트 콜백
    var onReady     = options.onReady     || noop;
    var onPdfLoaded = options.onPdfLoaded || noop;
    var onChange    = options.onChange    || noop;
    var onSave      = options.onSave      || noop;
    var onClose     = options.onClose     || noop;
    var onError     = options.onError     || noop;

    // 내부 상태
    var ready = false;
    var destroyed = false;
    var pendingQueue = [];   // viewerReady 이전에 들어온 요청
    var lastCanvasData = ''; // 가장 최근 변경된 canvasData (onChange 캐시)

    // ========== iframe 생성 ==========
    var iframe = document.createElement('iframe');
    iframe.src = options.src;
    iframe.style.border = '0';
    iframe.style.width  = options.width  || '100%';
    iframe.style.height = options.height || '100%';
    iframe.allow = 'fullscreen';
    iframe.setAttribute('title', options.title || 'PDF Viewer');
    if (options.iframeAttributes && typeof options.iframeAttributes === 'object') {
      Object.keys(options.iframeAttributes).forEach(function (k) {
        iframe.setAttribute(k, options.iframeAttributes[k]);
      });
    }
    container.appendChild(iframe);

    // ========== 메시지 송신 ==========
    function send(type, data) {
      if (destroyed) return;
      var msg = data === undefined ? { type: type } : { type: type, data: data };
      if (!ready) {
        pendingQueue.push(msg);
        return;
      }
      try {
        iframe.contentWindow.postMessage(msg, iframeOrigin);
      } catch (e) {
        onError(e);
      }
    }

    function flushPending() {
      var q = pendingQueue;
      pendingQueue = [];
      for (var i = 0; i < q.length; i++) {
        try {
          iframe.contentWindow.postMessage(q[i], iframeOrigin);
        } catch (e) {
          onError(e);
        }
      }
    }

    // ========== 메시지 수신 ==========
    function handleMessage(event) {
      if (destroyed) return;
      // origin·source 검증 — 다른 iframe·확장프로그램 메시지 차단
      if (event.source !== iframe.contentWindow) return;
      if (event.origin !== iframeOrigin) return;
      var data = event.data;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;

      switch (data.type) {
        case MSG.VIEWER_READY:
          if (ready) return;
          ready = true;
          // 커스터마이징 설정(테마·도구·언어) 먼저 주입 — PDF 로드/렌더 전에 적용
          var initConfig = buildConfig(options);
          if (initConfig) send(MSG.APPLY_CONFIG, initConfig);
          // 초기 PDF·캔버스 자동 주입
          // initialCanvasData는 직전 onSave에서 받은 값을 그대로 전달 — SDK는 형식을 해석하지 않음
          if (options.pdfBase64) {
            send(MSG.LOAD_PDF_BASE64, {
              base64:     options.pdfBase64,
              fileName:   options.fileName || 'document.pdf',
              canvasData: options.initialCanvasData,
              readOnly:   !!options.readOnly,
            });
          } else if (options.pdfUrl) {
            send(MSG.LOAD_PDF_FROM_URL, {
              url:        options.pdfUrl,
              fileName:   options.fileName || 'document.pdf',
              canvasData: options.initialCanvasData,
              readOnly:   !!options.readOnly,
            });
          }
          flushPending();
          try { onReady(); } catch (e) { onError(e); }
          break;

        case MSG.PDF_LOADED:
          try { onPdfLoaded(); } catch (e) { onError(e); }
          break;

        case MSG.CANVAS_CHANGED:
          lastCanvasData = data.canvasData || '';
          try { onChange(lastCanvasData); } catch (e) { onError(e); }
          break;

        case MSG.SAVE_RESPONSE:
          try { onSave(data.canvasData || '', !!data.success, data.message || ''); }
          catch (e) { onError(e); }
          break;

        case MSG.CLOSE_VIEWER:
          try { onClose(); } catch (e) { onError(e); }
          break;

        case MSG.SET_ORIENTATION:
          // 호스트가 처리할 일이 거의 없음 — 필요 시 옵션으로 노출 가능
          break;

        default:
          // 알 수 없는 type — silent ignore
          break;
      }
    }

    window.addEventListener('message', handleMessage);

    // ========== 공개 API ==========
    var instance = {
      iframe: iframe,

      /** URL 기반 PDF 로드 (교체 가능). canvasData는 직전 onSave 값을 그대로 전달 */
      loadPdfUrl: function (url, fileName, canvasData, readOnly) {
        send(MSG.LOAD_PDF_FROM_URL, {
          url: url,
          fileName: fileName || 'document.pdf',
          canvasData: canvasData,
          readOnly: !!readOnly,
        });
      },

      /** Base64 기반 PDF 로드 (교체 가능) */
      loadPdfBase64: function (base64, fileName, canvasData, readOnly) {
        send(MSG.LOAD_PDF_BASE64, {
          base64: base64,
          fileName: fileName || 'document.pdf',
          canvasData: canvasData,
          readOnly: !!readOnly,
        });
      },

      /**
       * 이력 패널 항목을 교체한다.
       * isCurrent가 없으면 협업·리뷰용 복수 레이어, 하나에 true면 정확히 하나를 고르는 버전 이력.
       * 현재 편집 상태 복원은 별도로 mount의 initialCanvasData 또는 loadPdf*로 처리한다.
       * @param {Array<{canvasId, userName, canvasData, enabled?, isCurrent?, registeredAt?, regDt?, ...}>} list
       */
      loadUserCanvasOverlay: function (list) {
        send(MSG.LOAD_USER_CANVAS, Array.isArray(list) ? list : []);
      },

      /** 캔버스 저장 요청 — 응답은 onSave 콜백으로 전달 */
      save: function () {
        send(MSG.SAVE_CANVAS);
      },

      /**
       * 런타임 커스터마이징 적용 — 부분 갱신 가능.
       * @param {{theme?:object, tools?:object, locale?:string, messages?:object}} config
       */
      applyConfig: function (config) {
        if (config && typeof config === 'object') send(MSG.APPLY_CONFIG, config);
      },

      /** 현재 페이지 캔버스 초기화 */
      clear: function () {
        send(MSG.CLEAR_CANVAS);
      },

      /** 마지막으로 onChange로 받은 canvasData (자동저장용 캐시) */
      getLastCanvasData: function () {
        return lastCanvasData;
      },

      /** 뷰어 해제 — iframe 제거, 리스너 정리 */
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        window.removeEventListener('message', handleMessage);
        if (iframe && iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
        pendingQueue = [];
      },

      /** 준비 여부 */
      isReady: function () { return ready; },
    };

    return instance;
  }

  return {
    mount: mount,
    /** 디버깅·고급 사용 — 메시지 타입 상수 노출 */
    MESSAGE_TYPES: MSG,
    version: '1.0.1',
  };
});
