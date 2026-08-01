/**
 * PDF adapter for foliate-js
 * Converts PDF pages into foliate-js book format for rendering with fixed-layout renderer.
 * Uses PDF.js TextLayer for text selection support.
 */
import * as pdfjsLib from "pdfjs-dist";
import { WorkerMessageHandler } from "pdfjs-dist/build/pdf.worker.mjs";

globalThis.pdfjsWorker ??= { WorkerMessageHandler };

// Configure PDF.js worker — always set to match the API version
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
const PDFJS_CDN_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}`;
const PDFJS_DOCUMENT_OPTIONS = {
  useWorkerFetch: false,
  isEvalSupported: false,
  useSystemFonts: true,
  cMapUrl: `${PDFJS_CDN_BASE}/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${PDFJS_CDN_BASE}/standard_fonts/`,
};

// The OS accessibility "font size" setting scales every piece of WebView-rendered
// text (including this transparent selection/highlight text layer) but leaves the
// page's canvas bitmap untouched. Only the glyph *size* (a font-size) is scaled;
// the text layer's positions are percentages of the `--total-scale-factor`-sized
// container and are not. Left uncorrected the glyphs render `fontScale`x larger
// than the ones baked into the canvas, so selection and highlight rectangles
// overshoot the text into the blank margins and sit too low (readest #4480).
// Measure the scale here so render() can divide it back out of the glyph-size
// lever only. offsetHeight of a 100px/line-height-1 box reflects the OS font
// scaling but not devicePixelRatio or CSS transforms, so it isolates it.
const getFontScale = (doc) => {
  const probe = doc.createElement("div");
  probe.style.cssText =
    "position:absolute;left:-9999px;top:0;visibility:hidden;font-size:100px;line-height:1;text-size-adjust:none;-webkit-text-size-adjust:none";
  probe.textContent = "x";
  doc.body.append(probe);
  const fontScale = probe.offsetHeight / 100;
  probe.remove();
  return fontScale > 0 ? fontScale : 1;
};

// iOS WKWebView has a ~2GB per-process memory ceiling. Both a page's canvas
// bitmap and its WebKit backing layer are allocated at the render scale, so
// their memory grows with the SQUARE of the device pixel ratio. Phones report
// dpr 3, which is the tipping factor. Rendering at 2x instead of 3x is still
// retina-sharp but uses ~2.25x less memory per page (the crisp, selectable
// text layer is a separate DOM layer, unaffected).
const MAX_RENDER_DPR = 2;
// Hard ceiling on a single page's bitmap area (~3.1 Mpx ≈ 12.6 MB) so a large
// tablet page can't blow the budget even after the dpr clamp.
const MAX_CANVAS_PIXELS = 2048 * 1536;

// Only mobile WebViews get that budget. Desktop browsers have no per-process
// memory ceiling, so clamping there bought nothing and cost sharpness: the
// raster ended up coarser than the screen, the browser upscaled it into the
// CSS box, and PDF text looked blurry (readest #5251). iPadOS reports a
// desktop ("Macintosh") user agent, so touch points are what give a tablet
// away.
const isMobileWebView = () => {
  const ua = navigator.userAgent;
  return (
    /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  );
};

// The device pixel ratio to rasterise this page at: the real dpr on desktop,
// or on mobile the dpr clamped by both MAX_RENDER_DPR and the per-canvas pixel
// budget. Never below 1 (CSS resolution).
const getRenderDpr = (page, zoom) => {
  let dpr = globalThis.devicePixelRatio || 1;
  if (isMobileWebView()) {
    dpr = Math.min(dpr, MAX_RENDER_DPR);
    const { width, height } = page.getViewport({ scale: zoom || 1 });
    const area = width * height * dpr * dpr;
    if (area > MAX_CANVAS_PIXELS) dpr *= Math.sqrt(MAX_CANVAS_PIXELS / area);
  }
  return Math.max(1, dpr);
};

// Inline text_layer_builder CSS
const TEXT_LAYER_CSS = `
.textLayer {
  position: absolute;
  text-align: initial;
  inset: 0;
  overflow: clip;
  opacity: 1;
  line-height: 1;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  caret-color: CanvasText;
  z-index: 0;
  letter-spacing: normal;
  word-spacing: normal;
}
.textLayer.highlighting { touch-action: none; }
.textLayer :is(span, br) {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
}
.textLayer {
  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
}
.textLayer > :not(.markedContent),
.textLayer .markedContent span:not(.markedContent) {
  z-index: 1;
  --font-height: 0;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  --scale-x: 1;
  --rotate: 0deg;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}
.textLayer .markedContent { display: contents; }
.textLayer span[role="img"] { user-select: none; cursor: default; }
/* Single source of truth for the selection highlight (unified with the reader
   template's fixed-layout block: rgba(59, 130, 246, 0.24)). */
.textLayer ::selection {
  background: rgba(59, 130, 246, 0.24);
}
.textLayer br::selection { background: transparent; }
.textLayer .endOfContent {
  display: block;
  position: absolute;
  inset: 100% 0 0;
  z-index: 0;
  cursor: default;
  user-select: none;
}
.textLayer.selecting .endOfContent { top: 0; }
`;

const ANNOTATION_LAYER_CSS = `
.annotationLayer {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  transform-origin: 0 0;
}
.annotationLayer section {
  position: absolute;
  text-align: initial;
  pointer-events: auto;
  box-sizing: border-box;
  transform-origin: 0 0;
  user-select: none;
}
.annotationLayer :is(.linkAnnotation, .buttonWidgetAnnotation.pushButton) > a {
  position: absolute;
  font-size: 1em;
  top: 0; left: 0;
  width: 100%; height: 100%;
}
.annotationLayer :is(.linkAnnotation, .buttonWidgetAnnotation.pushButton):not(.hasBorder) > a:hover {
  opacity: 0.2;
  background-color: rgb(255 255 0);
}
.annotationLayer .linkAnnotation.hasBorder:hover {
  background-color: rgb(255 255 0 / 0.2);
}
.textLayer.selecting ~ .annotationLayer section {
  pointer-events: none;
}
`;

const NULL_CHAR = String.fromCharCode(0);
const removeNullCharacters = (str) => str.replaceAll(NULL_CHAR, "");
const normalizeSelectedText = (str) => removeNullCharacters(pdfjsLib.normalizeUnicode(str)).trim();

const getRangeTextWithLineBreaks = (range) => {
  try {
    const fragment = range.cloneContents();
    for (const node of fragment.querySelectorAll(".endOfContent")) {
      node.remove();
    }
    for (const node of fragment.querySelectorAll("br")) {
      node.replaceWith(fragment.ownerDocument.createTextNode("\n"));
    }
    return fragment.textContent || "";
  } catch {
    return "";
  }
};

const getSelectedText = (selection, container) => {
  const doc = container.ownerDocument;
  const view = doc.defaultView;
  const segments = [];
  let textWithExplicitLineBreaks = "";

  const walker = doc.createTreeWalker(container, view.NodeFilter.SHOW_TEXT);
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    if (!range.intersectsNode(container)) continue;

    const rangeText = getRangeTextWithLineBreaks(range);
    if (rangeText.trim()) {
      textWithExplicitLineBreaks += `${textWithExplicitLineBreaks ? "\n" : ""}${rangeText}`;
    }

    walker.currentNode = container;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!parent || parent.closest(".endOfContent")) continue;
      if (!range.intersectsNode(node)) continue;

      let start = 0;
      let end = node.nodeValue.length;
      if (range.startContainer === node) start = range.startOffset;
      if (range.endContainer === node) end = range.endOffset;
      const text = node.nodeValue.slice(start, end);
      if (!text) continue;

      const rect = parent.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      segments.push({
        text,
        left: rect.left,
        centerY: rect.top + rect.height / 2,
        height: rect.height || 1,
      });
    }
  }

  if (textWithExplicitLineBreaks.trim()) {
    return normalizeSelectedText(textWithExplicitLineBreaks);
  }

  if (segments.length === 0) {
    return normalizeSelectedText(selection.toString());
  }

  segments.sort((a, b) => {
    const tolerance = Math.max(2, Math.min(a.height, b.height) * 0.6);
    if (Math.abs(a.centerY - b.centerY) > tolerance) return a.centerY - b.centerY;
    return a.left - b.left;
  });

  const lines = [];
  for (const segment of segments) {
    const line = lines.at(-1);
    const tolerance = Math.max(2, segment.height * 0.6);
    if (!line || Math.abs(line.centerY - segment.centerY) > tolerance) {
      lines.push({ centerY: segment.centerY, height: segment.height, parts: [segment] });
      continue;
    }
    line.parts.push(segment);
    line.centerY = (line.centerY * (line.parts.length - 1) + segment.centerY) / line.parts.length;
    line.height = Math.max(line.height, segment.height);
  }

  const text = lines
    .map((line) =>
      line.parts
        .sort((a, b) => a.left - b.left)
        .map((segment) => segment.text)
        .join(""),
    )
    .join("\n");

  return normalizeSelectedText(text);
};

/**
 * Per-document render state shared by every page render of the same iframe.
 * Guarantees "latest wins": each render() call bumps `generation` and every
 * async stage checks it before touching the real DOM, so Canvas/TextLayer/
 * AnnotationLayer always come from the same zoom render and an older render can
 * never overwrite a newer one (which caused stale TextLayers to land on a fresh
 * canvas, double selection boxes, and handle jumping onto dead spans).
 */
const getRenderState = (doc) => {
  if (!doc.__readanyPdfRenderState) {
    doc.__readanyPdfRenderState = {
      generation: 0,
      renderTask: null,
      selectionAbortController: null,
    };
  }
  return doc.__readanyPdfRenderState;
};

// ─── Runtime diagnostics (P1) ───
// Debug/dev builds or an explicit opt-in (`setPdfDebug(true)` from RN) get a
// structured log of every render lifecycle event plus anomaly detection. Each
// event is tagged with the render generation it belongs to so out-of-order
// submissions are visible immediately.
let readanyPdfDebug = false;
const setReadanyPdfDebug = (enabled) => {
  readanyPdfDebug = !!enabled;
  if (readanyPdfDebug) console.log("[readany-pdf] diagnostics enabled");
};
const pdfDebugLog = (doc, message, detail) => {
  if (!readanyPdfDebug) return;
  const state = doc?.__readanyPdfRenderState;
  const tag = { gen: state?.generation ?? 0 };
  if (detail) {
    const { page, scale, dpr, ...rest } = detail;
    if (page != null) tag.page = page;
    if (scale != null) tag.scale = scale;
    if (dpr != null) tag.dpr = dpr;
    Object.assign(tag, rest);
  }
  console.log(`[readany-pdf] ${message}`, tag);
};

// Holds transient long-press state so a stale/aborted render can release it.
let readanyPdfLongPressState = null;

/**
 * Render canvas + text layer + annotation layer for a PDF page inside an iframe document.
 * Called on initial load and on every zoom change.
 *
 * latest-wins contract:
 *  - bumps the doc's render generation; any earlier async render still in flight
 *    is cancelled (canvas RenderTask, selection AbortController).
 *  - renders the text and annotation layers into detached containers first, then
 *    commits them to the live DOM atomically only if this generation is still
 *    current. An out-of-date render never writes into `#canvas`/`.textLayer`/
 *    `.annotationLayer`.
 */
const render = async (page, doc, zoom) => {
  if (!doc) return;
  const scale = zoom;
  const renderDpr = getRenderDpr(page, zoom);

  const state = getRenderState(doc);
  const generation = ++state.generation;
  pdfDebugLog(doc, "render.start", { page: page.pageNumber, scale, dpr: renderDpr });

  // Cancel any in-flight render of this iframe: its canvas RenderTask and the
  // selection listeners it installed. A render that loses the race must not keep
  // drawing or keep moving endOfContent on a canvas it no longer belongs to.
  state.renderTask?.cancel?.();
  state.renderTask = null;
  state.selectionAbortController?.abort();
  state.selectionAbortController = null;
  if (readanyPdfLongPressState) {
    readanyPdfLongPressState.abort?.();
    readanyPdfLongPressState = null;
  }

  // Guard helper checked after every await in this render.
  const isStale = () => {
    const stale = state.generation !== generation;
    if (stale) pdfDebugLog(doc, "render.discarded", { page: page.pageNumber });
    return stale;
  };

  doc.documentElement.style.removeProperty("transform");
  doc.documentElement.style.removeProperty("transform-origin");
  doc.documentElement.style.setProperty("--total-scale-factor", scale);
  doc.documentElement.style.setProperty("--user-unit", "1");
  doc.documentElement.style.setProperty("--scale-round-x", "1px");
  doc.documentElement.style.setProperty("--scale-round-y", "1px");

  const viewport = page.getViewport({ scale });

  // Render canvas (in main document for font loading, then adopt into iframe).
  // The bitmap is over-sampled at renderDpr but the CSS box is the display size,
  // so the raster stays crisp WITHOUT scaling the document (scaling the document
  // with `transform` misplaces text selection and the annotation toolbar).
  const canvas = document.createElement("canvas");
  canvas.height = Math.floor(viewport.height * renderDpr);
  canvas.width = Math.floor(viewport.width * renderDpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const canvasContext = canvas.getContext("2d");
  const transform = renderDpr !== 1 ? [renderDpr, 0, 0, renderDpr, 0, 0] : null;
  const renderTask = page.render({ canvasContext, transform, viewport });
  state.renderTask = renderTask;
  try {
    await renderTask.promise;
  } catch (error) {
    if (error?.name === "RenderingCancelledException") {
      pdfDebugLog(doc, "render.canvasCancelled", { page: page.pageNumber });
      return;
    }
    throw error;
  }
  state.renderTask = null;
  if (isStale()) return;

  // Atomically commit the canvas to the iframe.
  const canvasContainer = doc.querySelector("#canvas");
  if (!canvasContainer) return;
  canvasContainer.replaceChildren(doc.adoptNode(canvas));
  pdfDebugLog(doc, "render.canvasCommitted", {
    page: page.pageNumber,
    bitmap: `${canvas.width}x${canvas.height}`,
  });

  // Render the text layer into a detached container first. pdf.js TextLayer has
  // no cancel mid-stream (it pumps the stream into the container incrementally),
  // so it must NOT touch the live DOM until it is fully rendered and this
  // generation is still current — otherwise an abandoned render would keep
  // appending spans onto the new canvas.
  const textContainer = doc.querySelector(".textLayer");
  if (textContainer) {
    // Build the layer detached so an abandoned render (a newer zoom arrived) can
    // never append spans onto the live DOM mid-stream. The class CSS already
    // sizes/positions `.textLayer`; `visibility:hidden` is only a helper while
    // the container is off-DOM (layout is no-op there) and is cleared on commit.
    const detached = doc.createElement("div");
    detached.className = "textLayer";
    detached.style.visibility = "hidden";

    // Counteract the OS font-size accessibility scaling on the text layer's glyph
    // size only (see getFontScale). `--text-scale-factor` feeds `font-size` and
    // nothing else, so dividing it leaves positions (which scale with
    // `--total-scale-factor`) aligned with the canvas at any font-size setting.
    // Set on the detached container (where the spans live) before construction;
    // the live container is reset to the default `calc(...)` on the next render.
    const fontScale = getFontScale(doc);
    if (fontScale !== 1) {
      detached.style.setProperty(
        "--text-scale-factor",
        `calc(var(--total-scale-factor) * var(--min-font-size) / ${fontScale})`,
      );
    }

    try {
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: await page.streamTextContent({
          includeMarkedContent: true,
          disableNormalization: true,
        }),
        container: detached,
        viewport,
      });
      await textLayer.render();
      pdfDebugLog(doc, "render.textLayerRendered", {
        page: page.pageNumber,
        spans: detached.querySelectorAll("span, br").length,
      });
    } catch (error) {
      console.error(`Failed to render PDF text layer for page ${page.pageNumber}.`, error);
    }

    // Hide offscreen canvases created by TextLayer
    for (const c of document.querySelectorAll(".hiddenCanvasElement")) {
      Object.assign(c.style, {
        position: "absolute",
        top: "0",
        left: "0",
        width: "0",
        height: "0",
        display: "none",
      });
    }

    if (isStale()) return;

    // This generation is still current: atomically swap the detached layer in.
    // Any selection the user is dragging was anchored into the previous layer,
    // so collapse it before replacing the DOM — a range holding dead spans is
    // what made handles jump.
    const selection = doc.getSelection?.();
    if (selection && !selection.isCollapsed) {
      try {
        selection.removeAllRanges();
      } catch {
        // selection may be unavailable in some WebViews
      }
    }
    textContainer.replaceChildren(detached);
    textContainer.classList.remove("selecting");
    detached.style.visibility = "";
    textContainer.style.visibility = "";

    // Selection + copy wiring. All listeners are bound to this generation's
    // AbortController so an aborted render releases them in one shot.
    state.selectionAbortController?.abort();
    const selectionAbortController = new AbortController();
    state.selectionAbortController = selectionAbortController;
    const { signal } = selectionAbortController;
    const SelectionRange = doc.defaultView.Range;
    const endOfContent = doc.createElement("div");
    endOfContent.className = "endOfContent";
    textContainer.append(endOfContent);
    let previousSelectionRange = null;

    const resetEndOfContent = () => {
      textContainer.append(endOfContent);
      endOfContent.style.width = "";
      endOfContent.style.height = "";
      endOfContent.style.userSelect = "";
      textContainer.classList.remove("selecting");
      previousSelectionRange = null;
    };

    const moveEndOfContent = (selection) => {
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        resetEndOfContent();
        return;
      }

      let range = null;
      for (let i = 0; i < selection.rangeCount; i++) {
        const candidate = selection.getRangeAt(i);
        if (candidate.intersectsNode(textContainer)) {
          range = candidate;
          break;
        }
      }

      if (!range) {
        resetEndOfContent();
        return;
      }

      textContainer.classList.add("selecting");

      const isModifyingStart =
        previousSelectionRange &&
        (range.compareBoundaryPoints(SelectionRange.END_TO_END, previousSelectionRange) === 0 ||
          range.compareBoundaryPoints(SelectionRange.START_TO_END, previousSelectionRange) === 0);

      let anchor = isModifyingStart ? range.startContainer : range.endContainer;
      if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
      if (anchor.classList?.contains("highlight")) anchor = anchor.parentNode;

      if (!isModifyingStart && range.endOffset === 0) {
        // Spans live in a nested `.textLayer` (the detached container we swapped
        // in), so bound the upward walk there — never climb to `textContainer`
        // and pick up the canvas as `previousSibling`, which would insert
        // `endOfContent` outside the layer (no longer matched by the
        // `.textLayer .endOfContent` styles).
        while (anchor && anchor !== detached && !anchor.previousSibling) {
          anchor = anchor.parentNode;
        }
        if (anchor?.previousSibling) anchor = anchor.previousSibling;
      }

      // The text layer spans live in a nested `.textLayer` container (rendered
      // detached, then swapped in), so walk the anchor's ancestor chain up to
      // the live container that owns `.endOfContent`.
      const withinLiveLayer =
        anchor?.parentElement && textContainer.contains(anchor.parentElement);
      if (withinLiveLayer && anchor.parentElement) {
        // The `.endOfContent` node must stay non-selectable: our doc styles (see
        // template fixed-layout block) force `user-select: none` on it so a drag
        // can never anchor onto the full-page helper and blow the range up to the
        // whole page. Re-assert it here in case a render-era default slipped
        // through.
        endOfContent.style.userSelect = "none";
        endOfContent.style.width = `${Math.ceil(viewport.width)}px`;
        endOfContent.style.height = `${Math.ceil(viewport.height)}px`;
        anchor.parentElement.insertBefore(
          endOfContent,
          isModifyingStart ? anchor : anchor.nextSibling,
        );
      }

      previousSelectionRange = range.cloneRange();
    };

    const handleCopy = (event) => {
      const selection = doc.getSelection();
      const text = selection ? getSelectedText(selection, textContainer) : "";
      if (!text || !event.clipboardData) return;
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
      event.stopPropagation();
    };
    textContainer.oncopy = handleCopy;
    doc.addEventListener("copy", handleCopy, { signal });

    // Panning + text selection cursor logic.
    //
    // Touch is never allowed to pan: on Android the browser is establishing a
    // selection the moment a finger lands on text, and letting the app also
    // scroll the outer renderer at the same time is exactly what made the
    // selection jump and grow while dragging a handle. Mouse keeps the
    // drag-to-pan affordance for desktop users grabbing empty canvas.
    let isPanning = false;
    let startX = 0;
    let startY = 0;
    let scrollLeft = 0;
    let scrollTop = 0;
    let scrollParent = null;
    let scrollWatched = null;
    let scrollStartLeft = 0;
    let scrollStartTop = 0;
    // Android long-press selection state machine:
    // idle -> pendingLongPress -> selecting -> idle (see P1).
    let longPress = null;
    const LONG_PRESS_DELAY = 400;
    const LONG_PRESS_MOVE_TOLERANCE = 10;

    const findScrollableParent = (element) => {
      let current = element;
      while (current) {
        if (current !== document.body && current.nodeType === 1) {
          const style = window.getComputedStyle(current);
          const overflow = style.overflow + style.overflowY + style.overflowX;
          if (/(auto|scroll)/.test(overflow)) {
            if (
              current.scrollHeight > current.clientHeight ||
              current.scrollWidth > current.clientWidth
            ) {
              return current;
            }
          }
        }
        if (current.parentElement) current = current.parentElement;
        else if (current.parentNode?.host) current = current.parentNode.host;
        else break;
      }
      return window;
    };

    const isTextTarget = (target) => {
      const el = target?.closest?.(".textLayer span, .textLayer p");
      return Boolean(el?.textContent?.trim());
    };

    const getPointerTextHit = (e) => {
      // Prefer the event target: it is the actual span under the pointer even
      // when transparent/transformed layers make elementFromPoint unreliable
      // (Android WebView). elementFromPoint is only a mouse fallback.
      if (e.target && e.target.nodeType === 1) {
        if (isTextTarget(e.target)) return true;
      }
      if (e.pointerType === "touch") return false;
      const el = doc.elementFromPoint(e.clientX, e.clientY);
      return Boolean(el?.closest?.(".textLayer span, .textLayer p"));
    };

    const beginPanning = (e) => {
      isPanning = true;
      startX = e.screenX;
      startY = e.screenY;
      const iframe = doc.defaultView.frameElement;
      if (iframe) {
        scrollParent = findScrollableParent(iframe);
        if (scrollParent === window) {
          scrollLeft = window.scrollX || window.pageXOffset;
          scrollTop = window.scrollY || window.pageYOffset;
        } else {
          scrollLeft = scrollParent.scrollLeft;
          scrollTop = scrollParent.scrollTop;
        }
        textContainer.style.cursor = "grabbing";
        // Watch the renderer's scroll during the drag so a conflict with
        // selection is diagnosable (diagnostics only).
        scrollWatched = scrollParent;
        scrollStartLeft = scrollParent === window ? window.scrollX : scrollParent.scrollLeft;
        scrollStartTop = scrollParent === window ? window.scrollY : scrollParent.scrollTop;
      }
    };

    const stopPanning = () => {
      isPanning = false;
      scrollParent = null;
      scrollWatched = null;
      textContainer.style.cursor = "grab";
    };

    // ── Android custom long-press selection (P1) ──
    // The platform's own long-press is slow and unreliable on transparent,
    // absolutely-positioned, transformed TextLayer spans in the Android
    // WebView, so on Android only we arm a 350–450ms timer on real text and
    // establish the selection ourselves. iOS/desktop keep native selection.
    const IS_ANDROID = /Android/i.test(navigator.userAgent);

    const clearLongPress = (reason) => {
      if (!longPress) return;
      pdfDebugLog(doc, "longPress.clear", { reason, page: page.pageNumber });
      if (longPress.timer) clearTimeout(longPress.timer);
      longPress = null;
    };

    const releaseSelecting = () => {
      if (longPress?.selecting) {
        longPress.selecting = false;
        setNavigationLocked(false);
        textContainer.classList.remove("highlighting");
        if (scrollWatched && scrollWatched !== window) {
          if (
            Math.abs(scrollWatched.scrollLeft - scrollStartLeft) > 0.5 ||
            Math.abs(scrollWatched.scrollTop - scrollStartTop) > 0.5
          ) {
            pdfDebugLog(doc, "dragSelectionScrollMoved", {
              page: page.pageNumber,
              scrollLeftDelta: scrollWatched.scrollLeft - scrollStartLeft,
              scrollTopDelta: scrollWatched.scrollTop - scrollStartTop,
            });
          }
        }
        scrollWatched = null;
        pdfDebugLog(doc, "gesture.idle", { page: page.pageNumber });
      }
      clearLongPress("release");
    };

    // Collapsed caret at a page point. Prefers the WebView's native
    // caretRangeFromPoint (works even with the transparent, transformed spans);
    // falls back to a geometry snapshot of the nearest span.
    const caretRangeAtPoint = (x, y) => {
      const view = doc.defaultView;
      if (typeof view.caretRangeFromPoint === "function") {
        try {
          const caret = view.caretRangeFromPoint(x, y);
          if (caret && caret.startContainer?.parentElement?.closest?.(".textLayer")) {
            return caret;
          }
        } catch {
          // fall through to geometry snapshot
        }
      }
      const spans = Array.from(textContainer.querySelectorAll("span"));
      if (!spans.length) return null;
      const spanRect = (span) => {
        try {
          return span.getBoundingClientRect();
        } catch {
          return null;
        }
      };
      let best = null;
      let bestDist = Infinity;
      for (const span of spans) {
        const r = spanRect(span);
        if (!r || r.width === 0 || r.height === 0) continue;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const d = Math.hypot(x - cx, y - cy);
        if (d < bestDist) {
          bestDist = d;
          best = span;
        }
      }
      if (!best) return null;
      const textNode = Array.from(best.childNodes).find(
        (n) => n.nodeType === Node.TEXT_NODE && n.nodeValue?.trim(),
      );
      if (!textNode) return null;
      const text = textNode.nodeValue;
      const rect = best.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (x - rect.left) / (rect.width || 1)));
      const offset = Math.min(text.length, Math.floor(ratio * text.length));
      const range = doc.createRange();
      range.setStart(textNode, offset);
      range.collapse(true);
      return range;
    };

    // Expand a collapsed caret to a word-level Range: a single Unicode code
    // point for CJK / non-Latin (TextLayer spans split arbitrarily, so there is
    // no reliable word boundary), a Latin word otherwise.
    const expandToWordOrCodePoint = (caret) => {
      const range = caret.cloneRange();
      const textNode = caret.startContainer;
      if (textNode.nodeType !== Node.TEXT_NODE || !textNode.nodeValue) return range;
      const value = textNode.nodeValue;
      const pos = caret.startOffset;
      const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/u;
      const char = value.slice(pos, pos + 2) || "";
      if (CJK.test(char) || !/\w/.test(value[pos] || "")) {
        const start = Math.min(pos, value.length - 1);
        // Single code point (handles astral-plane surrogates in CJK-adjacent
        // scripts).
        let end = start + 1;
        const cp = value.codePointAt(start);
        if (cp !== undefined && cp > 0xffff) end = start + 2;
        try {
          range.setStart(textNode, start);
          range.setEnd(textNode, Math.min(value.length, end));
        } catch {
          range.setStart(textNode, pos);
          range.setEnd(textNode, Math.min(value.length, pos + 1));
        }
        return range;
      }
      let s = pos;
      let e = pos;
      while (s > 0 && /\w/.test(value[s - 1])) s -= 1;
      while (e < value.length && /\w/.test(value[e])) e += 1;
      if (s === e) e = Math.min(value.length, s + 1);
      range.setStart(textNode, s);
      range.setEnd(textNode, e);
      return range;
    };

    const wordRangeAtPoint = (x, y) => {
      const caret = caretRangeAtPoint(x, y);
      if (!caret) return null;
      return expandToWordOrCodePoint(caret);
    };

    const selectAtPoint = (x, y) => {
      const sel = doc.getSelection();
      if (!sel) return;
      // If the browser already established a native non-collapsed selection
      // (e.g. its own long-press won the race), keep it.
      if (!sel.isCollapsed && sel.toString().trim()) return;
      const range = wordRangeAtPoint(x, y);
      if (!range) return;
      sel.removeAllRanges();
      sel.addRange(range);
      // Anchor for drag-select: always the initial word, regardless of drag
      // direction.
      if (longPress) longPress.baseRange = range.cloneRange();
    };

    const setNavigationLocked = (locked) => {
      // Coordinate with the template's tap detector so a selection gesture
      // doesn't also trigger tap-to-turn-page. The template reads
      // `doc.__readany_selection_interaction` on every touchstart/touchend.
      try {
        doc.__readany_selection_interaction = !!locked;
      } catch {
        // doc may be a plain object in some embeddings
      }
      const frame = doc.defaultView.frameElement;
      const host = frame?.ownerDocument?.defaultView?.parent;
      try {
        if (host?.setNavigationLocked) host.setNavigationLocked(locked);
      } catch {
        // not available in every embedding
      }
    };

    textContainer.onpointerdown = (e) => {
      const isTouch = e.pointerType === "touch";
      const hasTextSelection = !!(doc.getSelection()?.toString().length > 0);

      // Touch: hand off to long-press; never start panning.
      if (isTouch) {
        clearLongPress("newPointerDown");
        longPress = {
          startX: e.clientX,
          startY: e.clientY,
          timer: null,
          selecting: false,
          baseRange: null,
        };
        longPress.timer = setTimeout(() => {
          if (!longPress) return;
          if (IS_ANDROID) {
            longPress.selecting = true;
            pdfDebugLog(doc, "gesture.selecting", { page: page.pageNumber });
            setNavigationLocked(true);
            // Disable touch panning while dragging handles so the WebView can't
            // scroll the renderer out from under the selection (scoped to the
            // active selection only, not the whole layer).
            textContainer.classList.add("highlighting");
            selectAtPoint(longPress.startX, longPress.startY);
          } else {
            clearLongPress("iosNative");
          }
        }, LONG_PRESS_DELAY);
        return;
      }

      // Mouse path (touch never reaches here).
      const hasTextUnderneath = getPointerTextHit(e);
      if (!hasTextUnderneath && !hasTextSelection) {
        beginPanning(e);
      } else {
        textContainer.classList.add("selecting");
      }
    };

    let pointerMoveRAF = null;
    let pendingMovePoint = null;
    const flushPointerMove = () => {
      pointerMoveRAF = null;
      if (!longPress?.selecting || !pendingMovePoint) return;
      const { x, y } = pendingMovePoint;
      pendingMovePoint = null;
      const sel = doc.getSelection();
      if (!sel || !longPress.baseRange) return;
      const caret = caretRangeAtPoint(x, y);
      if (!caret) return;
      // Drag-select: anchor at the long-pressed word, extend to the current
      // caret. Merging the two boundaries keeps the anchor stable while the
      // user drags either direction (standard text-selection semantics).
      const merged = longPress.baseRange.cloneRange();
      try {
        merged.setStart(longPress.baseRange.startContainer, longPress.baseRange.startOffset);
        merged.setEnd(caret.endContainer, caret.endOffset);
        sel.removeAllRanges();
        sel.addRange(merged);
      } catch {
        // ignore malformed boundary merges
      }
    };

    textContainer.onpointermove = (e) => {
      if (isPanning && scrollParent) {
        e.preventDefault();
        const dx = e.screenX - startX;
        const dy = e.screenY - startY;
        if (scrollParent === window) window.scrollTo(scrollLeft - dx, scrollTop - dy);
        else {
          scrollParent.scrollLeft = scrollLeft - dx;
          scrollParent.scrollTop = scrollTop - dy;
        }
        return;
      }

      if (longPress) {
        if (longPress.selecting && e.pointerType === "touch") {
          // RAF-throttled extend while selecting; prevents scroll-jump feedback.
          pendingMovePoint = { x: e.clientX, y: e.clientY };
          if (!pointerMoveRAF) {
            pointerMoveRAF = doc.defaultView.requestAnimationFrame(flushPointerMove);
          }
        } else if (!longPress.selecting) {
          // Still within the long-press wait: moving beyond tolerance cancels it
          // and falls back to normal scrolling.
          const dx = e.clientX - longPress.startX;
          const dy = e.clientY - longPress.startY;
          if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE) {
            clearLongPress("moved");
          }
        }
      }
    };

    textContainer.onpointerup = () => {
      if (isPanning) {
        stopPanning();
      } else {
        resetEndOfContent();
        releaseSelecting();
      }
    };

    textContainer.onpointercancel = () => {
      if (isPanning) stopPanning();
      releaseSelecting();
    };

    textContainer.onpointerleave = () => {
      if (isPanning) stopPanning();
    };

    doc.addEventListener(
      "selectionchange",
      () => {
        const selection = doc.getSelection();
        moveEndOfContent(selection);
        if (selection && selection.toString().length > 0) textContainer.style.cursor = "text";
        else if (!isPanning) textContainer.style.cursor = "grab";
      },
      { signal },
    );
    doc.addEventListener("pointerup", resetEndOfContent, { signal });
    doc.addEventListener("keyup", resetEndOfContent, { signal });
    doc.defaultView.addEventListener("blur", resetEndOfContent, { signal });

    textContainer.style.cursor = "grab";
  }

  if (isStale()) return;

  // Render annotation layer (links etc.) — committed atomically like the text
  // layer so it always matches the current canvas generation.
  const annotationDiv = doc.querySelector(".annotationLayer");
  if (annotationDiv) {
    const detachedAnnot = doc.createElement("div");
    detachedAnnot.className = "annotationLayer";
    // Class CSS already positions the layer (top/left 0). No inline visibility:
    // the container is off-DOM during render, and nothing must hide it after the
    // atomic swap into the live `.annotationLayer`.
    detachedAnnot.style.inset = "0";
    const linkService = {
      goToDestination: () => {},
      getDestinationHash: (dest) => JSON.stringify(dest),
      // pdf.js AnnotationLayer calls getAnchorUrl for named-action / GoTo link
      // annotations; without it the render rejects. Match pdf.js SimpleLinkService,
      // which returns ''.
      getAnchorUrl: () => "",
      addLinkAttributes: (link, url) => {
        link.href = url;
      },
    };
    try {
      await new pdfjsLib.AnnotationLayer({
        page,
        viewport: viewport.clone({ dontFlip: true }),
        div: detachedAnnot,
        linkService,
      }).render({ annotations: await page.getAnnotations() });
    } catch {
      // Annotation rendering may fail for some pages
    }
    if (isStale()) return;
    annotationDiv.replaceChildren(detachedAnnot);
    pdfDebugLog(doc, "render.annotationCommitted", { page: page.pageNumber });
  }

  pdfDebugLog(doc, "render.done", { page: page.pageNumber });
};

// Exposed for the reader template's runtime diagnostics toggle.
if (typeof globalThis !== "undefined") {
  globalThis.__readanyPdfDebug = setReadanyPdfDebug;
}

/**
 * Render a single PDF page and return src/onZoom for the fixed-layout renderer.
 */
const renderPage = async (page) => {
  const viewport = page.getViewport({ scale: 1 });

  const data = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${viewport.width}, height=${viewport.height}">
<style>
html, body { margin: 0; padding: 0; }
${TEXT_LAYER_CSS}
${ANNOTATION_LAYER_CSS}
</style>
</head>
<body>
<div id="canvas"></div>
<div class="textLayer"></div>
<div class="annotationLayer"></div>
</body>
</html>`;

  const src = URL.createObjectURL(new Blob([data], { type: "text/html" }));
  const onZoom = ({ doc, scale }) => render(page, doc, scale);
  return { src, data, onZoom };
};

/**
 * Render a page to a blob image (for cover)
 */
const renderPageAsBlob = async (page) => {
  const viewport = page.getViewport({ scale: 1 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const canvasContext = canvas.getContext("2d");
  await page.render({ canvasContext, viewport }).promise;
  return new Promise((resolve) => canvas.toBlob(resolve));
};

const CJK_CHAR = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/u;
const OPEN_PUNCTUATION = /[\s([{"'“‘（《「『【]$/u;
const CLOSE_PUNCTUATION = /^[\s,.;:!?)\]}'"”’。，、！？；：）》」』】]/u;

const needsInsertedSpace = (previous, next) => {
  if (!previous || !next) return false;
  if (OPEN_PUNCTUATION.test(previous) || CLOSE_PUNCTUATION.test(next)) return false;

  const previousChar = previous.at(-1);
  const nextChar = next.at(0);
  if (!previousChar || !nextChar) return false;
  if (CJK_CHAR.test(previousChar) || CJK_CHAR.test(nextChar)) return false;

  return true;
};

const joinPDFLine = (items) => {
  let line = "";
  for (const item of items) {
    const text = item.str ?? "";
    if (!text) continue;
    if (needsInsertedSpace(line, text)) line += " ";
    line += text;
  }
  return line.replace(/\s+/g, " ").trim();
};

const extractPageText = async (page) => {
  const textContent = await page.getTextContent();
  const lines = [];
  let currentLine = [];
  let currentY = null;
  const yTolerance = 2.5;

  const flushLine = () => {
    const line = joinPDFLine(currentLine);
    if (line) lines.push(line);
    currentLine = [];
    currentY = null;
  };

  for (const item of textContent.items ?? []) {
    if (!item?.str && !item?.hasEOL) continue;

    const y = item.transform?.[5];
    if (currentY != null && typeof y === "number" && Math.abs(y - currentY) > yTolerance) {
      flushLine();
    }

    if (typeof y === "number") currentY = y;
    currentLine.push(item);

    if (item.hasEOL) flushLine();
  }

  flushLine();
  return lines.join("\n").trim();
};

const createPageTextDocument = async (page, pageNumber) => {
  const text = await extractPageText(page);
  const doc = document.implementation.createHTMLDocument(`Page ${pageNumber}`);
  doc.documentElement.lang = "und";
  doc.body.textContent = text;
  return doc;
};

const fakePageCfi = (pageIndex) => `epubcfi(/6/${(pageIndex + 1) * 2})`;

const loadPDFFromFile = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  return pdfjsLib.getDocument({
    ...PDFJS_DOCUMENT_OPTIONS,
    data: new Uint8Array(arrayBuffer),
  }).promise;
};

const loadPDFFromURL = async (url) =>
  pdfjsLib.getDocument({
    ...PDFJS_DOCUMENT_OPTIONS,
    url,
    rangeChunkSize: 65536,
    disableAutoFetch: true,
    disableStream: false,
  }).promise;

const makeTOCItem = async (item, pdf) => {
  let pageIndex = undefined;
  if (item.dest) {
    try {
      const dest = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
      if (dest?.[0]) pageIndex = await pdf.getPageIndex(dest[0]);
    } catch (e) {
      console.warn("Failed to get page index for TOC item:", item.title, e);
    }
  }
  return {
    label: item.title,
    href: item.dest ? JSON.stringify(item.dest) : "",
    index: pageIndex,
    subitems: item.items?.length
      ? await Promise.all(item.items.map((i) => makeTOCItem(i, pdf)))
      : null,
  };
};

/**
 * Create a foliate-js compatible book object from a PDF file
 */
export const makePDF = async (file) => {
  const pdf = await loadPDFFromFile(file);
  return _buildPDFBook(pdf, file.name);
};

/**
 * Create a foliate-js compatible book object from a PDF URL with Range support.
 * pdf.js will use HTTP Range requests to lazily load pages on demand,
 * avoiding loading the entire file into memory upfront.
 */
export const makePDFFromURL = async (url, fileName) => {
  const pdf = await loadPDFFromURL(url);
  return _buildPDFBook(pdf, fileName);
};

export const extractPDFChapters = async (file, options = {}) => {
  const pdf = await loadPDFFromFile(file);
  const chapters = [];

  try {
    for (let i = 0; i < pdf.numPages; i++) {
      const pageNumber = i + 1;
      const page = await pdf.getPage(pageNumber);
      const text = await extractPageText(page);
      const normalized = text.replace(/\n{3,}/g, "\n\n").trim();
      options.onProgress?.({
        page: pageNumber,
        totalPages: pdf.numPages,
        textLength: normalized.length,
      });
      if (!normalized) continue;

      const cfi = fakePageCfi(i);
      chapters.push({
        index: i,
        title: `Page ${pageNumber}`,
        content: normalized,
        segments: [{ text: normalized, cfi }],
      });
    }
  } finally {
    await pdf.destroy();
  }

  return chapters;
};

async function _buildPDFBook(pdf, fileName) {
  const numPages = pdf.numPages;
  const firstPage = await pdf.getPage(1);
  const viewport = firstPage.getViewport({ scale: 1 });

  const book = { rendition: { layout: "pre-paginated" } };

  // Metadata
  const { metadata, info } = (await pdf.getMetadata()) ?? {};
  book.metadata = {
    title: metadata?.get?.("dc:title") ?? info?.Title ?? fileName?.replace(/\.pdf$/i, ""),
    author: metadata?.get?.("dc:creator") ?? info?.Author,
    contributor: metadata?.get?.("dc:contributor"),
    description: metadata?.get?.("dc:description") ?? info?.Subject,
    language: metadata?.get?.("dc:language"),
    publisher: metadata?.get?.("dc:publisher"),
    subject: metadata?.get?.("dc:subject"),
    identifier: metadata?.get?.("dc:identifier"),
    source: metadata?.get?.("dc:source"),
    rights: metadata?.get?.("dc:rights"),
  };

  // TOC
  const outline = await pdf.getOutline();
  book.toc = outline ? await Promise.all(outline.map((item) => makeTOCItem(item, pdf))) : null;

  // If no outline, create a simple page list
  if (!book.toc || book.toc.length === 0) {
    const step = Math.max(1, Math.floor(numPages / 20));
    book.toc = [];
    for (let i = 0; i < numPages; i += step) {
      book.toc.push({ label: `Page ${i + 1}`, href: JSON.stringify(i), index: i });
    }
  }

  // Sections - one per page
  const cache = new Map();
  const textDocumentCache = new Map();
  book.sections = Array.from({ length: numPages }, (_, i) => ({
    id: i,
    load: async () => {
      const cached = cache.get(i);
      if (cached) return cached;
      const result = await renderPage(await pdf.getPage(i + 1));
      cache.set(i, result);
      return result;
    },
    createDocument: async () => {
      const cached = textDocumentCache.get(i);
      if (cached) return cached.cloneNode(true);

      const doc = await createPageTextDocument(await pdf.getPage(i + 1), i + 1);
      textDocumentCache.set(i, doc);
      return doc.cloneNode(true);
    },
    size: 1000,
  }));

  // Rendition
  book.rendition.spread = "auto";
  book.rendition.viewport = { width: viewport.width, height: viewport.height };

  // Page list
  book.pageList = Array.from({ length: numPages }, (_, i) => ({
    label: `${i + 1}`,
    href: JSON.stringify(i),
  }));

  // Navigation
  book.isExternal = (uri) => /^\w+:/i.test(uri);
  book.resolveHref = async (href) => {
    try {
      const parsed = JSON.parse(href);
      if (typeof parsed === "number") return { index: parsed };
      const dest = typeof parsed === "string" ? await pdf.getDestination(parsed) : parsed;
      const index = await pdf.getPageIndex(dest[0]);
      return { index };
    } catch {
      return { index: 0 };
    }
  };
  book.splitTOCHref = async (href) => {
    if (!href) return [null, null];
    try {
      const parsed = JSON.parse(href);
      if (typeof parsed === "number") return [parsed, null];
      const dest = typeof parsed === "string" ? await pdf.getDestination(parsed) : parsed;
      const index = await pdf.getPageIndex(dest[0]);
      return [index, null];
    } catch {
      return [null, null];
    }
  };
  book.getTOCFragment = (doc) => doc.documentElement;
  book.getCover = async () => renderPageAsBlob(await pdf.getPage(1));
  book.destroy = () => pdf.destroy();

  return book;
}
