import { ChatPanel } from "@/components/chat/ChatPanel";
/**
 * ReaderView — main reader page component.
 *
 * Refactored architecture (reference: Readest):
 * 1. File → DocumentLoader.open() → BookDoc (in-memory)
 * 2. BookDoc → FoliateViewer (React component)
 * 3. FoliateViewer → <foliate-view> (Web Component)
 *
 * ReaderView is responsible for:
 * - Loading the book file from disk (via Tauri)
 * - Pre-parsing it with DocumentLoader
 * - Managing reading state (progress, location, selection)
 * - Rendering the FoliateViewer and surrounding UI (toolbar, footer, panels)
 */
import { ReadSettingsPanel } from "@/components/settings/ReadSettings";
import { useReadingSession } from "@/hooks/use-reading-session";
import { useResolvedSrc } from "@/hooks/use-resolved-src";
import { useResizablePanel } from "@/hooks/use-resizable-panel";
import { DocumentLoader } from "@/lib/reader/document-loader";
import type { BookDoc, BookFormat } from "@/lib/reader/document-loader";
import { isFixedLayoutFormat } from "@/lib/reader/document-loader";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useAppStore } from "@/stores/app-store";
import { useLibraryStore } from "@/stores/library-store";
import { useNotebookStore } from "@/stores/notebook-store";
import { useReaderStore } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useTTSStore } from "@/stores/tts-store";
import { resolveDesktopDataPath } from "@/lib/storage/desktop-library-root";
import type { CitationPart, HighlightColor } from "@readany/core/types";
import { eventBus } from "@readany/core/utils/event-bus";
import { throttle } from "@readany/core/utils/throttle";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BookSelection, FoliateViewerHandle, RelocateDetail, TOCItem } from "./FoliateViewer";
import { FoliateViewer } from "./FoliateViewer";
import { FooterBar } from "./FooterBar";
import { BookmarkRibbon } from "./BookmarkRibbon";
import { NotebookPanel } from "./NotebookPanel";
import { ReaderToolbar } from "./ReaderToolbar";
import { ResizeHandle } from "./ResizeHandle";
import { SearchBar } from "./SearchBar";
import { SelectionPopover } from "./SelectionPopover";
import { TOCPanel } from "./TOCPanel";
import { TranslationPopover } from "./TranslationPopover";
import { TTSPage } from "./TTSPage";
import { useChapterTranslation } from "@readany/core/hooks";

// --- Tauri file loading ---
async function loadFileAsBlob(filePath: string): Promise<Blob> {
  // Resolve relative paths (e.g., "books/{id}.epub") to absolute paths
  let resolvedPath = filePath;
  if (
    !filePath.startsWith("/") &&
    !filePath.startsWith("file://") &&
    !filePath.startsWith("asset://") &&
    !filePath.startsWith("http")
  ) {
    resolvedPath = await resolveDesktopDataPath(filePath);
  }

  try {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    const assetUrl = convertFileSrc(resolvedPath);
    const response = await fetch(assetUrl);
    if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
    return await response.blob();
  } catch {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const fileBytes = await readFile(resolvedPath);
    return new Blob([fileBytes]);
  }
}

// --- Blob cache ---
const fileBlobCache = new Map<string, Blob>();
const MAX_CACHE_SIZE = 5;

/** Remove a specific file from the blob cache (called on tab close / hibernate) */
export function evictBlobCache(filePath: string): void {
  fileBlobCache.delete(filePath);
}

/** Clear all entries from the blob cache */
export function clearBlobCache(): void {
  fileBlobCache.clear();
}

async function getCachedBlob(filePath: string): Promise<Blob> {
  const cached = fileBlobCache.get(filePath);
  if (cached) return cached;

  const blob = await loadFileAsBlob(filePath);

  if (fileBlobCache.size >= MAX_CACHE_SIZE) {
    const firstKey = fileBlobCache.keys().next().value;
    if (firstKey) fileBlobCache.delete(firstKey);
  }
  fileBlobCache.set(filePath, blob);
  return blob;
}

/**
 * Load a book file from disk and parse it with DocumentLoader.
 * Returns both the BookDoc and detected format.
 */
async function loadAndParseBook(
  filePath: string,
): Promise<{ bookDoc: BookDoc; format: BookFormat }> {
  console.log("[loadAndParseBook] start, filePath:", filePath);
  const blob = await getCachedBlob(filePath);
  console.log("[loadAndParseBook] blob loaded, size:", blob.size);

  const fileName = filePath.split("/").pop() || "book.epub";
  const file = new File([blob], fileName, {
    type: blob.type || "application/octet-stream",
  });

  const loader = new DocumentLoader(file);
  const { book, format } = await loader.open();
  console.log("[loadAndParseBook] parsed, format:", format, "sections:", book.sections?.length);
  return { bookDoc: book, format };
}

// --- Auto-hide controls hook ---
// Strategy:
// - Toolbar/FooterBar each have an invisible hover trigger zone (onMouseEnter → show)
// - Inside iframe: any single-click toggles visibility (no coordinate conversion needed)
// - Tauri's window.screenX is unreliable, so we avoid screen-to-page coord mapping
// - When clicking inside a selection, the click is not forwarded (handled in iframe-event-handlers)

function useAutoHideControls(
  containerRef: React.RefObject<HTMLDivElement | null>,
  delay = 2000,
  keepVisible = false,
) {
  const [isVisible, setIsVisible] = useState(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoveringRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const hideAfterDelay = useCallback(() => {
    if (keepVisible || isHoveringRef.current) return;
    clearTimer();
    timeoutRef.current = setTimeout(() => setIsVisible(false), delay);
  }, [clearTimer, delay, keepVisible]);

  const showAndScheduleHide = useCallback(() => {
    setIsVisible(true);
    hideAfterDelay();
  }, [hideAfterDelay]);

  // Listen for iframe events
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!containerRef.current) return;

      // Handle single-click toggle
      if (data?.type !== "iframe-single-click") return;

      console.log("[ReaderView] received iframe-single-click, current isVisible:");

      setIsVisible((prev) => {
        console.log("[ReaderView] prev:", prev, "-> new:", !prev);
        if (prev) {
          clearTimer();
          return false;
        }
        showAndScheduleHide();
        return true;
      });
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [containerRef, clearTimer, showAndScheduleHide]);

  // Mouse enter/leave handlers for toolbar area
  const handleMouseEnter = useCallback(() => {
    isHoveringRef.current = true;
    clearTimer();
    setIsVisible(true);
  }, [clearTimer]);

  const handleMouseLeave = useCallback(() => {
    isHoveringRef.current = false;
    hideAfterDelay();
  }, [hideAfterDelay]);

  useEffect(() => {
    hideAfterDelay();
    return () => clearTimer();
  }, [hideAfterDelay, clearTimer]);

  useEffect(() => {
    if (keepVisible) {
      setIsVisible(true);
    } else {
      hideAfterDelay();
    }
  }, [keepVisible, hideAfterDelay]);

  return { isVisible, handleMouseEnter, handleMouseLeave };
}

// --- Main component ---

interface ReaderViewProps {
  bookId: string;
  tabId: string;
}

export function ReaderView({ bookId, tabId }: ReaderViewProps) {
  const TOOLBAR_PIN_STORAGE_KEY = "readany-reader-toolbar-pinned";
  const readerTab = useReaderStore((s) => s.tabs[tabId]);
  const appTab = useAppStore((s) => s.tabs.find((t) => t.id === tabId));
  const viewSettings = useSettingsStore((s) => s.readSettings);
  const updateReadSettings = useSettingsStore((s) => s.updateReadSettings);
  const setProgress = useReaderStore((s) => s.setProgress);
  const setChapter = useReaderStore((s) => s.setChapter);
  const setSelectedText = useReaderStore((s) => s.setSelectedText);
  const pushHistory = useReaderStore((s) => s.pushHistory);

  const books = useLibraryStore((s) => s.books);
  const updateBook = useLibraryStore((s) => s.updateBook);
  const book = books.find((b) => b.id === bookId);

  const highlights = useAnnotationStore((s) => s.highlights);
  const bookmarks = useAnnotationStore((s) => s.bookmarks);
  const loadAnnotations = useAnnotationStore((s) => s.loadAnnotations);

  const isBookmarked = bookmarks.some(
    (b) => b.bookId === bookId && b.cfi === readerTab?.currentCfi,
  );

  // Track reading session for statistics
  useReadingSession(bookId, tabId);

  // Ref to FoliateViewer imperative handle
  const foliateRef = useRef<FoliateViewerHandle>(null);

  // Current section index for chapter translation
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);

  // Track when foliate is ready to receive annotations
  const [foliateReady, setFoliateReady] = useState(false);
  // Separate delayed ready for chapter translation (avoids DOM conflict with CFI navigation)
  const [translationReady, setTranslationReady] = useState(false);

  // Chapter translation hook
  const chapterTranslation = useChapterTranslation({
    bookId,
    sectionIndex: currentSectionIndex,
    ready: translationReady,
    getParagraphs: () => foliateRef.current?.getChapterParagraphs() ?? [],
    injectTranslations: (results) => foliateRef.current?.injectChapterTranslations(results),
    removeTranslations: () => foliateRef.current?.removeChapterTranslations(),
    applyVisibility: (originalVisible, translationVisible) =>
      foliateRef.current?.applyChapterTranslationVisibility(originalVisible, translationVisible),
  });

  // Track which highlights have been rendered (id -> {cfi, note}) to detect changes
  const renderedHighlightsRef = useRef<Map<string, { cfi: string; hasNote: boolean }>>(new Map());

  // Reset rendered highlights tracking when book changes
  useEffect(() => {
    renderedHighlightsRef.current.clear();
    setFoliateReady(false);
    setTranslationReady(false);
  }, [bookId]);

  // Ref to track if we've already handled the initialCfi for this mount
  const handledInitialCfiRef = useRef<string | null>(null);

  // Unified navigation function that records history
  const navigateToCfi = useCallback(
    (cfi: string) => {
      if (!foliateRef.current || !readerTab) {
        console.warn("[ReaderView] navigateToCfi aborted:", {
          hasFoliate: !!foliateRef.current,
          hasReaderTab: !!readerTab,
          tabId,
        });
        return;
      }

      // Push CURRENT location to history before jumping
      if (readerTab.currentCfi) {
        console.log("[ReaderView] Pushing current location to history:", readerTab.currentCfi);
        pushHistory(tabId, {
          cfi: readerTab.currentCfi,
          chapterIndex: readerTab.chapterIndex,
          chapterTitle: readerTab.chapterTitle,
        });
      }

      console.log("[ReaderView] Navigating to CFI:", cfi);
      foliateRef.current.goToCFI(cfi);
    },
    [tabId, readerTab, pushHistory],
  );

  // Navigate to initialCfi when foliate is ready (from NotesPage navigation)
  useEffect(() => {
    if (!foliateReady || !appTab?.initialCfi) return;

    // Only handle each unique initialCfi once
    if (handledInitialCfiRef.current === appTab.initialCfi) return;

    const targetCfi = appTab.initialCfi;
    handledInitialCfiRef.current = targetCfi;

    const timer = setTimeout(() => {
      if (foliateRef.current) {
        navigateToCfi(targetCfi);
        // Clear the initialCfi in the store after a slight delay to avoid the "stickiness"
        // caused by immediate re-render during navigation.
        setTimeout(() => {
          useAppStore.getState().addTab({ ...appTab, initialCfi: undefined });
        }, 500);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [foliateReady, appTab, navigateToCfi]);

  // Sync highlights to FoliateViewer when they change or when foliate becomes ready
  // Use a timeout to ensure the foliate view is fully initialized
  useEffect(() => {
    if (!foliateReady) return;

    // Delay to ensure foliate view is fully ready
    const timer = setTimeout(() => {
      if (!foliateRef.current) return;

      // Filter highlights for this book
      const bookHighlights = highlights.filter((h) => h.bookId === bookId);
      const currentIds = new Set(bookHighlights.map((h) => h.id));

      // Remove highlights that are no longer in the store
      for (const [id, data] of renderedHighlightsRef.current) {
        if (!currentIds.has(id)) {
          foliateRef.current.deleteAnnotation({ value: data.cfi });
          renderedHighlightsRef.current.delete(id);
        }
      }

      // Add new highlights or update existing ones if note status changed
      for (const h of bookHighlights) {
        if (!h.cfi) continue;

        const existing = renderedHighlightsRef.current.get(h.id);
        const hasNote = !!h.note;

        // Check if we need to re-render (new highlight or note status changed)
        const needsRender = !existing || existing.hasNote !== hasNote;

        if (needsRender) {
          // Remove old annotation if exists
          if (existing) {
            foliateRef.current.deleteAnnotation({ value: existing.cfi });
          }

          // Add new/updated annotation
          foliateRef.current.addAnnotation({
            value: h.cfi,
            type: "highlight",
            color: h.color || "yellow",
            note: h.note, // Pass note for wavy underline + tooltip
          });
          renderedHighlightsRef.current.set(h.id, { cfi: h.cfi, hasNote });
        }
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [highlights, foliateReady, bookId]);

  // Book document state
  const [bookDoc, setBookDoc] = useState<BookDoc | null>(null);
  const [bookFormat, setBookFormat] = useState<BookFormat>("EPUB");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [selection, setSelection] = useState<BookSelection | null>(null);
  const [selectionPos, setSelectionPos] = useState({ x: 0, y: 0 });
  const [tocItems, setTocItems] = useState<TOCItem[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translationText, setTranslationText] = useState("");
  const [translationPos, setTranslationPos] = useState({ x: 0, y: 0 });
  const [searchResults, setSearchResults] = useState<number>(0);
  const [searchIndex, setSearchIndex] = useState<number>(0);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [showChat, setShowChat] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTTS, setShowTTS] = useState(false);
  const [ttsSourceKind, setTtsSourceKind] = useState<"page" | "selection">("page");
  const [ttsContinuousEnabled, setTtsContinuousEnabled] = useState(true);
  const [ttsLastText, setTtsLastText] = useState("");
  const [isToolbarPinned, setIsToolbarPinned] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(TOOLBAR_PIN_STORAGE_KEY) === "true";
  });

  // Resizable panel widths
  const chatPanel = useResizablePanel({
    storageKey: "reader-chat-panel-width",
    defaultWidth: 320,
    minWidth: 200,
    maxWidth: 600,
  });
  const notebookPanel = useResizablePanel({
    storageKey: "reader-notebook-panel-width",
    defaultWidth: 320,
    minWidth: 200,
    maxWidth: 600,
  });

  const ttsPlayState = useTTSStore((s) => s.playState);
  const ttsPlay = useTTSStore((s) => s.play);
  const ttsPause = useTTSStore((s) => s.pause);
  const ttsResume = useTTSStore((s) => s.resume);
  const ttsStop = useTTSStore((s) => s.stop);
  const ttsCurrentText = useTTSStore((s) => s.currentText);
  const ttsConfig = useTTSStore((s) => s.config);
  const ttsUpdateConfig = useTTSStore((s) => s.updateConfig);
  const ttsSetOnEnd = useTTSStore((s) => s.setOnEnd);
  const ttsCurrentChunkIndex = useTTSStore((s) => s.currentChunkIndex);
  const ttsTotalChunks = useTTSStore((s) => s.totalChunks);
  const ttsSetCurrentBook = useTTSStore((s) => s.setCurrentBook);

  /** Whether TTS is in continuous reading mode (auto page-turn) */
  const ttsContinuousRef = useRef(false);

  const { t } = useTranslation();
  const isInitializedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const ttsCoverSrc = useResolvedSrc(book?.meta.coverUrl);

  // Auto-hide controls
  const keepControlsVisible = showSearch || showToc || showSettings;
  const {
    isVisible: controlsVisible,
    handleMouseEnter,
    handleMouseLeave,
  } = useAutoHideControls(containerRef, 2000, keepControlsVisible);
  const toolbarVisible = controlsVisible || isToolbarPinned;

  useEffect(() => {
    window.localStorage.setItem(TOOLBAR_PIN_STORAGE_KEY, String(isToolbarPinned));
  }, [isToolbarPinned]);

  // Throttled progress save
  const throttledSaveProgress = useRef(
    throttle((bId: string, prog: number, cfi: string) => {
      updateBook(bId, {
        progress: prog,
        currentCfi: cfi,
        lastOpenedAt: Date.now(),
      });
    }, 5000),
  ).current;

  useEffect(() => {
    if (viewSettings.viewMode === "scroll") {
      updateReadSettings({ viewMode: "paginated" });
    }
  }, [viewSettings.viewMode, updateReadSettings]);

  // --- Load book on mount ---
  useEffect(() => {
    if (!book?.filePath || isInitializedRef.current) return;
    isInitializedRef.current = true;

    const initBook = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const { bookDoc, format } = await loadAndParseBook(book.filePath!);
        setBookDoc(bookDoc);
        setBookFormat(format);
      } catch (err) {
        console.error("[ReaderView] Failed to load book:", err);
        setError(err instanceof Error ? err.message : "Failed to load book");
        setIsLoading(false);
      }
    };

    initBook();

    return () => {
      isInitializedRef.current = false;
    };
  }, [book?.filePath]);

  useEffect(() => {
    return eventBus.on("sync:completed", () => {
      void loadAnnotations(bookId);
    });
  }, [bookId, loadAnnotations]);

  // Load annotations
  useEffect(() => {
    loadAnnotations(bookId);
  }, [bookId, loadAnnotations]);

  // Handle book not found
  useEffect(() => {
    if (!book?.filePath) {
      const timer = setTimeout(() => {
        if (!book?.filePath) {
          setIsLoading(false);
          setError(t("reader.noBookFile", { bookId }));
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [book?.filePath, bookId, t]);

  // --- Event handlers from FoliateViewer ---
  const handleRelocate = useCallback(
    (detail: RelocateDetail) => {
      const progress = detail.fraction ?? 0;
      const cfi = detail.cfi || `section-${detail.section?.current ?? 0}`;

      // Update reader store (immediate)
      setProgress(tabId, progress, cfi);

      // Update chapter info
      if (detail.tocItem?.label) {
        setChapter(tabId, detail.section?.current ?? 0, detail.tocItem.label, detail.tocItem.href);
      }

      // Track pages (reference: Readest progressRelocateHandler)
      // For fixed layout (PDF/CBZ): use section index (real pages)
      // For reflowable (EPUB): use location (virtual loc based on sizePerLoc=1500)
      //   location.current is 0-based; display as current+1 / total
      //   At end of book, clamp to total to prevent overflow
      if (isFixedLayoutFormat(bookFormat) && detail.section) {
        setTotalPages(detail.section.total);
        setCurrentPage(detail.section.current + 1);
      } else if (detail.location) {
        const { current, total } = detail.location;
        // Check if renderer is at the very end (same as Readest's atEnd check)
        const view = foliateRef.current?.getView();
        const atEnd = view?.renderer?.atEnd || false;
        const currentLoc = atEnd && total > 0 ? total : current + 1;
        setTotalPages(total);
        setCurrentPage(currentLoc);
      }

      // Throttled save to DB
      throttledSaveProgress(bookId, progress, cfi);

      // Mark translation ready after first successful relocate (CFI navigation done)
      if (!translationReady) setTranslationReady(true);
    },
    [tabId, bookId, bookFormat, setProgress, setChapter, throttledSaveProgress, translationReady],
  );

  const handleTocReady = useCallback((toc: TOCItem[]) => {
    setTocItems(toc);
  }, []);

  const handleLoaded = useCallback(() => {
    setIsLoading(false);
    // Mark foliate as ready to receive annotations
    setFoliateReady(true);
  }, []);

  // Handle section load (chapter change) - re-render all highlights
  // This is critical: when foliate-js loads a new section (chapter),
  // it replaces the iframe content and all previously added annotations are lost.
  // We need to re-add all highlights for the current book.
  const handleSectionLoad = useCallback(
    (sectionIndex: number) => {
      // Reset chapter translation on section change
      setCurrentSectionIndex(sectionIndex);
      setTranslationReady(false);
      chapterTranslation.reset();

      // Delay slightly to ensure foliate view is ready
      setTimeout(() => {
        if (!foliateRef.current) return;

        // Get all highlights for this book
        const bookHighlights = highlights.filter((h) => h.bookId === bookId);

        // Clear tracking since we're reloading
        renderedHighlightsRef.current.clear();

        // Re-add all highlights
        for (const h of bookHighlights) {
          if (h.cfi) {
            foliateRef.current.addAnnotation({
              value: h.cfi,
              type: "highlight",
              color: h.color || "yellow",
              note: h.note, // Pass note for wavy underline + tooltip
            });
            renderedHighlightsRef.current.set(h.id, { cfi: h.cfi, hasNote: !!h.note });
          }
        }

        console.log(
          `[ReaderView] Section ${sectionIndex} loaded, re-rendered ${bookHighlights.length} highlights`,
        );
      }, 100);
    },
    [highlights, bookId, chapterTranslation.reset],
  );

  const handleError = useCallback((err: Error) => {
    setError(err.message);
    setIsLoading(false);
  }, []);

  // Sync chapter translation visibility with DOM
  useEffect(() => {
    if (chapterTranslation.state.status !== "complete") return;
    try {
      const renderer = foliateRef.current?.getView()?.renderer;
      const contents = renderer?.getContents?.();
      if (!contents?.[0]?.doc) return;
      const doc = contents[0].doc as Document;
      const { originalVisible, translationVisible } = chapterTranslation.state;
      // Translation elements
      const translationEls = doc.querySelectorAll(".readany-translation");
      translationEls.forEach((el) => {
        (el as HTMLElement).setAttribute("data-hidden", String(!translationVisible));
        // When original is hidden, show translation in original style
        (el as HTMLElement).setAttribute("data-solo", String(!originalVisible && translationVisible));
      });
      // Original text elements
      const originalEls = doc.querySelectorAll("[data-translate-id]");
      originalEls.forEach((el) => {
        (el as HTMLElement).setAttribute("data-original-hidden", String(!originalVisible));
      });
    } catch {
      // Ignore
    }
  }, [chapterTranslation.state]);

  const handleSelection = useCallback(
    (sel: BookSelection | null) => {
      setSelection(sel);
      if (sel) {
        setSelectedText(tabId, sel.text, null);
        if (sel.rects.length > 0) {
          // SelectionPopover uses absolute positioning relative to containerRef
          const containerRect = containerRef.current?.getBoundingClientRect();
          if (!containerRect) return;

          const containerW = containerRect.width;
          const containerH = containerRect.height;

          // Popover dimensions
          const popoverW = 200;
          const popoverH = 44;
          const gap = 8; // Gap between selection and popover
          const padding = 8; // Minimum padding from edges

          // Reference: readest getPosition & getPopupPosition
          // firstRect/lastRect are already in viewport coordinates (converted in FoliateViewer)
          // Convert to container-relative coordinates
          // IMPORTANT: rects from getClientRects() are NOT sorted by position!
          // We need to find the actual topmost and bottommost rects.
          const containerRelativeRects = sel.rects.map((r) => ({
            top: r.top - containerRect.top,
            bottom: r.bottom - containerRect.top,
            left: r.left - containerRect.left,
            right: r.right - containerRect.left,
          }));

          // Find the topmost rect (smallest top value)
          const topmostRect = containerRelativeRects.reduce((min, r) =>
            r.top < min.top ? r : min,
          );
          // Find the bottommost rect (largest bottom value)
          const bottommostRect = containerRelativeRects.reduce((max, r) =>
            r.bottom > max.bottom ? r : max,
          );

          const firstTop = topmostRect.top;
          const firstLeft = topmostRect.left;
          const firstRight = topmostRect.right;
          const lastBottom = bottommostRect.bottom;

          // Calculate X position (centered on selection)
          const centerX = (firstLeft + firstRight) / 2;
          let x = centerX - popoverW / 2;
          // Clamp X so popover doesn't overflow left/right
          x = Math.max(padding, Math.min(x, containerW - popoverW - padding));

          // Calculate potential positions above and below
          const toolbarHeight = toolbarVisible ? 44 : 0;

          // Position above selection (y is the top of popover)
          const yAbove = firstTop - popoverH - gap;
          // Position below selection (y is the top of popover)
          const yBelow = lastBottom + gap;

          // Check if positions are valid (within visible container area)
          const aboveValid = yAbove >= toolbarHeight + padding;
          const belowValid = yBelow + popoverH + padding <= containerH;

          let y: number;
          if (aboveValid && belowValid) {
            // Both positions valid - choose the one with more space
            const spaceAbove = firstTop - toolbarHeight;
            const spaceBelow = containerH - lastBottom;
            y = spaceAbove > spaceBelow ? yAbove : yBelow;
          } else if (aboveValid) {
            y = yAbove;
          } else if (belowValid) {
            y = yBelow;
          } else {
            // Neither position ideal - pick the one that fits better
            // Prefer below if there's any space, otherwise clamp to toolbar area
            if (lastBottom + popoverH + padding <= containerH) {
              y = yBelow;
            } else {
              y = Math.max(toolbarHeight + padding, Math.min(yAbove, yBelow));
            }
          }

          setSelectionPos({ x, y });
        }
      } else {
        setSelectedText(tabId, "", null);
      }
    },
    [tabId, setSelectedText, toolbarVisible],
  );

  // --- Navigation (for toolbar buttons) ---
  const handleNavPrev = useCallback(() => {
    foliateRef.current?.goPrev();
  }, []);
  const handleNavNext = useCallback(() => {
    foliateRef.current?.goNext();
  }, []);

  const handleGoToChapter = useCallback(
    (href: string) => {
      foliateRef.current?.goToHref(href);
    },
    [],
  );

  // --- Selection actions ---
  const handleHighlight = useCallback(
    (color: HighlightColor = "yellow") => {
      if (selection && selection.cfi) {
        const highlightId = crypto.randomUUID();

        // Add to store (for persistence)
        useAnnotationStore.getState().addHighlight({
          id: highlightId,
          bookId,
          text: selection.text,
          cfi: selection.cfi,
          color,
          chapterTitle: readerTab?.chapterTitle || undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Immediately render on page (don't wait for useEffect)
        foliateRef.current?.addAnnotation({
          value: selection.cfi,
          type: "highlight",
          color,
        });

        // Track as rendered
        renderedHighlightsRef.current.set(highlightId, { cfi: selection.cfi, hasNote: false });
      }
      setSelection(null);
    },
    [selection, bookId, readerTab?.chapterTitle],
  );

  // Handle note button - open notebook panel with pending note
  const handleNote = useCallback(() => {
    if (selection && selection.cfi) {
      // Check if this selection is already highlighted
      const existingHighlight = highlights.find(
        (h) => h.bookId === bookId && h.cfi === selection.cfi,
      );

      if (existingHighlight) {
        // Edit note on existing highlight
        useNotebookStore.getState().startEditNote(existingHighlight);
      } else {
        // Start new note
        useNotebookStore.getState().startNewNote({
          text: selection.text,
          cfi: selection.cfi,
          chapterTitle: readerTab?.chapterTitle,
        });
      }
    }
    setSelection(null);
  }, [selection, bookId, highlights, readerTab?.chapterTitle]);

  const handleCopy = useCallback(() => {
    if (selection?.text) navigator.clipboard.writeText(selection.text);
    setSelection(null);
  }, [selection]);

  // Handle removing an existing highlight
  const handleRemoveHighlight = useCallback(() => {
    if (selection?.annotated && selection?.highlightId && selection?.cfi) {
      // Remove from store
      useAnnotationStore.getState().removeHighlight(selection.highlightId);

      // Remove from view
      foliateRef.current?.deleteAnnotation({ value: selection.cfi });

      // Remove from rendered tracking
      renderedHighlightsRef.current.delete(selection.highlightId);
    }
    setSelection(null);
  }, [selection]);

  // Handle show-annotation event (user clicked on existing highlight)
  const handleShowAnnotation = useCallback(
    (cfi: string, range: Range, index: number) => {
      // Find the highlight with this CFI
      const highlight = highlights.find((h) => h.bookId === bookId && h.cfi === cfi);
      if (!highlight) return;

      // Get rects for positioning the popover
      const rects = Array.from(range.getClientRects());

      // Get container and iframe for coordinate transformation
      const containerRect = containerRef.current?.getBoundingClientRect();
      const view = foliateRef.current?.getView();
      const contents = view?.renderer?.getContents?.();

      let offsetRects: DOMRect[] = rects;
      if (contents?.[0]?.element) {
        const iframe = contents[0].element as HTMLIFrameElement;
        const iframeRect = iframe.getBoundingClientRect();
        const scaleX = iframe.clientWidth > 0 ? iframeRect.width / iframe.clientWidth : 1;
        const scaleY = iframe.clientHeight > 0 ? iframeRect.height / iframe.clientHeight : 1;

        offsetRects = rects.map(
          (r) =>
            new DOMRect(
              iframeRect.left + r.x * scaleX,
              iframeRect.top + r.y * scaleY,
              r.width * scaleX,
              r.height * scaleY,
            ),
        );
      }

      // Create selection object for the existing annotation
      const sel: BookSelection = {
        text: highlight.text,
        cfi,
        chapterIndex: index,
        rects: offsetRects,
        annotated: true,
        highlightId: highlight.id,
        color: highlight.color,
      };

      setSelection(sel);

      // Position the popover
      if (offsetRects.length > 0) {
        const firstRect = offsetRects[0];
        const offsetX = containerRect?.left ?? 0;
        const offsetY = containerRect?.top ?? 0;
        const containerW = containerRect?.width ?? 800;
        const containerH = containerRect?.height ?? 600;

        const popoverHalfW = 100;
        const popoverH = 44;

        let x = firstRect.left + firstRect.width / 2 - offsetX;
        x = Math.max(popoverHalfW + 4, Math.min(x, containerW - popoverHalfW - 4));

        let y = firstRect.top - popoverH - 4 - offsetY;
        if (y < 4) {
          y = firstRect.bottom + 8 - offsetY;
        }
        y = Math.max(4, Math.min(y, containerH - popoverH - 4));

        setSelectionPos({ x, y });
      }
    },
    [highlights, bookId],
  );

  // Handle show-note-panel event (user clicked on wavy underline with note)
  const handleShowNotePanel = useCallback(
    (cfi: string) => {
      // Find the highlight with this CFI
      const highlight = highlights.find((h) => h.bookId === bookId && h.cfi === cfi);
      if (!highlight) return;

      // Start editing this highlight's note (this also opens the notebook panel)
      useNotebookStore.getState().startEditNote(highlight);
    },
    [highlights, bookId],
  );

  const handleTranslate = useCallback(() => {
    if (selection?.text) {
      setTranslationText(selection.text);
      setTranslationPos(selectionPos);
      setShowTranslation(true);
    }
    setSelection(null);
  }, [selection, selectionPos]);

  const handleAskAI = useCallback(() => {
    if (selection?.text) {
      // Store in sessionStorage in case ChatPanel is not mounted yet
      // ChatPanel will check and consume this on mount
      sessionStorage.setItem(
        `pending-ai-quote-${bookId}`,
        JSON.stringify({
          selectedText: selection.text,
          bookId,
          chapterTitle: readerTab?.chapterTitle,
        }),
      );

      // Open chat panel
      setShowChat(true);

      // Also dispatch event for immediate handling if panel is already open
      window.dispatchEvent(
        new CustomEvent("ask-ai-from-reader", {
          detail: {
            selectedText: selection.text,
            bookId,
            chapterTitle: readerTab?.chapterTitle,
          },
        }),
      );
    }
    setSelection(null);
  }, [selection, bookId, readerTab?.chapterTitle]);

  const handleCloseSelection = useCallback(() => setSelection(null), []);
  const handleToggleSearch = useCallback(() => setShowSearch((p) => !p), []);
  const handleToggleToc = useCallback(() => setShowToc((p) => !p), []);
  const handleToggleChat = useCallback(() => setShowChat((p) => !p), []);
  const handleToggleSettings = useCallback(() => setShowSettings((p) => !p), []);

  // TTS: auto-advance to next page when current page finishes reading
  const handleTTSPageEnd = useCallback(() => {
    if (!ttsContinuousRef.current) return;

    // Turn to next page
    foliateRef.current?.goNext();

    // Wait for the new page content to load, then read it
    setTimeout(() => {
      if (!ttsContinuousRef.current) return;
      const text = foliateRef.current?.getVisibleText();
      if (text?.trim()) {
        setTtsLastText(text);
        ttsPlay(text);
      } else {
        // No more text (end of book) — stop TTS
        ttsContinuousRef.current = false;
        ttsSetOnEnd(null);
        ttsStop();
      }
    }, 600);
  }, [ttsPlay, ttsSetOnEnd, ttsStop]);

  const handleTTSPrevChapter = useCallback(() => {
    const currentIdx = readerTab?.chapterIndex ?? -1;
    const idx = currentIdx > 0 ? currentIdx - 1 : 0;
    if (tocItems[idx]) {
      handleGoToChapter(tocItems[idx].href);
    }
  }, [readerTab?.chapterIndex, tocItems, handleGoToChapter]);

  const handleTTSNextChapter = useCallback(() => {
    const currentIdx = readerTab?.chapterIndex ?? -1;
    const idx = currentIdx >= 0 && currentIdx < tocItems.length - 1 ? currentIdx + 1 : tocItems.length - 1;
    if (tocItems[idx]) {
      handleGoToChapter(tocItems[idx].href);
    }
  }, [readerTab?.chapterIndex, tocItems, handleGoToChapter]);

  const startSelectionTTS = useCallback(
    (text: string) => {
      const normalized = text.trim();
      if (!normalized) return;
      setTtsSourceKind("selection");
      setTtsContinuousEnabled(false);
      setTtsLastText(normalized);
      ttsContinuousRef.current = false;
      ttsSetOnEnd(null);
      ttsSetCurrentBook(book?.meta.title ?? "", readerTab?.chapterTitle ?? "", bookId);
      setShowTTS(true);
      ttsPlay(normalized);
    },
    [ttsPlay, ttsSetOnEnd, ttsSetCurrentBook, book?.meta.title, readerTab?.chapterTitle, bookId],
  );

  const startPageTTS = useCallback(
    (continuous = ttsContinuousEnabled) => {
      const text = foliateRef.current?.getVisibleText();
      const normalized = text?.trim();
      if (!normalized) return;
      setTtsSourceKind("page");
      setTtsContinuousEnabled(continuous);
      setTtsLastText(normalized);
      ttsContinuousRef.current = continuous;
      ttsSetOnEnd(continuous ? handleTTSPageEnd : null);
      ttsSetCurrentBook(book?.meta.title ?? "", readerTab?.chapterTitle ?? "", bookId);
      setShowTTS(true);
      ttsPlay(normalized);
    },
    [handleTTSPageEnd, ttsContinuousEnabled, ttsPlay, ttsSetOnEnd, ttsSetCurrentBook, book?.meta.title, readerTab?.chapterTitle, bookId],
  );

  // TTS: toggle reading from current page with auto page-turn
  const handleToggleTTS = useCallback(() => {
    if (showTTS) {
      setShowTTS(false);
      return;
    }

    const hasActiveSession = ttsPlayState !== "stopped" || !!(ttsCurrentText || ttsLastText).trim();
    if (hasActiveSession) {
      setShowTTS(true);
      return;
    }

    startPageTTS(ttsContinuousEnabled);
  }, [
    showTTS,
    startPageTTS,
    ttsContinuousEnabled,
    ttsCurrentText,
    ttsLastText,
    ttsPlayState,
  ]);

  // TTS: speak selected text (no auto page-turn)
  const handleSpeakSelection = useCallback(() => {
    if (selection?.text) {
      startSelectionTTS(selection.text);
    }
    setSelection(null);
  }, [selection, startSelectionTTS]);

  const handleTTSReplay = useCallback(() => {
    if (ttsSourceKind === "selection") {
      const text = (ttsCurrentText || ttsLastText).trim();
      if (text) {
        startSelectionTTS(text);
      }
      return;
    }

    startPageTTS(ttsContinuousEnabled);
  }, [startPageTTS, startSelectionTTS, ttsContinuousEnabled, ttsCurrentText, ttsLastText, ttsSourceKind]);

  const handleTTSPlayPause = useCallback(() => {
    if (ttsPlayState === "loading") return;
    if (ttsPlayState === "playing") {
      ttsPause();
      return;
    }
    if (ttsPlayState === "paused") {
      ttsResume();
      return;
    }

    if (ttsSourceKind === "selection") {
      const text = (ttsCurrentText || ttsLastText).trim();
      if (text) {
        startSelectionTTS(text);
      }
      return;
    }

    startPageTTS(ttsContinuousEnabled);
  }, [
    startPageTTS,
    startSelectionTTS,
    ttsContinuousEnabled,
    ttsCurrentText,
    ttsLastText,
    ttsPause,
    ttsPlayState,
    ttsResume,
    ttsSourceKind,
  ]);

  const handleAdjustTTSRate = useCallback(
    (delta: number) => {
      const nextRate = Math.max(0.5, Math.min(2, Math.round((ttsConfig.rate + delta) * 10) / 10));
      ttsUpdateConfig({ rate: nextRate });
    },
    [ttsConfig.rate, ttsUpdateConfig],
  );

  const handleAdjustTTSPitch = useCallback(
    (delta: number) => {
      const nextPitch = Math.max(
        0.5,
        Math.min(2, Math.round((ttsConfig.pitch + delta) * 10) / 10),
      );
      ttsUpdateConfig({ pitch: nextPitch });
    },
    [ttsConfig.pitch, ttsUpdateConfig],
  );

  const handleToggleTTSContinuous = useCallback(() => {
    setTtsContinuousEnabled((prev) => {
      const next = !prev;
      const shouldContinue = next && ttsSourceKind === "page";
      ttsContinuousRef.current = shouldContinue;
      ttsSetOnEnd(shouldContinue ? handleTTSPageEnd : null);
      return next;
    });
  }, [handleTTSPageEnd, ttsSetOnEnd, ttsSourceKind]);

  // Stop TTS when leaving the reader
  useEffect(() => {
    return () => {
      ttsContinuousRef.current = false;
      ttsSetOnEnd(null);
      ttsStop();
    };
  }, [ttsStop, ttsSetOnEnd]);

  // --- Search logic ---
  const searchGeneratorRef = useRef<AsyncGenerator | null>(null);
  const searchResultsListRef = useRef<Array<{ cfi: string; excerpt: string }>>([]);

  const handleSearch = useCallback(async (query: string) => {
    // Clear previous search
    foliateRef.current?.clearSearch();
    searchResultsListRef.current = [];

    if (!query.trim()) {
      setSearchResults(0);
      setSearchIndex(0);
      return;
    }

    const gen = foliateRef.current?.search({ query });
    if (!gen) {
      setSearchResults(0);
      setSearchIndex(0);
      return;
    }
    searchGeneratorRef.current = gen;

    // Collect results from the async generator
    // foliate-js full-book search yields two formats:
    //   - { progress: number }  (progress update, skip)
    //   - { label, subitems: [{ cfi, excerpt }] }  (per-section results)
    // Single-section search yields { cfi, excerpt } directly.
    const results: Array<{ cfi: string; excerpt: string }> = [];
    try {
      for await (const result of gen) {
        const r = result as
          | {
              cfi?: string;
              excerpt?: string;
              progress?: number;
              subitems?: Array<{ cfi: string; excerpt: string }>;
            }
          | undefined;
        if (!r) continue;

        if (r.subitems) {
          // Full-book search: per-section grouped results
          for (const item of r.subitems) {
            if (item.cfi) {
              results.push({ cfi: item.cfi, excerpt: item.excerpt || "" });
            }
          }
          // Incrementally update UI as results come in
          searchResultsListRef.current = results;
          setSearchResults(results.length);
          if (results.length === 1) {
            setSearchIndex(0);
            navigateToCfi(results[0].cfi);
          }
        } else if (r.cfi) {
          // Single-section search: flat results
          results.push({ cfi: r.cfi, excerpt: r.excerpt || "" });
        }
        // Skip progress-only events ({ progress: number })
      }
    } catch {
      // Generator may be interrupted by a new search
    }

    searchResultsListRef.current = results;
    setSearchResults(results.length);
    if (results.length > 0 && searchResultsListRef.current.length <= results.length) {
      setSearchIndex(0);
      navigateToCfi(results[0].cfi);
    }
  }, [navigateToCfi, setSearchResults, setSearchIndex]);

  const navigateSearchResult = useCallback((direction: "next" | "prev") => {
    const results = searchResultsListRef.current;
    if (results.length === 0) return;

    setSearchIndex((prev) => {
      const next =
        direction === "next"
          ? (prev + 1) % results.length
          : (prev - 1 + results.length) % results.length;
      navigateToCfi(results[next].cfi);
      return next;
    });
  }, [navigateToCfi]);

  const handleNavigateToCitation = useCallback((citation: CitationPart) => {
    if (!citation.cfi || citation.cfi.trim() === "") {
      console.warn("Citation has no valid CFI, falling back to chapter index:", {
        chapterTitle: citation.chapterTitle,
        chapterIndex: citation.chapterIndex,
        text: citation.text.slice(0, 50),
      });
      try {
        foliateRef.current?.goToIndex(citation.chapterIndex);
      } catch (error) {
        console.error("Failed to navigate to chapter:", error, citation);
      }
      return;
    }

    if (citation.cfi.startsWith("page:")) {
      const pageNum = Number.parseInt(citation.cfi.split(":")[1], 10);
      if (!isNaN(pageNum)) {
        try {
          foliateRef.current?.goToIndex(pageNum - 1);
        } catch (error) {
          console.error("Failed to navigate to page:", error, citation);
        }
        return;
      }
    }

    console.log("[handleNavigateToCitation] Citation clicked:", citation);

    try {
      navigateToCfi(citation.cfi);

      const flashHighlight = () => {
        let flashCount = 0;
        const maxFlashes = 3;
        const flashInterval = 500;

        const doFlash = () => {
          if (flashCount >= maxFlashes) return;

          foliateRef.current?.addAnnotation({
            value: citation.cfi,
            type: "highlight",
            color: "orange",
          });

          setTimeout(() => {
            foliateRef.current?.deleteAnnotation({ value: citation.cfi });
            flashCount++;

            if (flashCount < maxFlashes) {
              setTimeout(doFlash, flashInterval);
            }
          }, flashInterval);
        };

        setTimeout(doFlash, 100);
      };

      flashHighlight();
    } catch (error) {
      console.error("[handleNavigateToCitation] Failed to navigate to citation:", error, citation);
    }
  }, [navigateToCfi]);

  if (!readerTab) {
    return <div className="flex h-full items-center justify-center">{t("common.loading")}</div>;
  }

  return (
    <div className="flex h-full bg-muted/30 p-1">
      {/* Notebook sidebar — LEFT side */}
      <NotebookSidebarWrapper
        bookId={bookId}
        onGoToCfi={navigateToCfi}
        onAddAnnotation={(cfi, color, note) => {
          foliateRef.current?.addAnnotation({
            value: cfi,
            type: "highlight",
            color,
            note,
          });
        }}
        onDeleteAnnotation={(cfi) => {
          foliateRef.current?.deleteAnnotation({ value: cfi });
        }}
        panelWidth={notebookPanel.width}
        onResize={notebookPanel.handleResize}
        onResizeStart={notebookPanel.handleResizeStart}
        onResizeEnd={notebookPanel.handleResizeEnd}
      />

      {/* Main reading area */}
      <div className="relative flex flex-1 flex-col overflow-hidden rounded-lg border border-border/60 bg-background shadow-sm">
        {/* Search bar — stacked above content when visible */}
        {showSearch && (
          <SearchBar
            onSearch={handleSearch}
            onNext={() => navigateSearchResult("next")}
            onPrev={() => navigateSearchResult("prev")}
            onClose={() => {
              setShowSearch(false);
              setSearchResults(0);
              setSearchIndex(0);
              foliateRef.current?.clearSearch();
            }}
            resultCount={searchResults}
            currentIndex={searchIndex}
          />
        )}

        {/* Content area — takes full remaining space */}
        <div
          className="relative flex flex-1 overflow-hidden transition-[padding] duration-300"
          style={{ paddingTop: isToolbarPinned ? 40 : 0 }}
        >
          {/* Reading area — FoliateViewer */}
          <div className="relative flex-1 overflow-hidden" ref={containerRef}>
            {bookDoc ? (
              <FoliateViewer
                ref={foliateRef}
                bookKey={bookId}
                bookDoc={bookDoc}
                format={bookFormat}
                viewSettings={viewSettings}
                lastLocation={book?.currentCfi || undefined}
                onRelocate={handleRelocate}
                onTocReady={handleTocReady}
                onLoaded={handleLoaded}
                onSectionLoad={handleSectionLoad}
                onError={handleError}
                onSelection={handleSelection}
                onShowAnnotation={handleShowAnnotation}
                onShowNotePanel={handleShowNotePanel}
                onToggleSearch={handleToggleSearch}
                onToggleToc={handleToggleToc}
                onToggleChat={handleToggleChat}
              />
            ) : isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                  <p className="text-sm text-muted-foreground">{t("reader.loadingBook")}</p>
                </div>
              </div>
            ) : null}

            {/* Error state */}
            {error && !isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background">
                <div className="flex max-w-md flex-col items-center gap-3 px-8 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                    <span className="text-lg text-destructive">!</span>
                  </div>
                  <p className="text-sm font-medium text-destructive">{t("reader.loadFailed")}</p>
                  <p className="text-xs text-muted-foreground">{error}</p>
                  <button
                    type="button"
                    className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
                    onClick={() => {
                      if (book?.filePath) {
                        isInitializedRef.current = false;
                        setError(null);
                        setBookDoc(null);
                        // Trigger re-init
                        setIsLoading(true);
                        loadAndParseBook(book.filePath)
                          .then(({ bookDoc, format }) => {
                            setBookDoc(bookDoc);
                            setBookFormat(format);
                            isInitializedRef.current = true;
                          })
                          .catch((err) => {
                            setError(err instanceof Error ? err.message : "Failed");
                            setIsLoading(false);
                          });
                      }
                    }}
                  >
                    {t("common.retry")}
                  </button>
                </div>
              </div>
            )}

            {/* Bookmark ribbon */}
            <BookmarkRibbon visible={isBookmarked} />

            {/* Selection popover */}
            {selection && (
              <SelectionPopover
                position={selectionPos}
                selectedText={selection.text}
                annotated={selection.annotated}
                currentColor={selection.color as HighlightColor | undefined}
                isPdf={bookFormat === "PDF"}
                onHighlight={handleHighlight}
                onRemoveHighlight={handleRemoveHighlight}
                onNote={handleNote}
                onCopy={handleCopy}
                onTranslate={handleTranslate}
                onAskAI={handleAskAI}
                onSpeak={handleSpeakSelection}
                onClose={handleCloseSelection}
              />
            )}

            {/* Translation popover */}
            {showTranslation && translationText && (
              <TranslationPopover
                text={translationText}
                position={translationPos}
                onClose={() => {
                  setShowTranslation(false);
                  setTranslationText("");
                }}
              />
            )}
          </div>

          {/* Floating Toolbar — overlays content area */}
          <ReaderToolbar
            tabId={tabId}
            isVisible={toolbarVisible}
            onPrev={handleNavPrev}
            onNext={handleNavNext}
            tocItems={tocItems}
            onGoToChapter={handleGoToChapter}
            onToggleSearch={handleToggleSearch}
            onToggleToc={handleToggleToc}
            onToggleSettings={handleToggleSettings}
            onToggleChat={handleToggleChat}
            onToggleTTS={handleToggleTTS}
            chapterTranslationState={chapterTranslation.state}
            onChapterTranslationStart={chapterTranslation.startTranslation}
            onChapterTranslationCancel={chapterTranslation.cancelTranslation}
            onToggleOriginalVisible={chapterTranslation.toggleOriginalVisible}
            onToggleTranslationVisible={chapterTranslation.toggleTranslationVisible}
            onChapterTranslationReset={chapterTranslation.reset}
            isChatOpen={showChat}
            isTTSActive={showTTS || ttsPlayState !== "stopped"}
            isFixedLayout={isFixedLayoutFormat(bookFormat)}
            isPinned={isToolbarPinned}
            onTogglePinned={() => setIsToolbarPinned((prev) => !prev)}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            getPageSnippet={() => foliateRef.current?.getVisibleText() || ""}
          />

          {/* Floating Footer bar — overlays content area */}
          <FooterBar
            tabId={tabId}
            totalPages={totalPages}
            currentPage={currentPage}
            isVisible={controlsVisible}
            onPrev={handleNavPrev}
            onNext={handleNavNext}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          />

          <TTSPage
            visible={showTTS}
            bookTitle={book?.meta.title || ""}
            chapterTitle={readerTab?.chapterTitle || ""}
            coverSrc={ttsCoverSrc}
            playState={ttsPlayState}
            currentText={ttsCurrentText || ttsLastText}
            config={ttsConfig}
            readingProgress={readerTab?.progress ?? 0}
            currentPage={currentPage}
            totalPages={totalPages}
            sourceLabel={
              ttsSourceKind === "selection"
                ? t("tts.fromSelection")
                : t("tts.fromCurrentPage")
            }
            continuousEnabled={ttsContinuousEnabled}
            currentChunkIndex={ttsCurrentChunkIndex}
            totalChunks={ttsTotalChunks}
            onClose={() => setShowTTS(false)}
            onReplay={handleTTSReplay}
            onPlayPause={handleTTSPlayPause}
            onStop={() => {
              ttsContinuousRef.current = false;
              ttsSetOnEnd(null);
              ttsStop();
            }}
            onAdjustRate={handleAdjustTTSRate}
            onAdjustPitch={handleAdjustTTSPitch}
            onToggleContinuous={handleToggleTTSContinuous}
            onUpdateConfig={ttsUpdateConfig}
            onPrevChapter={tocItems.length > 0 ? handleTTSPrevChapter : undefined}
            onNextChapter={tocItems.length > 0 ? handleTTSNextChapter : undefined}
          />

          {/* Always-visible thin progress bar at the very bottom */}
          <div className="absolute bottom-0 left-0 right-0 z-20 h-[2px] bg-foreground/5">
            <div
              className="h-full bg-primary/30 transition-all duration-300 ease-out"
              style={{ width: `${Math.round((readerTab?.progress ?? 0) * 100)}%` }}
            />
          </div>
        </div>

        {/* TOC overlay — floats above toolbar, content, and footer */}
        {showToc && (
          <>
            <div className="absolute inset-0 z-40 bg-black/20" onClick={() => setShowToc(false)} />
            <div className="absolute top-2 bottom-2 left-0 z-50 flex animate-in slide-in-from-left duration-200">
              <TOCPanel
                tocItems={tocItems}
                onGoToChapter={(href) => {
                  handleGoToChapter(href);
                  setShowToc(false);
                }}
                onGoToCfi={(cfi) => {
                  navigateToCfi(cfi);
                  setShowToc(false);
                }}
                onClose={() => setShowToc(false)}
                tabId={tabId}
                bookId={bookId}
              />
            </div>
          </>
        )}

        {/* Settings overlay */}
        {showSettings && (
          <>
            <div
              className="absolute inset-0 z-40 bg-black/20"
              onClick={() => setShowSettings(false)}
            />
            <div className="absolute top-12 right-2 z-50 w-80 animate-in slide-in-from-top-2 duration-200 rounded-lg border border-border/60 bg-background shadow-lg">
              <div className="flex items-center justify-between border-b border-border/40 px-4 py-2">
                <span className="text-xs font-medium">{t("settings.reading_title")}</span>
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setShowSettings(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <ReadSettingsPanel />
            </div>
          </>
        )}
      </div>

      {/* AI Chat sidebar — RIGHT side, resizable */}
      {showChat && (
        <div
          className="relative ml-1 flex shrink-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-background shadow-sm"
          style={{ width: chatPanel.width }}
        >
          <ResizeHandle
            side="left"
            onResizeStart={chatPanel.handleResizeStart}
            onResize={(delta) => chatPanel.handleResize(delta, "left")}
            onResizeEnd={chatPanel.handleResizeEnd}
          />
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/40 px-3">
            <span className="text-xs font-medium text-foreground">{t("chat.aiAssistant")}</span>
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => setShowChat(false)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <ChatPanel book={book} onNavigateToCitation={handleNavigateToCitation} />
          </div>
        </div>
      )}
    </div>
  );
}

// Separate component to use notebook store hook
function NotebookSidebarWrapper({
  bookId,
  onGoToCfi,
  onAddAnnotation,
  onDeleteAnnotation,
  panelWidth,
  onResize,
  onResizeStart,
  onResizeEnd,
}: {
  bookId: string;
  onGoToCfi: (cfi: string) => void;
  onAddAnnotation: (cfi: string, color: string, note?: string) => void;
  onDeleteAnnotation: (cfi: string) => void;
  panelWidth: number;
  onResize: (delta: number, side: "left" | "right") => void;
  onResizeStart: () => void;
  onResizeEnd: () => void;
}) {
  const isOpen = useNotebookStore((s) => s.isOpen);
  const closeNotebook = useNotebookStore((s) => s.closeNotebook);

  if (!isOpen) return null;

  return (
    <div
      className="relative mr-1 flex shrink-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-background shadow-sm"
      style={{ width: panelWidth }}
    >
      <ResizeHandle
        side="right"
        onResizeStart={onResizeStart}
        onResize={(delta) => onResize(delta, "right")}
        onResizeEnd={onResizeEnd}
      />
      <NotebookPanel
        bookId={bookId}
        onClose={closeNotebook}
        onGoToCfi={onGoToCfi}
        onAddAnnotation={onAddAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
      />
    </div>
  );
}
