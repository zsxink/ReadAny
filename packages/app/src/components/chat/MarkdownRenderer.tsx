/**
 * MarkdownRenderer — renders AI markdown responses with:
 * - GitHub Flavored Markdown (tables, strikethrough, task lists, autolinks)
 * - Syntax-highlighted code blocks via rehype-highlight
 * - Mermaid diagrams via beautiful-mermaid (synchronous SVG rendering)
 */
import { renderMermaidSVG } from "beautiful-mermaid";
import { Check, Copy, ArrowUpRight, Download, Maximize2, Minimize2, ZoomIn, ZoomOut } from "lucide-react";
import React, { useMemo, useState, useRef } from "react";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { CitationPart } from "@readany/core/types/message";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";

/** Mermaid code block — renders synchronously, zero-flash */
function MermaidBlock({ code }: { code: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [scale, setScale] = useState(1);
  const svgRef = useRef<HTMLDivElement>(null);
  
  const { svg, error } = useMemo(() => {
    try {
      return {
        svg: renderMermaidSVG(code, {
          bg: "var(--background)",
          fg: "var(--foreground)",
          transparent: true,
        }),
        error: null,
      };
    } catch (err) {
      return { svg: null, error: err instanceof Error ? err : new Error(String(err)) };
    }
  }, [code]);

  const handleDownload = () => {
    const svgElement = svgRef.current?.querySelector("svg");
    if (!svgElement) return;

    const svgData = new XMLSerializer().serializeToString(svgElement);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);

    const downloadLink = document.createElement("a");
    downloadLink.href = svgUrl;
    downloadLink.download = `diagram-${Date.now()}.svg`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(svgUrl);
  };

  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.2, 3));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - 0.2, 0.3));
  };

  if (error) {
    return (
      <pre className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
        {error.message}
      </pre>
    );
  }

  const fullscreenOverlay = expanded
    ? createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setExpanded(false)}
          />
          <div className="relative z-10 m-4 max-h-[90vh] max-w-[90vw] overflow-auto rounded-lg border bg-background p-4 shadow-lg">
            <div className="absolute right-2 top-2 flex gap-1 bg-background/80 rounded-md p-1">
              <button
                type="button"
                onClick={handleZoomOut}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={t("common.zoomOut", "缩小")}
              >
                <ZoomOut className="size-4" />
              </button>
              <span className="flex items-center text-xs text-muted-foreground min-w-[3rem] justify-center">
                {Math.round(scale * 100)}%
              </span>
              <button
                type="button"
                onClick={handleZoomIn}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={t("common.zoomIn", "放大")}
              >
                <ZoomIn className="size-4" />
              </button>
              <div className="w-px h-4 bg-border mx-1 self-center" />
              <button
                type="button"
                onClick={handleDownload}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={t("mindmap.download", "下载")}
              >
                <Download className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={t("common.collapse", "收起")}
              >
                <Minimize2 className="size-4" />
              </button>
            </div>
            <div
              style={{
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
              dangerouslySetInnerHTML={{ __html: svg! }}
            />
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <div className="group relative">
        <div
          ref={svgRef}
          className="my-3 flex justify-center overflow-auto rounded-lg border bg-muted/30 p-4"
          style={{ maxHeight: 400 }}
        >
          <div
            style={{
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              minWidth: scale < 1 ? "100%" : undefined,
            }}
            dangerouslySetInnerHTML={{ __html: svg! }}
          />
        </div>
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={handleZoomOut}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={t("common.zoomOut", "缩小")}
          >
            <ZoomOut className="size-4" />
          </button>
          <span className="flex items-center text-xs text-muted-foreground min-w-[3rem] justify-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={handleZoomIn}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={t("common.zoomIn", "放大")}
          >
            <ZoomIn className="size-4" />
          </button>
          <div className="w-px h-4 bg-border mx-1 self-center" />
          <button
            type="button"
            onClick={handleDownload}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={t("mindmap.download", "下载")}
          >
            <Download className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={t("common.expand", "放大")}
          >
            <Maximize2 className="size-4" />
          </button>
        </div>
      </div>
      {fullscreenOverlay}
    </>
  );
}

/** Copy button for code blocks */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover/code:opacity-100"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isStreaming?: boolean;
  citations?: CitationPart[];
  onCitationClick?: (citation: CitationPart) => void;
}

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

/** Process text children to find and replace [1], [2] citations with clickable links */
function processCitationText(
  children: React.ReactNode,
  citations?: CitationPart[],
  onCitationClick?: (citation: CitationPart) => void
): React.ReactNode {
  if (!citations || citations.length === 0) {
    return children;
  }

  return React.Children.map(children, (child) => {
    if (typeof child === "string") {
      // Split on [1], [2] patterns
      const parts = child.split(/(\[\d+\])/g);
      return parts.map((part, i) => {
        const match = part.match(/\[(\d+)\]/);
        if (match) {
          const num = parseInt(match[1]);
          // Look up by explicit citationIndex first, fall back to array position
          const citation = citations.find(c => c.citationIndex === num) ?? citations[num - 1];
          if (citation) {
            return (
              <button
                key={i}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onCitationClick?.(citation);
                }}
                className="inline-flex items-baseline text-primary hover:text-primary/80 font-semibold text-[0.7em] align-super cursor-pointer border-none bg-transparent p-0 mx-0.5 transition-colors"
                title={`${citation.chapterTitle}: ${citation.text.slice(0, 50)}${citation.text.length > 50 ? "..." : ""}`}
              >
                [{num}]
                <ArrowUpRight className="inline h-2.5 w-2.5 ml-0.5" />
              </button>
            );
          }
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      });
    }
    return child;
  });
}

/** Create markdown components with citation processing */
function createMdComponents(
  citations?: CitationPart[],
  onCitationClick?: (citation: CitationPart) => void
) {
  return {
  // Code blocks: mermaid → diagram, others → highlighted with copy button
  code({
    className: codeClassName,
    children,
    ...props
  }: React.ComponentProps<"code">) {
    const text = String(children).replace(/\n$/, "");
    const langMatch = /language-(\w+)/.exec(codeClassName || "");
    const lang = langMatch?.[1];

    // Inline code (no language class, no newlines)
    if (!lang && !text.includes("\n")) {
      return (
        <code
          className="rounded-md bg-muted px-1.5 py-0.5 text-[0.85em] font-mono"
          {...props}
        >
          {children}
        </code>
      );
    }

    // Mermaid diagram
    if (lang === "mermaid") {
      // mermaid mindmap syntax is not supported by beautiful-mermaid,
      // render as a styled code block instead of crashing
      if (text.trim().startsWith("mindmap")) {
        return (
          <div className="group/code relative">
            <div className="absolute left-3 top-0 z-10 rounded-b-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              mindmap
            </div>
            <CopyButton text={text} />
            <pre className="!mt-0 !mb-0 rounded-lg border bg-muted/30 p-4">
              <code className="text-sm">{text}</code>
            </pre>
          </div>
        );
      }
      return <MermaidBlock code={text} />;
    }

    // Regular code block with copy button
    return (
      <div className="group/code relative">
        {lang && (
          <div className="absolute left-3 top-0 z-10 rounded-b-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {lang}
          </div>
        )}
        <CopyButton text={text} />
        <pre className="!mt-0 !mb-0">
          <code className={codeClassName} {...props}>
            {children}
          </code>
        </pre>
      </div>
    );
  },

  // Links open externally
  a({ href, children, ...props }: React.ComponentProps<"a">) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary/60"
        {...props}
      >
        {children}
      </a>
    );
  },

  // Tables
  table({ children, ...props }: React.ComponentProps<"table">) {
    return (
      <div className="my-3 overflow-x-auto rounded-lg border">
        <table className="min-w-full" {...props}>
          {children}
        </table>
      </div>
    );
  },
  th({ children, ...props }: React.ComponentProps<"th">) {
    return (
      <th className="bg-muted/50 px-3 py-2 text-left text-xs font-semibold" {...props}>
        {processCitationText(children, citations, onCitationClick)}
      </th>
    );
  },
  td({ children, ...props }: React.ComponentProps<"td">) {
    return (
      <td className="border-t px-3 py-2 text-sm" {...props}>
        {processCitationText(children, citations, onCitationClick)}
      </td>
    );
  },

  // Text-containing elements with citation processing
  p({ children, ...props }: React.ComponentProps<"p">) {
    return <p {...props}>{processCitationText(children, citations, onCitationClick)}</p>;
  },
  li({ children, ...props }: React.ComponentProps<"li">) {
    return <li {...props}>{processCitationText(children, citations, onCitationClick)}</li>;
  },
  strong({ children, ...props }: React.ComponentProps<"strong">) {
    return <strong {...props}>{processCitationText(children, citations, onCitationClick)}</strong>;
  },
  em({ children, ...props }: React.ComponentProps<"em">) {
    return <em {...props}>{processCitationText(children, citations, onCitationClick)}</em>;
  },
  blockquote({ children, ...props }: React.ComponentProps<"blockquote">) {
    return (
      <blockquote {...props}>{processCitationText(children, citations, onCitationClick)}</blockquote>
    );
  },
  h1({ children, ...props }: React.ComponentProps<"h1">) {
    return <h1 {...props}>{processCitationText(children, citations, onCitationClick)}</h1>;
  },
  h2({ children, ...props }: React.ComponentProps<"h2">) {
    return <h2 {...props}>{processCitationText(children, citations, onCitationClick)}</h2>;
  },
  h3({ children, ...props }: React.ComponentProps<"h3">) {
    return <h3 {...props}>{processCitationText(children, citations, onCitationClick)}</h3>;
  },
  h4({ children, ...props }: React.ComponentProps<"h4">) {
    return <h4 {...props}>{processCitationText(children, citations, onCitationClick)}</h4>;
  },
  h5({ children, ...props }: React.ComponentProps<"h5">) {
    return <h5 {...props}>{processCitationText(children, citations, onCitationClick)}</h5>;
  },
  h6({ children, ...props }: React.ComponentProps<"h6">) {
    return <h6 {...props}>{processCitationText(children, citations, onCitationClick)}</h6>;
  },
  };
}

let mdStreamIdCounter = 0;

export const MarkdownRenderer = React.memo(function MarkdownRenderer({
  content,
  className,
  isStreaming,
  citations,
  onCitationClick,
}: MarkdownRendererProps) {
  // Stable unique id per instance so the streaming cursor CSS is scoped
  const scopeId = useMemo(() => `md-stream-${++mdStreamIdCounter}`, []);

  // Create markdown components with citation processing
  const mdComponents = useMemo(
    () => createMdComponents(citations, onCitationClick),
    [citations, onCitationClick]
  );

  // Append a unicode cursor placeholder that we style via CSS when streaming.
  // This keeps the cursor inline with the last text rather than on a new line.
  const displayContent = isStreaming ? `${content}\u200B` : content;

  return (
    <div className={className} data-md-scope={isStreaming ? scopeId : undefined}>
      <Markdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={mdComponents}
      >
        {displayContent}
      </Markdown>
      {isStreaming && (
        <style>{`
          [data-md-scope="${scopeId}"] > *:last-child::after {
            content: "";
            display: inline-block;
            width: 3px;
            height: 1em;
            background: var(--primary);
            border-radius: 1px;
            margin-left: 2px;
            vertical-align: text-bottom;
            animation: cursor-blink 1s step-end infinite;
          }
          @keyframes cursor-blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0; }
          }
        `}</style>
      )}
    </div>
  );
});
