import type { TOCItem } from "@readany/core/types";
/**
 * useReaderBridge — encapsulates RN ↔ WebView postMessage communication
 * for the foliate-js reader engine.
 */
import { useCallback, useRef } from "react";
import type { WebView } from "react-native-webview";

export interface RelocateEvent {
  fraction?: number;
  section?: { current: number; total: number };
  location?: { current: number; next: number; total: number };
  tocItem?: { label?: string; href?: string; id?: number };
  pageItem?: { label?: string };
  cfi?: string;
}

export interface SelectionEvent {
  text: string;
  cfi: string;
  position: {
    x: number;
    y: number;
    selectionTop: number;
    selectionBottom: number;
  };
}

export interface ReaderBridgeCallbacks {
  onRelocate?: (detail: RelocateEvent) => void;
  onTocReady?: (items: TOCItem[]) => void;
  onSelection?: (detail: SelectionEvent) => void;
  onSelectionCleared?: () => void;
  onTap?: () => void;
  onSearchResult?: (index: number, count: number) => void;
  onSearchComplete?: (count: number) => void;
  onError?: (message: string) => void;
  onReady?: () => void;
  onLoaded?: () => void;
  onShowAnnotation?: (detail: {
    value: string;
    range: Range;
    position: { x: number; y: number; selectionTop: number; selectionBottom: number };
  }) => void;
}

export function useReaderBridge(callbacks: ReaderBridgeCallbacks) {
  const webViewRef = useRef<WebView>(null);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // ─── Send commands to WebView ───

  const inject = useCallback((code: string) => {
    console.log("[ReaderBridge] Injecting code:", code.substring(0, 200) + "...");
    webViewRef.current?.injectJavaScript(`${code}; true;`);
  }, []);

  const openBook = useCallback(
    (params: {
      uri?: string;
      base64?: string;
      fileName?: string;
      mimeType?: string;
      lastLocation?: string;
      pageMargin?: number;
    }) => {
      console.log("[ReaderBridge] openBook called with params:", {
        fileName: params.fileName,
        base64Length: params.base64?.length,
        lastLocation: params.lastLocation,
      });
      const msg = JSON.stringify({ type: "openBook", ...params });
      console.log("[ReaderBridge] Message JSON length:", msg.length);
      inject(`handleCommand(${msg})`);
    },
    [inject],
  );

  const goNext = useCallback(() => {
    inject("window.goNext()");
  }, [inject]);

  const goPrev = useCallback(() => {
    inject("window.goPrev()");
  }, [inject]);

  const goToFraction = useCallback(
    (fraction: number) => {
      inject(`window.goToProgress(${fraction})`);
    },
    [inject],
  );

  const goToHref = useCallback(
    (href: string) => {
      inject(`window.goToHref(${JSON.stringify(href)})`);
    },
    [inject],
  );

  const goToCFI = useCallback(
    (cfi: string) => {
      const msg = JSON.stringify({ type: "goToCFI", cfi });
      inject(`handleCommand(${msg})`);
    },
    [inject],
  );

  const search = useCallback(
    (query: string) => {
      inject(`window.search(${JSON.stringify(query)})`);
    },
    [inject],
  );

  const clearSearch = useCallback(() => {
    inject("window.clearSearch()");
  }, [inject]);

  const navigateSearch = useCallback(
    (index: number) => {
      inject(`window.navigateSearch(${index})`);
    },
    [inject],
  );

  const addAnnotation = useCallback(
    (annotation: { value: string; color?: string; note?: string }) => {
      inject(`window.addAnnotation(${JSON.stringify(annotation)})`);
    },
    [inject],
  );

  const removeAnnotation = useCallback(
    (annotation: { value: string }) => {
      inject(`window.removeAnnotation(${JSON.stringify(annotation)})`);
    },
    [inject],
  );

  const applySettings = useCallback(
    (settings: {
      fontSize?: number;
      lineHeight?: number;
      paragraphSpacing?: number;
      pageMargin?: number;
      fontTheme?: string;
      viewMode?: string;
    }) => {
      const msg = JSON.stringify({ type: "applySettings", settings });
      inject(`handleCommand(${msg})`);
    },
    [inject],
  );

  const setThemeColors = useCallback(
    (colors: { background: string; foreground: string; muted: string }) => {
      const msg = JSON.stringify({ type: "setThemeColors", colors });
      inject(`handleCommand(${msg})`);
    },
    [inject],
  );

  const setNavigationLocked = useCallback(
    (locked: boolean) => {
      console.log("[ReaderBridge] setNavigationLocked:", locked);
      inject(`window.setNavigationLocked(${locked})`);
    },
    [inject],
  );

  // ─── Handle messages from WebView ───

  const handleMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      console.log("[ReaderBridge] Received message:", msg.type, msg);
      const cb = callbacksRef.current;

      switch (msg.type) {
        case "ready":
          console.log("[ReaderBridge] WebView ready!");
          cb.onReady?.();
          break;
        case "loaded":
          console.log("[ReaderBridge] Book loaded!");
          cb.onLoaded?.();
          break;
        case "relocate":
          cb.onRelocate?.(msg);
          break;
        case "toc":
          console.log("[ReaderBridge] TOC ready, items:", msg.items?.length || 0);
          cb.onTocReady?.(msg.items || []);
          break;
        case "selection":
          cb.onSelection?.(msg);
          break;
        case "selectionCleared":
          cb.onSelectionCleared?.();
          break;
        case "tap":
          cb.onTap?.();
          break;
        case "searchResult":
          cb.onSearchResult?.(msg.index || 0, msg.count || 0);
          break;
        case "searchComplete":
          cb.onSearchComplete?.(msg.count || 0);
          break;
        case "error":
          console.error("[ReaderBridge] Error from WebView:", msg.message);
          cb.onError?.(msg.message || "Unknown error");
          break;
        case "foliate-loaded":
          console.log("[ReaderBridge] foliate-js loaded in WebView");
          break;
        case "show-annotation":
          console.log("[ReaderBridge] Show annotation:", msg.value);
          if (msg.value && msg.position) {
            cb.onShowAnnotation?.({
              value: msg.value,
              range: msg.range,
              position: msg.position,
            });
          }
          break;
        default:
          console.log("[ReaderBridge] Unknown message type:", msg.type);
      }
    } catch (err) {
      console.error("[ReaderBridge] Parse error:", err);
    }
  }, []);

  return {
    webViewRef,
    handleMessage,
    // Commands
    openBook,
    goNext,
    goPrev,
    goToFraction,
    goToHref,
    goToCFI,
    search,
    clearSearch,
    navigateSearch,
    addAnnotation,
    removeAnnotation,
    applySettings,
    setThemeColors,
    setNavigationLocked,
  };
}
