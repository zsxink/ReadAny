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

// Inline text_layer_builder CSS
const TEXT_LAYER_CSS = `
.textLayer {
  position: absolute;
  text-align: initial;
  inset: 0;
  overflow: clip;
  opacity: 1;
  line-height: 1;
  -webkit-text-size-adjust: none;
  -moz-text-size-adjust: none;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  caret-color: CanvasText;
  z-index: 1;
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
.textLayer ::selection {
  background: rgba(0, 100, 255, 0.3);
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
[data-main-rotation="90"] { transform: rotate(90deg) translateY(-100%); }
[data-main-rotation="180"] { transform: rotate(180deg) translate(-100%, -100%); }
[data-main-rotation="270"] { transform: rotate(270deg) translateX(-100%); }
`;

const ANNOTATION_LAYER_CSS = `
.annotationLayer {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  transform-origin: 0 0;
}
.annotationLayer[data-main-rotation="90"] .norotate {
  transform: rotate(270deg) translateX(-100%);
}
.annotationLayer[data-main-rotation="180"] .norotate {
  transform: rotate(180deg) translate(-100%, -100%);
}
.annotationLayer[data-main-rotation="270"] .norotate {
  transform: rotate(90deg) translateY(-100%);
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

// iOS 的 WKWebView 原生长按选区在 transformed 的 PDF 文本层上可用，
// 因此自定义触摸选区只对非 iOS 平台生效。iOS / 桌面继续走原生选区。
const isIOS = () => {
  try {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
  } catch {
    return false;
  }
};

const getViewportScale = (viewport) => viewport.scale * viewport.userUnit;

const stabilizeLayerDimensions = (container, viewport) => {
  const totalScaleFactor = getViewportScale(viewport);
  const { pageWidth, pageHeight } = viewport.rawDims;
  Object.assign(container.style, {
    width: `${pageWidth * totalScaleFactor}px`,
    height: `${pageHeight * totalScaleFactor}px`,
  });
  container.dataset.mainRotation = String(viewport.rotation);
};

const applyPDFPageScale = (doc, viewport) => {
  const page = doc.querySelector("#page");
  const scaleValue = String(getViewportScale(viewport));
  for (const element of [
    doc.documentElement,
    doc.body,
    page,
    doc.querySelector(".textLayer"),
    doc.querySelector(".annotationLayer"),
  ]) {
    if (!element) continue;
    element.style.setProperty("--user-unit", "1");
    element.style.setProperty("--total-scale-factor", scaleValue);
    element.style.setProperty("--scale-round-x", "1px");
    element.style.setProperty("--scale-round-y", "1px");
  }

  if (page) {
    Object.assign(page.style, {
      width: `${viewport.width}px`,
      height: `${viewport.height}px`,
    });
  }
};

const measureMinimumFontSize = (doc) => {
  const probe = doc.createElement("div");
  Object.assign(probe.style, {
    opacity: "0",
    lineHeight: "1",
    fontSize: "1px",
    position: "absolute",
    pointerEvents: "none",
  });
  probe.textContent = "X";
  doc.body.append(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(height) && height > 0 ? height : 1;
};

const stabilizeTextLayerGeometry = (container, viewport) => {
  const minimumFontSize = measureMinimumFontSize(container.ownerDocument);
  const totalScaleFactor = getViewportScale(viewport);

  container.style.setProperty("--min-font-size", String(minimumFontSize));
  stabilizeLayerDimensions(container, viewport);

  for (const span of container.querySelectorAll("span")) {
    const fontHeight = Number.parseFloat(span.style.getPropertyValue("--font-height"));
    if (!Number.isFinite(fontHeight) || fontHeight <= 0) continue;

    const rawScaleX = Number.parseFloat(span.style.getPropertyValue("--scale-x"));
    const scaleX = Number.isFinite(rawScaleX) && rawScaleX > 0 ? rawScaleX : 1;
    const rotate = span.style.getPropertyValue("--rotate") || "0deg";

    // PDF.js 5 uses CSS typed multiplication/division for this calculation.
    // Resolve it to ordinary numeric CSS for older Android WebViews, and measure
    // the minimum font size in the iframe where the text actually renders.
    span.style.fontSize = `${fontHeight * totalScaleFactor * minimumFontSize}px`;
    span.style.transform = `rotate(${rotate}) scaleX(${scaleX}) scale(${1 / minimumFontSize})`;
  }
};

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
 * Render canvas + text layer + annotation layer for a PDF page inside an iframe document.
 * Called on initial load and on every zoom change.
 */
const render = async (page, doc, zoom) => {
  if (!doc) return;

  const previousRender = doc.__readanyPdfRenderState;
  previousRender?.canvasTask?.cancel();
  previousRender?.textLayer?.cancel();
  doc.__readanyPdfTextSelectionAbortController?.abort();

  const renderState = { canvasTask: null, textLayer: null };
  doc.__readanyPdfRenderState = renderState;
  const isCurrentRender = () => doc.__readanyPdfRenderState === renderState;

  const scale = zoom;
  const outputScale = globalThis.devicePixelRatio || 1;

  doc.documentElement.style.removeProperty("transform");
  doc.documentElement.style.removeProperty("transform-origin");

  const viewport = page.getViewport({ scale });
  applyPDFPageScale(doc, viewport);

  // Render canvas (in main document for font loading, then adopt into iframe)
  const canvas = document.createElement("canvas");
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  const canvasContext = canvas.getContext("2d");
  const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
  const canvasTask = page.render({ canvasContext, transform, viewport });
  renderState.canvasTask = canvasTask;
  try {
    await canvasTask.promise;
  } catch (error) {
    if (!isCurrentRender() || error instanceof pdfjsLib.RenderingCancelledException) return;
    throw error;
  } finally {
    renderState.canvasTask = null;
  }
  if (!isCurrentRender()) return;

  const canvasContainer = doc.querySelector("#canvas");
  if (!canvasContainer) return;
  canvasContainer.replaceChildren(doc.adoptNode(canvas));

  // Render text layer
  const textContainer = doc.querySelector(".textLayer");
  if (textContainer) {
    textContainer.replaceChildren();
    try {
      const textContentSource = await page.streamTextContent({
        includeMarkedContent: true,
        disableNormalization: true,
      });
      if (!isCurrentRender()) return;

      const textLayer = new pdfjsLib.TextLayer({
        textContentSource,
        container: textContainer,
        viewport,
      });
      renderState.textLayer = textLayer;
      await textLayer.render();
      renderState.textLayer = null;
      if (!isCurrentRender()) return;
      stabilizeTextLayerGeometry(textContainer, viewport);
    } catch (error) {
      renderState.textLayer = null;
      if (!isCurrentRender() || error instanceof pdfjsLib.AbortException) return;
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

    doc.__readanyPdfTextSelectionAbortController?.abort();
    const selectionAbortController = new AbortController();
    doc.__readanyPdfTextSelectionAbortController = selectionAbortController;
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
        while (anchor && anchor !== textContainer && !anchor.previousSibling) {
          anchor = anchor.parentNode;
        }
        if (anchor?.previousSibling) anchor = anchor.previousSibling;
      }

      const parentTextLayer = anchor?.parentElement?.closest(".textLayer");
      if (parentTextLayer === textContainer && anchor.parentElement) {
        endOfContent.style.width = `${Math.ceil(viewport.width)}px`;
        endOfContent.style.height = `${Math.ceil(viewport.height)}px`;
        endOfContent.style.userSelect = "text";
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

    // Panning + text selection cursor logic
    let isPanning = false;
    let startX = 0;
    let startY = 0;
    let scrollLeft = 0;
    let scrollTop = 0;
    let scrollParent = null;

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

    textContainer.onpointerdown = (e) => {
      const selection = doc.getSelection();
      const hasTextSelection = selection && selection.toString().length > 0;
      // 优先用事件目标（Blink 内部命中，比 elementFromPoint 可靠），
      // 未命中再用 elementFromPoint 兜底（保留桌面精确行为）
      let hasTextUnderneath = false;
      const targetEl = e.target?.closest?.(".textLayer span, .textLayer p");
      if (targetEl && targetEl.textContent.trim().length > 0) {
        hasTextUnderneath = true;
      } else {
        const elementUnderCursor = doc.elementFromPoint(e.clientX, e.clientY);
        hasTextUnderneath =
          elementUnderCursor &&
          (elementUnderCursor.tagName === "SPAN" || elementUnderCursor.tagName === "P") &&
          elementUnderCursor.textContent.trim().length > 0;
      }

      // 触摸设备：从不主动进入平移模式，交给浏览器原生触摸选区
      const isTouch = e.pointerType === "touch";

      if (!hasTextUnderneath && !hasTextSelection && !isTouch) {
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
        }
      } else {
        textContainer.classList.add("selecting");
      }
    };

    textContainer.onpointermove = (e) => {
      if (isPanning && scrollParent && e.pointerType !== "touch") {
        e.preventDefault();
        const dx = e.screenX - startX;
        const dy = e.screenY - startY;
        if (scrollParent === window) window.scrollTo(scrollLeft - dx, scrollTop - dy);
        else {
          scrollParent.scrollLeft = scrollLeft - dx;
          scrollParent.scrollTop = scrollTop - dy;
        }
      }
    };

    textContainer.onpointerup = () => {
      if (isPanning) {
        isPanning = false;
        scrollParent = null;
        textContainer.style.cursor = "grab";
      } else resetEndOfContent();
    };

    textContainer.onpointerleave = () => {
      if (isPanning) {
        isPanning = false;
        scrollParent = null;
        textContainer.style.cursor = "grab";
      }
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

    // ─── Android 自定义触摸选区（绕过原生选区无法发起的根因） ───
    // Android WebView 的原生长按选区引擎无法在「transform + position:absolute」
    // 的逐字 span 上发起选区；此处改为用触摸坐标程序化构造 Range。
    // 仅对非 iOS 的 touch 生效，iOS / 桌面仍走原生；监听挂在已有的 { signal }
    // 上，重渲染时随 AbortController 自动卸载。
    if (!isIOS()) {
      const SELECTION_DRAG_THRESHOLD = 6;

      // 触摸坐标 → 字符位置：遍历 span，取包含该点者按 x 比例算偏移；
      // 无包含点时取最近 span，按左右侧钳到 0 / len。
      const pointToPosition = (point) => {
        const spans = textContainer.querySelectorAll("span");
        let nearest = null;
        let nearestDist = Infinity;
        for (const span of spans) {
          if (span.getAttribute("role") === "img") continue;
          if (span.closest(".endOfContent")) continue;
          const textNode = span.firstChild;
          if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;
          const textContent = textNode.nodeValue || "";
          if (textContent.length === 0) continue;
          const rect = span.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          if (
            point.x >= rect.left &&
            point.x <= rect.right &&
            point.y >= rect.top &&
            point.y <= rect.bottom
          ) {
            const offset = Math.max(
              0,
              Math.min(
                textContent.length,
                Math.round(((point.x - rect.left) / rect.width) * textContent.length),
              ),
            );
            return { node: textNode, offset };
          }
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const dist = (point.x - centerX) ** 2 + (point.y - centerY) ** 2;
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = {
              node: textNode,
              offset: point.x < centerX ? 0 : textContent.length,
            };
          }
        }
        return nearest;
      };

      // 把锚点/焦点按 DOM 顺序归一化（compareDocumentPosition 处理跨 span）
      const normalizeBoundaryOrder = (a, b) => {
        if (a.node === b.node) {
          return a.offset <= b.offset ? [a, b] : [b, a];
        }
        const relation = a.node.compareDocumentPosition(b.node);
        if (relation & Node.DOCUMENT_POSITION_PRECEDING) return [b, a];
        return [a, b];
      };

      let anchorPosition = null;
      let anchorPoint = null;
      let isSelecting = false;

      textContainer.addEventListener(
        "touchstart",
        (event) => {
          const touch = event.touches[0];
          if (!touch) return;
          if (!event.target.closest(".textLayer")) return;
          anchorPosition = pointToPosition({ x: touch.clientX, y: touch.clientY });
          anchorPoint = { x: touch.clientX, y: touch.clientY };
          isSelecting = false;
        },
        { passive: false, signal },
      );

      textContainer.addEventListener(
        "touchmove",
        (event) => {
          if (!anchorPosition) return;
          const touch = event.touches[0];
          if (!touch) return;
          if (!isSelecting) {
            const dx = touch.clientX - anchorPoint.x;
            const dy = touch.clientY - anchorPoint.y;
            if (Math.hypot(dx, dy) < SELECTION_DRAG_THRESHOLD) return;
            isSelecting = true;
          }
          // 进入选词：阻止页面滚动 / 橡皮筋
          event.preventDefault();
          const focusPosition = pointToPosition({ x: touch.clientX, y: touch.clientY });
          if (!focusPosition) return;
          const [start, end] = normalizeBoundaryOrder(anchorPosition, focusPosition);
          const range = doc.createRange();
          range.setStart(start.node, start.offset);
          range.setEnd(end.node, end.offset);
          const selection = doc.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          // 程序化 addRange 触发原生 ::selection 高亮 + selectionchange →
          // 模板 attachSelectionListener 自动 postToRN('selection', …) 给 RN。
        },
        { passive: false, signal },
      );

      const finishCustomSelection = () => {
        if (!isSelecting) {
          // 只是点一下（未进入选词）：清除 textLayer 内选区
          doc.getSelection()?.removeAllRanges();
        } else {
          const selection = doc.getSelection();
          if (selection && selection.toString().length > 0) {
            textContainer.classList.add("selecting");
          } else {
            selection?.removeAllRanges();
          }
        }
        anchorPosition = null;
        anchorPoint = null;
        isSelecting = false;
      };

      textContainer.addEventListener("touchend", finishCustomSelection, { passive: true, signal });
      textContainer.addEventListener("touchcancel", finishCustomSelection, { passive: true, signal });
    }

    textContainer.style.cursor = "grab";
  }

  // Render annotation layer (links etc.)
  const annotationDiv = doc.querySelector(".annotationLayer");
  if (annotationDiv) {
    annotationDiv.replaceChildren();
    Object.assign(annotationDiv.style, {
      width: `${viewport.width}px`,
      height: `${viewport.height}px`,
    });
    const linkService = {
      goToDestination: () => {},
      getDestinationHash: (dest) => JSON.stringify(dest),
      addLinkAttributes: (link, url) => {
        link.href = url;
      },
    };
    try {
      const annotations = await page.getAnnotations();
      if (!isCurrentRender()) return;
      await new pdfjsLib.AnnotationLayer({
        page,
        viewport: viewport.clone({ dontFlip: true }),
        div: annotationDiv,
        linkService,
      }).render({ annotations });
      if (!isCurrentRender()) return;
      stabilizeLayerDimensions(annotationDiv, viewport);
    } catch {
      // Annotation rendering may fail for some pages
    }
  }
};

/**
 * Render a single PDF page and return src/onZoom for the fixed-layout renderer.
 */
const renderPage = async (page) => {
  const viewport = page.getViewport({ scale: 1 });

  const data = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${viewport.width}, height=${viewport.height}, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  -webkit-text-size-adjust: none;
  -moz-text-size-adjust: none;
  text-size-adjust: none;
}
body {
  position: relative;
  background: transparent;
}
#page {
  position: relative;
  width: ${viewport.width}px;
  height: ${viewport.height}px;
  overflow: hidden;
  direction: ltr;
  --user-unit: 1;
  --total-scale-factor: 1;
  --scale-round-x: 1px;
  --scale-round-y: 1px;
}
#canvas {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
}
#canvas canvas {
  position: absolute;
  inset: 0;
  display: block;
  margin: 0;
  contain: content;
}
.annotationLayer {
  z-index: 2;
}
${TEXT_LAYER_CSS}
${ANNOTATION_LAYER_CSS}
</style>
</head>
<body>
<div id="page">
  <div id="canvas"></div>
  <div class="textLayer"></div>
  <div class="annotationLayer"></div>
</div>
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
