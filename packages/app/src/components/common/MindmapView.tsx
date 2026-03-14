import { useEffect, useRef, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";
import { Maximize2, Minimize2, Download, ZoomIn, ZoomOut } from "lucide-react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

interface MindmapViewProps {
  markdown: string;
  title?: string;
}

const transformer = new Transformer();

export function MindmapView({ markdown, title }: MindmapViewProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const fullscreenSvgRef = useRef<SVGSVGElement>(null);
  const markmapRef = useRef<Markmap | null>(null);
  const fullscreenMarkmapRef = useRef<Markmap | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [scale, setScale] = useState(1);
  const [showTooltip, setShowTooltip] = useState(false);

  const renderMap = useCallback(() => {
    if (!svgRef.current || !markdown) return;

    const { root } = transformer.transform(markdown);

    if (markmapRef.current) {
      markmapRef.current.setData(root);
      markmapRef.current.fit();
    } else {
      const mm = Markmap.create(svgRef.current, {
        autoFit: true,
        duration: 300,
        maxWidth: 300,
        paddingX: 16,
        zoom: false, // Disable built-in zoom to use custom controls
        pan: false,  // Disable built-in pan
        style: (id: string) => `
          .${id} {
            --markmap-text-color: #333;
            --markmap-code-bg: #f5f5f5;
            --markmap-code-color: #333;
            --markmap-circle-open-bg: #fff;
          }
          .${id} .markmap-foreign {
            color: #333;
          }
          .${id} .markmap-foreign a {
            color: #0066cc;
          }
          .${id} .markmap-foreign a:hover {
            color: #0052a3;
          }
          .${id} .markmap-foreign code {
            color: #333;
            background-color: #f5f5f5;
          }
        `,
      }, root);
      markmapRef.current = mm;
    }
  }, [markdown]);

  const renderFullscreenMap = useCallback(() => {
    if (!fullscreenSvgRef.current || !markdown || !expanded) return;

    const { root } = transformer.transform(markdown);

    if (fullscreenMarkmapRef.current) {
      fullscreenMarkmapRef.current.setData(root);
      setTimeout(() => fullscreenMarkmapRef.current?.fit(), 100);
    } else {
      const mm = Markmap.create(fullscreenSvgRef.current, {
        autoFit: true,
        duration: 300,
        maxWidth: 400,
        paddingX: 24,
        zoom: false, // Disable built-in zoom to use custom controls
        pan: false,  // Disable built-in pan
        style: (id: string) => `
          .${id} {
            --markmap-text-color: #333;
            --markmap-code-bg: #f5f5f5;
            --markmap-code-color: #333;
            --markmap-circle-open-bg: #fff;
          }
          .${id} .markmap-foreign {
            color: #333;
          }
          .${id} .markmap-foreign a {
            color: #0066cc;
          }
          .${id} .markmap-foreign a:hover {
            color: #0052a3;
          }
          .${id} .markmap-foreign code {
            color: #333;
            background-color: #f5f5f5;
          }
        `,
      }, root);
      fullscreenMarkmapRef.current = mm;
    }
  }, [markdown, expanded]);

  useEffect(() => {
    renderMap();
  }, [renderMap]);

  useEffect(() => {
    if (expanded) {
      setTimeout(renderFullscreenMap, 50);
    } else {
      fullscreenMarkmapRef.current = null;
    }
  }, [expanded, renderFullscreenMap]);

  useEffect(() => {
    if (!expanded) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setExpanded(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [expanded]);

  const handleDownload = useCallback(() => {
    const svgElement = expanded ? fullscreenSvgRef.current : svgRef.current;
    if (!svgElement) return;

    // Clone the SVG to modify it
    const clonedSvg = svgElement.cloneNode(true) as SVGSVGElement;
    
    // Get all markmap-node and markmap-foreign elements to calculate full content bounds
    const nodeElements = clonedSvg.querySelectorAll('.markmap-node, .markmap-foreign');
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    nodeElements.forEach((el) => {
      if (el instanceof SVGGraphicsElement) {
        try {
          const bbox = el.getBBox();
          const transform = el.getAttribute('transform');
          let x = bbox.x, y = bbox.y;
          
          // Parse transform to get actual position
          if (transform) {
            const translateMatch = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
            if (translateMatch) {
              x += parseFloat(translateMatch[1]);
              y += parseFloat(translateMatch[2]);
            }
          }
          
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x + bbox.width);
          maxY = Math.max(maxY, y + bbox.height);
        } catch (e) {
          // Ignore
        }
      }
    });
    
    // Also check all path elements (for links between nodes)
    const pathElements = clonedSvg.querySelectorAll('path');
    pathElements.forEach((el) => {
      if (el instanceof SVGGraphicsElement) {
        try {
          const bbox = el.getBBox();
          if (bbox.width > 0 && bbox.height > 0) {
            minX = Math.min(minX, bbox.x);
            minY = Math.min(minY, bbox.y);
            maxX = Math.max(maxX, bbox.x + bbox.width);
            maxY = Math.max(maxY, bbox.y + bbox.height);
          }
        } catch (e) {
          // Ignore
        }
      }
    });
    
    // Fallback to g element bbox if no nodes found
    if (minX === Infinity) {
      const gElement = clonedSvg.querySelector('g');
      if (gElement) {
        try {
          const bbox = gElement.getBBox();
          minX = bbox.x;
          minY = bbox.y;
          maxX = bbox.x + bbox.width;
          maxY = bbox.y + bbox.height;
        } catch (e) {
          minX = -500;
          minY = -500;
          maxX = 1500;
          maxY = 1000;
        }
      } else {
        minX = -500;
        minY = -500;
        maxX = 1500;
        maxY = 1000;
      }
    }
    
    // Add padding
    const padding = 30;
    const contentX = minX - padding;
    const contentY = minY - padding;
    const contentWidth = maxX - minX + padding * 2;
    const contentHeight = maxY - minY + padding * 2;
    
    // Reset transform on g element to show all content at original scale
    const gElement = clonedSvg.querySelector('g');
    if (gElement) {
      gElement.setAttribute('transform', 'translate(0,0) scale(1)');
    }
    
    // Set viewBox to fit all content
    clonedSvg.setAttribute('viewBox', `${contentX} ${contentY} ${contentWidth} ${contentHeight}`);
    clonedSvg.setAttribute('width', String(contentWidth));
    clonedSvg.setAttribute('height', String(contentHeight));
    
    // Remove any existing width/height styles
    clonedSvg.style.width = '';
    clonedSvg.style.height = '';
    
    // Add white background
    const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bgRect.setAttribute("x", String(contentX));
    bgRect.setAttribute("y", String(contentY));
    bgRect.setAttribute("width", String(contentWidth));
    bgRect.setAttribute("height", String(contentHeight));
    bgRect.setAttribute("fill", "white");
    clonedSvg.insertBefore(bgRect, clonedSvg.firstChild);
    
    // Add font styles and color overrides
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `
      .markmap {
        --markmap-text-color: #333 !important;
        --markmap-code-bg: #f5f5f5 !important;
        --markmap-code-color: #333 !important;
        --markmap-circle-open-bg: #fff !important;
      }
      .markmap-foreign {
        color: #333 !important;
      }
      text {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif !important;
        fill: #333 !important;
      }
    `;
    clonedSvg.insertBefore(style, clonedSvg.firstChild);

    let svgData = new XMLSerializer().serializeToString(clonedSvg);
    // Replace any remaining CSS variables with actual values
    svgData = svgData.replace(/var\(--foreground\)/g, '#333');
    svgData = svgData.replace(/var\(--background\)/g, '#fff');
    svgData = svgData.replace(/var\(--muted\)/g, '#f5f5f5');
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);

    const downloadLink = document.createElement("a");
    downloadLink.href = svgUrl;
    downloadLink.download = `${title || t("mindmap.title")}.svg`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(svgUrl);
    
    // Show success message
    toast.success(t("common.downloadSuccess", "图表已下载"));
  }, [expanded, title, t]);

  const handleZoomIn = useCallback(() => {
    const newScale = Math.min(scale + 0.2, 3);
    setScale(newScale);
    // Apply zoom using markmap's transform
    if (markmapRef.current) {
      const svg = markmapRef.current.svg;
      const g = svg.select('g');
      const currentTransform = g.attr('transform') || '';
      const translateMatch = currentTransform.match(/translate\(([^,]+),\s*([^)]+)\)/);
      if (translateMatch) {
        const x = parseFloat(translateMatch[1]);
        const y = parseFloat(translateMatch[2]);
        g.attr('transform', `translate(${x},${y}) scale(${newScale})`);
      }
    }
    if (fullscreenMarkmapRef.current) {
      const svg = fullscreenMarkmapRef.current.svg;
      const g = svg.select('g');
      const currentTransform = g.attr('transform') || '';
      const translateMatch = currentTransform.match(/translate\(([^,]+),\s*([^)]+)\)/);
      if (translateMatch) {
        const x = parseFloat(translateMatch[1]);
        const y = parseFloat(translateMatch[2]);
        g.attr('transform', `translate(${x},${y}) scale(${newScale})`);
      }
    }
  }, [scale]);

  const handleZoomOut = useCallback(() => {
    const newScale = Math.max(scale - 0.2, 0.3);
    setScale(newScale);
    // Apply zoom using markmap's transform
    if (markmapRef.current) {
      const svg = markmapRef.current.svg;
      const g = svg.select('g');
      const currentTransform = g.attr('transform') || '';
      const translateMatch = currentTransform.match(/translate\(([^,]+),\s*([^)]+)\)/);
      if (translateMatch) {
        const x = parseFloat(translateMatch[1]);
        const y = parseFloat(translateMatch[2]);
        g.attr('transform', `translate(${x},${y}) scale(${newScale})`);
      }
    }
    if (fullscreenMarkmapRef.current) {
      const svg = fullscreenMarkmapRef.current.svg;
      const g = svg.select('g');
      const currentTransform = g.attr('transform') || '';
      const translateMatch = currentTransform.match(/translate\(([^,]+),\s*([^)]+)\)/);
      if (translateMatch) {
        const x = parseFloat(translateMatch[1]);
        const y = parseFloat(translateMatch[2]);
        g.attr('transform', `translate(${x},${y}) scale(${newScale})`);
      }
    }
  }, [scale]);

  const handleResetZoom = useCallback(() => {
    setScale(1);
    markmapRef.current?.fit();
    fullscreenMarkmapRef.current?.fit();
  }, []);

  const displayTitle = title && title.length > 20 ? title.slice(0, 20) + "..." : title;

  const fullscreenOverlay = expanded
    ? createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setExpanded(false)}
            onKeyDown={() => {}}
          />
          <div className="relative z-10 m-4 flex h-[90vh] w-[90vw] max-w-6xl flex-col rounded-xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span
                className="text-base font-medium text-foreground cursor-default"
                title={title && title.length > 20 ? title : undefined}
              >
                {displayTitle || t("mindmap.title")}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleZoomOut}
                  className="rounded p-1.5 hover:bg-muted transition-colors"
                  title={t("common.zoomOut", "缩小")}
                >
                  <ZoomOut className="h-5 w-5 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  onClick={handleResetZoom}
                  className="text-xs text-muted-foreground min-w-[3rem] hover:text-foreground transition-colors"
                  title={t("common.resetZoom", "重置缩放")}
                >
                  {Math.round(scale * 100)}%
                </button>
                <button
                  type="button"
                  onClick={handleZoomIn}
                  className="rounded p-1.5 hover:bg-muted transition-colors"
                  title={t("common.zoomIn", "放大")}
                >
                  <ZoomIn className="h-5 w-5 text-muted-foreground" />
                </button>
                <div className="w-px h-5 bg-border mx-1" />
                <button
                  type="button"
                  onClick={handleDownload}
                  className="rounded p-1.5 hover:bg-muted transition-colors"
                  title={t("mindmap.download")}
                >
                  <Download className="h-5 w-5 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="rounded p-1.5 hover:bg-muted transition-colors"
                  title={t("mindmap.exitFullscreen")}
                >
                  <Minimize2 className="h-5 w-5 text-muted-foreground" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <svg
                ref={fullscreenSvgRef}
                className="w-full h-full"
                onDoubleClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <div className="relative rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span
            className="text-sm font-medium text-foreground cursor-default"
            title={title && title.length > 20 ? title : undefined}
          >
            {displayTitle || t("mindmap.title")}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleZoomOut}
              className="rounded p-1 hover:bg-muted transition-colors"
              title={t("common.zoomOut", "缩小")}
            >
              <ZoomOut className="h-4 w-4 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              className="text-xs text-muted-foreground min-w-[3rem] text-center hover:text-foreground transition-colors"
              title={t("common.resetZoom", "重置缩放")}
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              className="rounded p-1 hover:bg-muted transition-colors"
              title={t("common.zoomIn", "放大")}
            >
              <ZoomIn className="h-4 w-4 text-muted-foreground" />
            </button>
            <div className="w-px h-4 bg-border mx-1" />
            <button
              type="button"
              onClick={handleDownload}
              className="rounded p-1 hover:bg-muted transition-colors"
              title={t("mindmap.download")}
            >
              <Download className="h-4 w-4 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded p-1 hover:bg-muted transition-colors"
              title={t("mindmap.fullscreen")}
            >
              <Maximize2 className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        <div className="overflow-auto" style={{ height: 400 }}>
          <svg
            ref={svgRef}
            className="w-full h-full"
            onDoubleClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>

      {fullscreenOverlay}
    </>
  );
}
