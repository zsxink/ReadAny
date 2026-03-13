import { SelectionPopover } from "@/components/reader/SelectionPopover";
import { TTSControls } from "@/components/reader/TTSControls";
import { TranslationPanel } from "@/components/reader/TranslationPanel";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  EditIcon,
  MessageSquareIcon,
  NotebookPenIcon,
  SearchIcon,
  Undo2Icon,
  Volume2Icon,
  XIcon,
} from "@/components/ui/Icon";
import { useReaderBridge } from "@/hooks/use-reader-bridge";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { RichTextEditor } from "@/components/ui/RichTextEditor";
import type { RelocateEvent, SelectionEvent } from "@/hooks/use-reader-bridge";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import {
  useAnnotationStore,
  useLibraryStore,
  useReadingSessionStore,
  useSettingsStore,
  useTTSStore,
} from "@/stores";
import { useTheme } from "@/styles/ThemeContext";
import { type ThemeColors, fontSize, fontWeight, radius, useColors } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { readingContextService } from "@readany/core/ai/reading-context-service";
import { getPlatformService } from "@readany/core/services";
import type { TOCItem } from "@readany/core/types";
import { useReadingSession } from "@readany/core/hooks/use-reading-session";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
/**
 * ReaderScreen — WebView-based reader with foliate-js engine.
 * Features: toolbar with back/notebook/chat/TTS/TOC/search/settings,
 * footer with prev/next + slider + progress, TOC panel, settings panel,
 * search bar, selection popover for highlights/notes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { WebView } from "react-native-webview";

const READER_HTML_ASSET = Asset.fromModule(require("../../assets/reader/reader.html"));

type Props = NativeStackScreenProps<RootStackParamList, "Reader">;

const SCREEN_WIDTH = Dimensions.get("window").width;
const SCREEN_HEIGHT = Dimensions.get("window").height;
const CONTROLS_TIMEOUT = 4000;

const FONT_THEMES = [
  { id: "default", labelKey: "reader.fontThemeDefault", fallback: "默认" },
  { id: "classic", labelKey: "reader.fontThemeClassic", fallback: "经典" },
  { id: "modern", labelKey: "reader.fontThemeModern", fallback: "现代" },
  { id: "elegant", labelKey: "reader.fontThemeElegant", fallback: "优雅" },
  { id: "literary", labelKey: "reader.fontThemeLiterary", fallback: "文学" },
];

// ──────────────────────────── Settings Icon (Gear) ────────────────────────────
function SettingsIcon({ size = 24, color = "#e8e8ed" }: { size?: number; color?: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <Path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
    </Svg>
  );
}

function ListIcon({ size = 24, color = "#e8e8ed" }: { size?: number; color?: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M3 12h18M3 6h18M3 18h18" />
    </Svg>
  );
}

// ──────────────────────────── TOC Tree Item ────────────────────────────
function TOCTreeItem({
  item,
  level,
  currentChapter,
  onSelect,
}: {
  item: TOCItem;
  level: number;
  currentChapter: string;
  onSelect: (href: string) => void;
}) {
  const colors = useColors();
  const tocS = makeTocStyles(colors);
  const hasChildren = item.subitems && item.subitems.length > 0;
  const isCurrent = item.title === currentChapter;
  const hasCurrentChild = (items: TOCItem[]): boolean => {
    for (const child of items) {
      if (child.title === currentChapter) return true;
      if (child.subitems && hasCurrentChild(child.subitems)) return true;
    }
    return false;
  };
  const shouldExpand = hasChildren && hasCurrentChild(item.subitems!);
  const [expanded, setExpanded] = useState(shouldExpand);

  return (
    <View>
      <TouchableOpacity
        style={[tocS.item, { paddingLeft: 12 + level * 16 }, isCurrent && tocS.itemActive]}
        onPress={() => item.href && onSelect(item.href)}
        activeOpacity={0.7}
      >
        {hasChildren ? (
          <TouchableOpacity
            style={tocS.expandBtn}
            onPress={() => setExpanded(!expanded)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {expanded ? (
              <ChevronDownIcon size={14} color={colors.mutedForeground} />
            ) : (
              <ChevronRightIcon size={14} color={colors.mutedForeground} />
            )}
          </TouchableOpacity>
        ) : (
          <View style={tocS.expandPlaceholder} />
        )}
        <Text style={[tocS.itemText, isCurrent && tocS.itemTextActive]} numberOfLines={1}>
          {item.title}
        </Text>
      </TouchableOpacity>
      {expanded && hasChildren && (
        <View>
          {item.subitems!.map((child) => (
            <TOCTreeItem
              key={child.id || child.href}
              item={child}
              level={level + 1}
              currentChapter={currentChapter}
              onSelect={onSelect}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const makeTocStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    item: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 10,
      paddingRight: 12,
      borderRadius: radius.lg,
    },
    itemActive: { backgroundColor: "rgba(99,102,241,0.1)" },
    expandBtn: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
    expandPlaceholder: { width: 20 },
    itemText: { fontSize: fontSize.sm, color: colors.foreground, flex: 1 },
    itemTextActive: { color: colors.indigo, fontWeight: fontWeight.medium },
  });

// ──────────────────────────── ReaderScreen ────────────────────────────
export function ReaderScreen({ route, navigation }: Props) {
  const colors = useColors();
  const { mode: themeMode } = useTheme();
  const s = makeStyles(colors);
  const { bookId, cfi } = route.params;
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [showTOC, setShowTOC] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showNotebook, setShowNotebook] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translationText, setTranslationText] = useState("");
  const [showTTS, setShowTTS] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResultCount, setSearchResultCount] = useState(0);
  const [searchIndex, setSearchIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentChapter, setCurrentChapter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [toc, setToc] = useState<TOCItem[]>([]);
  const [bookTitle, setBookTitle] = useState("");
  const [webViewReady, setWebViewReady] = useState(false);
  const [readerHtmlUri, setReaderHtmlUri] = useState<string | null>(null);
  const [currentCfi, setCurrentCfi] = useState("");
  const [selection, setSelection] = useState<SelectionEvent | null>(null);
  const [noteViewHighlight, setNoteViewHighlight] = useState<{
    id: string;
    text: string;
    note: string;
    cfi: string;
    color: string;
  } | null>(null);
  const [noteViewEditing, setNoteViewEditing] = useState(false);
  const [noteViewContent, setNoteViewContent] = useState("");
  const [noteTooltip, setNoteTooltip] = useState<{
    note: string;
    cfi: string;
    position: { x: number; y: number; selectionTop: number; selectionBottom: number };
  } | null>(null);
  const noteTooltipTimer = useRef<NodeJS.Timeout | null>(null);
  const assetLoadedRef = useRef(false);

  const readSettings = useSettingsStore((s) => s.readSettings);
  const updateReadSettings = useSettingsStore((s) => s.updateReadSettings);
  const settingFontSize = readSettings.fontSize;
  const settingLineHeight = readSettings.lineHeight;
  const settingParagraphSpacing = readSettings.paragraphSpacing;
  const settingPageMargin = readSettings.pageMargin;
  const settingFontTheme = readSettings.fontTheme;
  const settingViewMode = readSettings.viewMode;

  const controlsTimer = useRef<NodeJS.Timeout | null>(null);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const TOOLBAR_HIDE_OFFSET = -200;
  const FOOTER_HIDE_OFFSET = 200;
  const toolbarAnim = useRef(new Animated.Value(TOOLBAR_HIDE_OFFSET)).current;
  const footerAnim = useRef(new Animated.Value(FOOTER_HIDE_OFFSET)).current;
  const lastCfiRef = useRef<string>("");
  const locationHistoryRef = useRef<string[]>([]);
  const lastNavigatedCfiRef = useRef<string | undefined>(undefined);

  const { } = useReadingSessionStore(); // Removed startSession and stopSession
  const { sendEvent } = useReadingSession(bookId); // Added useReadingSession hook
  const { books, updateBook } = useLibraryStore();
  const { addHighlight, removeHighlight, loadAnnotations, highlights } = useAnnotationStore();
  const ttsPlay = useTTSStore((s) => s.play);
  const ttsStop = useTTSStore((s) => s.stop);
  const ttsSetOnEnd = useTTSStore((s) => s.setOnEnd);

  const book = useMemo(() => books.find((b) => b.id === bookId), [books, bookId]);

  // Load reader HTML asset
  useEffect(() => {
    if (assetLoadedRef.current) return;
    assetLoadedRef.current = true;

    const loadAsset = async () => {
      try {
        console.log("[ReaderScreen] Loading reader.html asset...");
        const asset = READER_HTML_ASSET;
        await asset.downloadAsync();
        const uri = asset.localUri || asset.uri;
        console.log("[ReaderScreen] Reader HTML asset loaded:", uri);
        setReaderHtmlUri(uri);
      } catch (err) {
        console.error("[ReaderScreen] Failed to load reader.html asset:", err);
        setError("Failed to load reader");
      }
    };
    loadAsset();
  }, []);

  // Reader bridge
  const bridge = useReaderBridge({
    onReady: () => {
      setWebViewReady(true);
    },
    onLoaded: () => {
      setLoading(false);
    },
    onRelocate: (detail: RelocateEvent) => {
      if (detail.fraction != null) setProgress(detail.fraction);
      if (detail.location) {
        setCurrentPage(detail.location.current);
        setTotalPages(detail.location.total);
      }
      if (detail.tocItem?.label) setCurrentChapter(detail.tocItem.label);
      if (detail.cfi) {
        if (lastCfiRef.current && detail.cfi !== lastCfiRef.current) {
          const fractionDiff = Math.abs((detail.fraction ?? 0) - progress);
          if (fractionDiff > 0.02 || locationHistoryRef.current.length === 0) {
            locationHistoryRef.current.push(lastCfiRef.current);
            if (locationHistoryRef.current.length > 50) {
              locationHistoryRef.current.shift();
            }
          }
        }
        lastCfiRef.current = detail.cfi;
        setCurrentCfi(detail.cfi);
        updateBook(bookId, {
          progress: detail.fraction ?? 0,
          currentCfi: detail.cfi,
        });
      }

      // Sync reading context for AI tools
      readingContextService.updateContext({
        bookId,
        bookTitle: book?.meta?.title || "",
        currentChapter: {
          index: detail.section?.current ?? 0,
          title: detail.tocItem?.label || "",
          href: detail.tocItem?.href || "",
        },
        currentPosition: {
          cfi: detail.cfi || "",
          percentage: (detail.fraction ?? 0) * 100,
        },
      });
    },
    onTocReady: (items: TOCItem[]) => {
      setToc(items);
    },
    onSelection: (detail: SelectionEvent) => {
      console.log("[ReaderScreen] onSelection callback called:", detail.text);
      setSelection(detail);
      // Sync selection for AI tools
      if (detail.cfi) {
        readingContextService.updateSelection({
          text: detail.text,
          cfi: detail.cfi,
          chapterIndex: 0,
          chapterTitle: "",
        });
      }
    },
    onSelectionCleared: () => {
      console.log("[ReaderScreen] onSelectionCleared callback called");
      setSelection(null);
      readingContextService.clearSelection();
    },
    onTap: () => {
      sendEvent({ type: "activity" });
      if (selection) {
        setSelection(null);
        return;
      }
      toggleControls();
    },
    onSearchResult: (index: number, count: number) => {
      setSearchIndex(index);
      setSearchResultCount(count);
    },
    onSearchComplete: (count: number) => {
      setSearchResultCount(count);
      setIsSearching(false);
    },
    onError: (message: string) => {
      console.error("[Reader] WebView error:", message);
      if (loading) {
        setError(message);
        setLoading(false);
      }
    },
    onShowAnnotation: (detail: {
      value: string;
      position: { x: number; y: number; selectionTop: number; selectionBottom: number };
    }) => {
      const highlight = highlights.find((h) => h.cfi === detail.value);
      if (!highlight) return;
      if (highlight.note) {
        setNoteViewHighlight({
          id: highlight.id,
          text: highlight.text,
          note: highlight.note,
          cfi: highlight.cfi,
          color: highlight.color,
        });
        setNoteViewContent(highlight.note);
        setNoteViewEditing(false);
      } else {
        setSelection({
          text: highlight.text,
          cfi: highlight.cfi,
          position: detail.position,
        });
      }
    },
    onNoteTooltip: (detail) => {
      // Dismiss any existing tooltip
      if (noteTooltipTimer.current) {
        clearTimeout(noteTooltipTimer.current);
      }
      setNoteTooltip({
        note: detail.note,
        cfi: detail.cfi,
        position: detail.position,
      });
      // Auto-hide after 4 seconds
      noteTooltipTimer.current = setTimeout(() => {
        setNoteTooltip(null);
        noteTooltipTimer.current = null;
      }, 4000);
    },
  });

  // Load book
  useEffect(() => {
    if (!book) {
      setError(t("reader.bookNotFound", "书籍未找到"));
      setLoading(false);
      return;
    }
    setBookTitle(book.meta.title);
    updateBook(bookId, { lastOpenedAt: Date.now() });
    loadAnnotations(bookId);

    return () => {
      readingContextService.clearContext();
    };
  }, [bookId]);

  // When WebView is ready and book is available, send the open command
  useEffect(() => {
    if (!webViewReady || !book?.filePath) {
      console.log("[ReaderScreen] Waiting for WebView ready and book...", {
        webViewReady,
        bookPath: book?.filePath,
      });
      return;
    }

    const loadBook = async () => {
      console.log("[ReaderScreen] Starting to load book:", book.filePath);
      try {
        // Resolve absolute path from relative path
        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();
        const absPath = await platform.joinPath(appData, book.filePath);
        console.log("[ReaderScreen] Absolute path:", absPath);

        // Read the book file and send as base64 for reliability
        console.log("[ReaderScreen] Reading file as base64...");
        const base64 = await FileSystem.readAsStringAsync(absPath, {
          encoding: FileSystem.EncodingType.Base64,
        });
        console.log("[ReaderScreen] File read complete, base64 length:", base64.length);

        console.log("[ReaderScreen] Sending openBook command to WebView...");
        bridge.openBook({
          base64,
          fileName: book.filePath.split("/").pop() || "book.epub",
          lastLocation: book.currentCfi || undefined,
          pageMargin: settingPageMargin,
        });

        // Set theme colors
        bridge.setThemeColors({
          background: colors.background,
          foreground: colors.foreground,
          muted: colors.mutedForeground,
        });
        console.log("[ReaderScreen] openBook command sent, waiting for response...");
      } catch (err: any) {
        console.error("[ReaderScreen] Failed to load book:", err);
        setError(err.message || "Failed to load book file");
        setLoading(false);
      }
    };

    loadBook();
  }, [webViewReady, book?.filePath]);

  // Apply theme colors when theme changes
  useEffect(() => {
    if (!webViewReady) return;
    bridge.setThemeColors({
      background: colors.background,
      foreground: colors.foreground,
      muted: colors.mutedForeground,
    });
  }, [themeMode, webViewReady]);

  // Load annotations into reader when ready
  useEffect(() => {
    if (!webViewReady || loading || highlights.length === 0) return;
    for (const h of highlights) {
      bridge.addAnnotation({ value: h.cfi, color: h.color, note: h.note });
    }
  }, [webViewReady, loading, highlights]);

  // Reset last navigated CFI when book changes
  useEffect(() => {
    lastNavigatedCfiRef.current = undefined;
  }, [bookId]);

  // Navigate to CFI when book is loaded (from NotesPage navigation)
  useEffect(() => {
    if (!webViewReady || loading || !cfi || cfi === lastNavigatedCfiRef.current) return;
    console.log("[ReaderScreen] Navigating to CFI:", cfi);
    bridge.goToCFI(cfi);
    lastNavigatedCfiRef.current = cfi;
  }, [webViewReady, loading, cfi, bridge]);

  // Lock navigation when selection is active
  useEffect(() => {
    console.log(
      "[ReaderScreen] selection changed:",
      !!selection,
      selection?.text?.substring(0, 20),
    );
    if (!webViewReady) return;
    bridge.setNavigationLocked(!!selection);
  }, [webViewReady, selection]);

  // Controls toggle
  const toggleControls = useCallback(() => {
    const willShow = !showControls;
    setShowControls(willShow);
    Animated.parallel([
      Animated.spring(toolbarAnim, {
        toValue: willShow ? 0 : TOOLBAR_HIDE_OFFSET,
        useNativeDriver: true,
        friction: 20,
        tension: 100,
      }),
      Animated.spring(footerAnim, {
        toValue: willShow ? 0 : FOOTER_HIDE_OFFSET,
        useNativeDriver: true,
        friction: 20,
        tension: 100,
      }),
    ]).start();

    if (willShow) {
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
      controlsTimer.current = setTimeout(() => {
        setShowControls(false);
        Animated.parallel([
          Animated.spring(toolbarAnim, {
            toValue: TOOLBAR_HIDE_OFFSET,
            useNativeDriver: true,
            friction: 20,
            tension: 100,
          }),
          Animated.spring(footerAnim, {
            toValue: FOOTER_HIDE_OFFSET,
            useNativeDriver: true,
            friction: 20,
            tension: 100,
          }),
        ]).start();
      }, CONTROLS_TIMEOUT);
    }
  }, [showControls, toolbarAnim, footerAnim]);

  const goToTocItem = useCallback(
    (href: string) => {
      if (lastCfiRef.current) {
        locationHistoryRef.current.push(lastCfiRef.current);
      }
      bridge.goToHref(href);
      setShowTOC(false);
    },
    [bridge],
  );

  const goBackToPreviousLocation = useCallback(() => {
    if (locationHistoryRef.current.length === 0) return;
    const previousCfi = locationHistoryRef.current.pop();
    if (previousCfi) {
      bridge.goToCFI(previousCfi);
    }
  }, [bridge]);

  const canGoBack = locationHistoryRef.current.length > 0;

  const handleSearchInput = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => {
        const trimmed = query.trim();
        if (trimmed) {
          setIsSearching(true);
          bridge.search(trimmed);
        } else {
          setSearchResultCount(0);
          setSearchIndex(0);
          bridge.clearSearch();
        }
      }, 300);
    },
    [bridge],
  );

  const navigateSearch = useCallback(
    (direction: "prev" | "next") => {
      if (searchResultCount === 0) return;
      const newIdx =
        direction === "next"
          ? (searchIndex + 1) % searchResultCount
          : (searchIndex - 1 + searchResultCount) % searchResultCount;
      setSearchIndex(newIdx);
      bridge.navigateSearch(newIdx);
    },
    [searchIndex, searchResultCount, bridge],
  );

  const updateSetting = useCallback(
    (key: string, value: number | string) => {
      const updates: Record<string, number | string> = {};
      updates[key] = value;
      updateReadSettings(updates);
      bridge.applySettings(updates);
    },
    [bridge, updateReadSettings],
  );

  // Selection popover handlers
  const handleHighlight = useCallback(
    (color: string) => {
      if (!selection) return;
      const highlight = {
        id: `hl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        bookId,
        cfi: selection.cfi,
        text: selection.text,
        color: color as any,
        chapterTitle: currentChapter,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      addHighlight(highlight);
      bridge.addAnnotation({ value: selection.cfi, color });
      setSelection(null);
    },
    [selection, bookId, currentChapter, addHighlight, bridge],
  );

  const handleDismissSelection = useCallback(() => {
    setSelection(null);
  }, []);

  const handleSpeak = useCallback(() => {
    if (!selection) return;
    ttsPlay(selection.text);
    setSelection(null);
    setShowTTS(true);
  }, [selection, ttsPlay]);

  const handleToggleTTS = useCallback(() => {
    if (showTTS) {
      ttsStop();
      setShowTTS(false);
    } else {
      setShowTTS(true);
    }
  }, [showTTS, ttsStop]);

  useEffect(() => {
    return () => {
      ttsStop();
      ttsSetOnEnd(null);
    };
  }, [ttsStop, ttsSetOnEnd]);

  if (loading && !webViewReady && !readerHtmlUri) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]}>
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={colors.indigo} />
          <Text style={s.loadingText}>{t("reader.loading", "正在加载...")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]}>
        <View style={s.loadingWrap}>
          <Text style={s.errorText}>{error}</Text>
          <TouchableOpacity style={s.backButton} onPress={() => navigation.goBack()}>
            <Text style={s.backButtonText}>{t("common.back", "返回")}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!readerHtmlUri) {
    return (
      <View style={s.container}>
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={colors.indigo} />
          <Text style={s.loadingText}>{t("reader.loading", "加载阅读器...")}</Text>
        </View>
      </View>
    );
  }

  const percent = Math.round(progress * 100);

  console.log("[ReaderScreen] Rendering WebView with URI:", readerHtmlUri);

  const isPanelOpen =
    showTOC || showSettings || showSearch || showNotebook || showTranslation || showTTS;

  return (
    <View style={[s.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* WebView with foliate-js */}
      <WebView
        ref={bridge.webViewRef}
        source={{ uri: readerHtmlUri }}
        style={s.webview}
        pointerEvents={isPanelOpen ? "none" : "auto"}
        onMessage={bridge.handleMessage}
        onError={(e) => {
          console.error("[ReaderScreen] WebView error:", e.nativeEvent);
        }}
        onHttpError={(e) => {
          console.error("[ReaderScreen] WebView HTTP error:", e.nativeEvent);
        }}
        onLoadStart={() => {
          console.log("[ReaderScreen] WebView load start");
        }}
        onLoadEnd={() => {
          console.log("[ReaderScreen] WebView load end");
        }}
        onLoadProgress={(e) => {
          console.log("[ReaderScreen] WebView load progress:", e.nativeEvent.progress);
        }}
        onContentProcessDidTerminate={() => {
          console.warn("[ReaderScreen] WebView content process terminated");
        }}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        allowsInlineMediaPlayback
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        originWhitelist={["*"]}
        mixedContentMode="always"
      />

      {/* Loading overlay */}
      {loading && (
        <View style={s.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.indigo} />
        </View>
      )}

      {/* Selection Popover */}
      {selection && (
        <SelectionPopover
          selection={selection}
          onHighlight={handleHighlight}
          onDismiss={handleDismissSelection}
          onCopy={() => {
            setSelection(null);
          }}
          onAIChat={() => {
            setSelection(null);
            navigation.navigate("BookChat", { bookId });
          }}
          onNote={(text, cfi) => {
            const highlight = {
              id: `hl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              bookId,
              cfi,
              text: selection.text,
              color: "yellow" as const,
              note: text,
              chapterTitle: currentChapter,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            addHighlight(highlight);
            bridge.addAnnotation({ value: cfi, color: "yellow", note: text });
          }}
          onTranslate={(text) => {
            setShowTranslation(true);
            setTranslationText(text);
          }}
          existingHighlight={
            highlights.find((h) => h.cfi === selection.cfi)
              ? {
                id: highlights.find((h) => h.cfi === selection.cfi)!.id,
                color: highlights.find((h) => h.cfi === selection.cfi)!.color,
                note: highlights.find((h) => h.cfi === selection.cfi)!.note,
              }
              : null
          }
          onRemoveHighlight={() => {
            const existing = highlights.find((h) => h.cfi === selection.cfi);
            if (existing) {
              removeHighlight(existing.id);
              bridge.removeAnnotation({ value: existing.cfi });
            }
          }}
        />
      )}

      {/* Note Tooltip (long-press on wavy underline) */}
      {noteTooltip && (
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={() => {
            if (noteTooltipTimer.current) {
              clearTimeout(noteTooltipTimer.current);
              noteTooltipTimer.current = null;
            }
            setNoteTooltip(null);
          }}
        >
          <View
            style={[
              s.noteTooltip,
              {
                left: Math.max(
                  12,
                  Math.min(noteTooltip.position.x - 150, SCREEN_WIDTH - 312),
                ),
                ...(noteTooltip.position.selectionTop > 220
                  ? { bottom: SCREEN_HEIGHT - noteTooltip.position.selectionTop + 8 }
                  : { top: noteTooltip.position.selectionBottom + 12 }),
              },
            ]}
            onStartShouldSetResponder={() => true}
          >
            <View style={s.noteTooltipContent}>
              <MarkdownRenderer
                content={noteTooltip.note}
                styleOverrides={noteTooltipMdStyles}
              />
            </View>
          </View>
        </TouchableOpacity>
      )}

      {/* ─── Toolbar ─── */}
      {!showSearch && (
        <Animated.View style={[s.toolbar, { transform: [{ translateY: toolbarAnim }] }]}>
          <View style={[s.toolbarGlass, { marginTop: insets.top + 8 }]}>
            <View style={s.toolbarRow}>
              <TouchableOpacity style={s.toolbarBtn} onPress={() => navigation.goBack()}>
                <ChevronLeftIcon size={20} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.toolbarBtn, !canGoBack && s.toolbarBtnDisabled]}
                onPress={goBackToPreviousLocation}
                disabled={!canGoBack}
              >
                <Undo2Icon size={18} color={canGoBack ? "#fff" : "rgba(255,255,255,0.3)"} />
              </TouchableOpacity>
              <View style={s.toolbarCenter}>
                <Text style={s.toolbarTitle} numberOfLines={1}>
                  {bookTitle}
                </Text>
                {currentChapter ? (
                  <Text style={s.toolbarChapter} numberOfLines={1}>
                    {currentChapter}
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity
                style={s.toolbarBtn}
                onPress={() => navigation.navigate("FullScreenNotes", { bookId })}
              >
                <NotebookPenIcon size={18} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={s.toolbarBtn}
                onPress={() => navigation.navigate("BookChat", { bookId })}
              >
                <MessageSquareIcon size={18} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity style={s.toolbarBtn} onPress={() => setShowTOC(true)}>
                <ListIcon size={18} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={s.toolbarBtn}
                onPress={() => {
                  setShowSearch(true);
                  setShowControls(false);
                  Animated.parallel([
                    Animated.spring(toolbarAnim, {
                      toValue: TOOLBAR_HIDE_OFFSET,
                      useNativeDriver: true,
                      friction: 20,
                      tension: 100,
                    }),
                    Animated.spring(footerAnim, {
                      toValue: FOOTER_HIDE_OFFSET,
                      useNativeDriver: true,
                      friction: 20,
                      tension: 100,
                    }),
                  ]).start();
                }}
              >
                <SearchIcon size={18} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.toolbarBtn, showTTS && s.toolbarBtnActive]}
                onPress={handleToggleTTS}
              >
                <Volume2Icon size={18} color={showTTS ? colors.indigo : "#fff"} />
              </TouchableOpacity>
              <TouchableOpacity style={s.toolbarBtn} onPress={() => setShowSettings(true)}>
                <SettingsIcon size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      )}

      {/* ─── Footer ─── */}
      {!showSearch && (
        <Animated.View style={[s.footer, { transform: [{ translateY: footerAnim }] }]}>
          <View style={[s.footerGlass, { marginBottom: insets.bottom + 8 }]}>
            <View style={s.footerPageRow}>
              <Text style={s.footerPageText}>
                {currentPage > 0 && totalPages > 0 ? `${currentPage} / ${totalPages}` : ""}
              </Text>
              <Text style={s.footerPageText}>{percent}%</Text>
            </View>
            <View style={s.footerSliderRow}>
              <TouchableOpacity style={s.footerNavBtn} onPress={bridge.goPrev}>
                <ChevronLeftIcon size={18} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>
              <View style={s.sliderWrap}>
                <View style={s.sliderTrack}>
                  <View style={[s.sliderFill, { width: `${percent}%` }]} />
                </View>
              </View>
              <TouchableOpacity style={s.footerNavBtn} onPress={bridge.goNext}>
                <ChevronRightIcon size={18} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      )}

      {/* ─── Always-visible thin progress bar ─── */}
      <View style={[s.thinProgressWrap, { bottom: insets.bottom || 0 }]}>
        <View style={[s.thinProgressFill, { width: `${percent}%` }]} />
      </View>

      {/* ─── Search Bar ─── */}
      {showSearch && (
        <View style={[s.searchBarWrap, { paddingTop: insets.top }]}>
          <View style={s.searchBarRow}>
            <View style={s.searchInputWrap}>
              <SearchIcon size={16} color={colors.mutedForeground} />
              <TextInput
                style={s.searchInput}
                placeholder={t("reader.searchInBook", "在书中搜索")}
                placeholderTextColor={colors.mutedForeground}
                value={searchQuery}
                onChangeText={handleSearchInput}
                autoFocus
                returnKeyType="search"
              />
            </View>
            <View style={s.searchMetaRow}>
              {isSearching ? (
                <ActivityIndicator size="small" color={colors.mutedForeground} />
              ) : searchQuery && searchResultCount > 0 ? (
                <Text style={s.searchCount}>
                  {searchIndex + 1} / {searchResultCount}
                </Text>
              ) : searchQuery && !isSearching ? (
                <Text style={s.searchCount}>0</Text>
              ) : null}
            </View>
            <TouchableOpacity
              style={s.searchNavBtn}
              onPress={() => navigateSearch("prev")}
              disabled={searchResultCount === 0}
            >
              <ChevronLeftIcon
                size={16}
                color={searchResultCount > 0 ? colors.foreground : colors.mutedForeground}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={s.searchNavBtn}
              onPress={() => navigateSearch("next")}
              disabled={searchResultCount === 0}
            >
              <ChevronRightIcon
                size={16}
                color={searchResultCount > 0 ? colors.foreground : colors.mutedForeground}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={s.searchNavBtn}
              onPress={() => {
                setShowSearch(false);
                setSearchQuery("");
                setSearchResultCount(0);
                setSearchIndex(0);
                bridge.clearSearch();
                setShowControls(true);
                Animated.parallel([
                  Animated.spring(toolbarAnim, {
                    toValue: 0,
                    useNativeDriver: true,
                    friction: 20,
                    tension: 100,
                  }),
                  Animated.spring(footerAnim, {
                    toValue: 0,
                    useNativeDriver: true,
                    friction: 20,
                    tension: 100,
                  }),
                ]).start();
              }}
            >
              <XIcon size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ─── TOC Panel ─── */}
      <Modal
        visible={showTOC}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTOC(false)}
      >
        <Pressable style={s.modalBackdrop} onPress={() => setShowTOC(false)} />
        <View
          style={[
            s.bottomSheet,
            { maxHeight: SCREEN_HEIGHT * 0.7, paddingBottom: insets.bottom || 16 },
          ]}
        >
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>{t("reader.toc", "目录")}</Text>
            <TouchableOpacity onPress={() => setShowTOC(false)}>
              <XIcon size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} style={s.sheetScroll}>
            {toc.length > 0 ? (
              toc.map((item) => (
                <TOCTreeItem
                  key={item.id || item.href}
                  item={item}
                  level={0}
                  currentChapter={currentChapter}
                  onSelect={goToTocItem}
                />
              ))
            ) : (
              <Text style={s.sheetEmpty}>{t("reader.noToc", "暂无目录信息")}</Text>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* ─── Settings Panel ─── */}
      <Modal
        visible={showSettings}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSettings(false)}
      >
        <Pressable style={s.modalBackdrop} onPress={() => setShowSettings(false)} />
        <View style={[s.bottomSheet, { paddingBottom: insets.bottom || 16 }]}>
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>{t("reader.settings", "阅读设置")}</Text>
            <TouchableOpacity onPress={() => setShowSettings(false)}>
              <XIcon size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Font Size */}
            <View style={s.settingRow}>
              <Text style={s.settingLabel}>{t("reader.fontSize", "字号")}</Text>
              <View style={s.settingControl}>
                <TouchableOpacity
                  style={s.stepBtn}
                  onPress={() => updateSetting("fontSize", Math.max(12, settingFontSize - 1))}
                >
                  <Text style={s.stepBtnText}>A-</Text>
                </TouchableOpacity>
                <Text style={s.settingValue}>{settingFontSize}</Text>
                <TouchableOpacity
                  style={s.stepBtn}
                  onPress={() => updateSetting("fontSize", Math.min(32, settingFontSize + 1))}
                >
                  <Text style={s.stepBtnText}>A+</Text>
                </TouchableOpacity>
              </View>
            </View>
            {/* Line Height */}
            <View style={s.settingRow}>
              <Text style={s.settingLabel}>{t("reader.lineHeight", "行高")}</Text>
              <View style={s.settingControl}>
                <TouchableOpacity
                  style={s.stepBtn}
                  onPress={() =>
                    updateSetting(
                      "lineHeight",
                      Math.round(Math.max(1.2, settingLineHeight - 0.1) * 10) / 10,
                    )
                  }
                >
                  <Text style={s.stepBtnText}>-</Text>
                </TouchableOpacity>
                <Text style={s.settingValue}>{settingLineHeight.toFixed(1)}</Text>
                <TouchableOpacity
                  style={s.stepBtn}
                  onPress={() =>
                    updateSetting(
                      "lineHeight",
                      Math.round(Math.min(2.5, settingLineHeight + 0.1) * 10) / 10,
                    )
                  }
                >
                  <Text style={s.stepBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
            {/* Paragraph Spacing */}
            <View style={s.settingRow}>
              <Text style={s.settingLabel}>{t("reader.paragraphSpacing", "段间距")}</Text>
              <View style={s.settingControl}>
                <TouchableOpacity
                  style={s.stepBtn}
                  onPress={() =>
                    updateSetting("paragraphSpacing", Math.max(0, settingParagraphSpacing - 2))
                  }
                >
                  <Text style={s.stepBtnText}>-</Text>
                </TouchableOpacity>
                <Text style={s.settingValue}>{settingParagraphSpacing}</Text>
                <TouchableOpacity
                  style={s.stepBtn}
                  onPress={() =>
                    updateSetting("paragraphSpacing", Math.min(24, settingParagraphSpacing + 2))
                  }
                >
                  <Text style={s.stepBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
            {/* Page Margin */}
            <View style={s.settingRow}>
              <Text style={s.settingLabel}>{t("reader.pageMargin", "页边距")}</Text>
              <View style={s.settingControl}>
                <TouchableOpacity
                  style={s.stepBtn}
                  onPress={() => updateSetting("pageMargin", Math.max(0, settingPageMargin - 4))}
                >
                  <Text style={s.stepBtnText}>-</Text>
                </TouchableOpacity>
                <Text style={s.settingValue}>{settingPageMargin}</Text>
                <TouchableOpacity
                  style={s.stepBtn}
                  onPress={() => updateSetting("pageMargin", Math.min(48, settingPageMargin + 4))}
                >
                  <Text style={s.stepBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
            {/* Font Theme */}
            <View style={s.settingRow}>
              <Text style={s.settingLabel}>{t("reader.fontTheme", "字体主题")}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.themeScroll}>
                <View style={s.themeRow}>
                  {FONT_THEMES.map((theme) => (
                    <TouchableOpacity
                      key={theme.id}
                      style={[s.themeBtn, settingFontTheme === theme.id && s.themeBtnActive]}
                      onPress={() => updateSetting("fontTheme", theme.id)}
                    >
                      <Text
                        style={[
                          s.themeBtnText,
                          settingFontTheme === theme.id && s.themeBtnTextActive,
                        ]}
                      >
                        {t(theme.labelKey, theme.fallback)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
            {/* View Mode */}
            <View style={s.settingRow}>
              <Text style={s.settingLabel}>{t("reader.viewMode", "阅读模式")}</Text>
              <View style={s.viewModeRow}>
                <TouchableOpacity
                  style={[s.viewModeBtn, settingViewMode === "paginated" && s.viewModeBtnActive]}
                  onPress={() => updateSetting("viewMode", "paginated")}
                >
                  <Text
                    style={[
                      s.viewModeBtnText,
                      settingViewMode === "paginated" && s.viewModeBtnTextActive,
                    ]}
                  >
                    {t("reader.paginated", "翻页")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.viewModeBtn, settingViewMode === "scroll" && s.viewModeBtnActive]}
                  onPress={() => updateSetting("viewMode", "scroll")}
                >
                  <Text
                    style={[
                      s.viewModeBtnText,
                      settingViewMode === "scroll" && s.viewModeBtnTextActive,
                    ]}
                  >
                    {t("reader.scrollMode", "滚动")}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ─── Notebook Panel ─── */}
      <Modal
        visible={showNotebook}
        transparent
        animationType="slide"
        onRequestClose={() => setShowNotebook(false)}
      >
        <Pressable style={s.modalBackdrop} onPress={() => setShowNotebook(false)} />
        <View
          style={[
            s.bottomSheet,
            { maxHeight: SCREEN_HEIGHT * 0.7, paddingBottom: insets.bottom || 16 },
          ]}
        >
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>{t("reader.notebook", "笔记本")}</Text>
            <TouchableOpacity onPress={() => setShowNotebook(false)}>
              <XIcon size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          {highlights.length > 0 ? (
            <ScrollView showsVerticalScrollIndicator={false} style={s.sheetScroll}>
              {highlights.map((h) => (
                <View key={h.id} style={s.highlightItem}>
                  <View
                    style={[
                      s.highlightColorDot,
                      {
                        backgroundColor:
                          h.color === "yellow"
                            ? "#facc15"
                            : h.color === "green"
                              ? "#4ade80"
                              : h.color === "blue"
                                ? "#60a5fa"
                                : h.color === "pink"
                                  ? "#ec4899"
                                  : h.color === "red"
                                    ? "#f87171"
                                    : "#a78bfa",
                      },
                    ]}
                  />
                  <View style={s.highlightContent}>
                    <Text style={s.highlightText} numberOfLines={3}>
                      {h.text}
                    </Text>
                    {h.note && <Text style={s.highlightNote}>{h.note}</Text>}
                  </View>
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={s.notebookPlaceholder}>
              <NotebookPenIcon size={40} color={colors.mutedForeground} />
              <Text style={s.notebookPlaceholderText}>
                {t("reader.notebookHint", "在阅读时选中文字来创建笔记和高亮")}
              </Text>
            </View>
          )}
        </View>
      </Modal>

      {/* ─── Note View Modal ─── */}
      <Modal
        visible={!!noteViewHighlight}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setNoteViewHighlight(null);
          setNoteViewEditing(false);
        }}
      >
        <KeyboardAvoidingView
          style={s.noteViewOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => {
              setNoteViewHighlight(null);
              setNoteViewEditing(false);
            }}
          />
          <View style={[s.noteViewModal, { paddingBottom: insets.bottom || 16 }]}>
            <View style={s.noteViewHeader}>
              <Text style={s.noteViewTitle}>{t("reader.viewNote", "查看笔记")}</Text>
              <TouchableOpacity
                style={s.noteViewCloseBtn}
                onPress={() => {
                  setNoteViewHighlight(null);
                  setNoteViewEditing(false);
                }}
              >
                <XIcon size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            {noteViewHighlight && (
              <>
                <Text style={s.noteViewQuote} numberOfLines={3}>
                  "{noteViewHighlight.text}"
                </Text>
                {noteViewEditing ? (
                  <>
                    <View style={s.noteViewEditorContainer}>
                      <RichTextEditor
                        initialContent={noteViewContent}
                        onChange={setNoteViewContent}
                        placeholder={t("reader.notePlaceholder", "写下你的想法...")}
                        autoFocus
                      />
                    </View>
                    <View style={s.noteViewActions}>
                      <TouchableOpacity
                        style={s.noteViewCancelBtn}
                        onPress={() => {
                          setNoteViewEditing(false);
                          setNoteViewContent(noteViewHighlight.note);
                        }}
                      >
                        <XIcon size={14} color={colors.mutedForeground} />
                        <Text style={s.noteViewCancelText}>{t("common.cancel", "取消")}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={s.noteViewSaveBtn}
                        onPress={() => {
                          if (noteViewContent.trim()) {
                            const { updateHighlight } = useAnnotationStore.getState();
                            updateHighlight(noteViewHighlight.id, { note: noteViewContent.trim() });
                            bridge.removeAnnotation({ value: noteViewHighlight.cfi });
                            bridge.addAnnotation({
                              value: noteViewHighlight.cfi,
                              color: noteViewHighlight.color,
                              note: noteViewContent.trim(),
                            });
                            setNoteViewHighlight({
                              ...noteViewHighlight,
                              note: noteViewContent.trim(),
                            });
                          }
                          setNoteViewEditing(false);
                        }}
                      >
                        <CheckIcon size={14} color={colors.primaryForeground} />
                        <Text style={s.noteViewSaveText}>{t("common.save", "保存")}</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <>
                    <ScrollView style={s.noteViewBody} showsVerticalScrollIndicator={false}>
                      <MarkdownRenderer content={noteViewHighlight.note} />
                    </ScrollView>
                    <View style={s.noteViewActions}>
                      <TouchableOpacity
                        style={s.noteViewEditBtn}
                        onPress={() => {
                          setNoteViewContent(noteViewHighlight.note);
                          setNoteViewEditing(true);
                        }}
                      >
                        <EditIcon size={14} color={colors.primaryForeground} />
                        <Text style={s.noteViewEditText}>{t("common.edit", "编辑")}</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── Translation Panel ─── */}
      {showTranslation && translationText && (
        <TranslationPanel
          text={translationText}
          onClose={() => {
            setShowTranslation(false);
            setTranslationText("");
          }}
        />
      )}

      {/* ─── TTS Controls ─── */}
      {showTTS && (
        <TTSControls
          onClose={() => {
            ttsStop();
            setShowTTS(false);
          }}
        />
      )}
    </View>
  );
}

const TOOLTIP_FG = "#f1f5f9";
const TOOLTIP_MUTED = "rgba(148, 163, 184, 0.5)";
const noteTooltipMdStyles = {
  body: { color: TOOLTIP_FG, fontSize: 13, lineHeight: 19 },
  paragraph: { color: TOOLTIP_FG, fontSize: 13, lineHeight: 19, marginBottom: 4, marginTop: 0 },
  heading1: { color: "#fff", fontSize: 15, fontWeight: "600" as const, marginBottom: 4, marginTop: 4 },
  heading2: { color: "#fff", fontSize: 14, fontWeight: "600" as const, marginBottom: 3, marginTop: 3 },
  heading3: { color: "#fff", fontSize: 13, fontWeight: "600" as const, marginBottom: 2, marginTop: 2 },
  strong: { fontWeight: "700" as const, color: "#fff" },
  em: { fontStyle: "italic" as const, color: "#e2e8f0" },
  link: { color: "#60a5fa" },
  code_inline: { backgroundColor: "rgba(255,255,255,0.1)", color: TOOLTIP_FG, fontSize: 12, fontFamily: "Menlo" },
  code_block: { backgroundColor: "rgba(0,0,0,0.3)", color: TOOLTIP_FG, fontSize: 12, fontFamily: "Menlo", padding: 8 },
  fence: { backgroundColor: "rgba(0,0,0,0.3)", color: TOOLTIP_FG, fontSize: 12, fontFamily: "Menlo", padding: 8 },
  blockquote: { borderLeftWidth: 2, borderLeftColor: TOOLTIP_MUTED, paddingLeft: 10, backgroundColor: "transparent" },
  bullet_list: { marginVertical: 2 },
  ordered_list: { marginVertical: 2 },
  list_item: { marginBottom: 2, flexDirection: "row" as const },
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    webview: { flex: 1 },
    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
    loadingText: { fontSize: fontSize.sm, color: colors.mutedForeground },
    errorText: {
      fontSize: fontSize.base,
      color: colors.destructive,
      textAlign: "center",
      paddingHorizontal: 24,
    },
    backButton: {
      marginTop: 16,
      paddingHorizontal: 24,
      paddingVertical: 10,
      borderRadius: radius.lg,
      backgroundColor: colors.primary,
    },
    backButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primaryForeground,
    },
    loadingOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.background,
      zIndex: 20,
    },

    toolbar: { position: "absolute", top: 0, left: 12, right: 12, zIndex: 30 },
    toolbarGlass: {
      backgroundColor: "rgba(28, 28, 30, 0.85)",
      borderRadius: 20,
      paddingVertical: 8,
      paddingHorizontal: 12,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 16,
      elevation: 12,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.1)",
    },
    toolbarRow: { flexDirection: "row", alignItems: "center", gap: 2 },
    toolbarBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
    },
    toolbarBtnActive: { backgroundColor: "rgba(99,102,241,0.3)" },
    toolbarBtnDisabled: { opacity: 0.4 },
    toolbarCenter: { flex: 1, paddingHorizontal: 8, alignItems: "center" },
    toolbarTitle: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: "#fff",
      letterSpacing: 0.3,
    },
    toolbarChapter: { fontSize: fontSize.xs, color: "rgba(255,255,255,0.5)", marginTop: 1 },

    footer: { position: "absolute", bottom: 0, left: 12, right: 12, zIndex: 30 },
    footerGlass: {
      backgroundColor: "rgba(28, 28, 30, 0.85)",
      borderRadius: 20,
      paddingVertical: 10,
      paddingHorizontal: 16,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.3,
      shadowRadius: 16,
      elevation: 12,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.1)",
    },
    footerPageRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
    footerPageText: {
      fontSize: fontSize.xs,
      color: "rgba(255,255,255,0.5)",
      fontWeight: fontWeight.medium,
    },
    footerSliderRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    footerNavBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(255,255,255,0.1)",
    },
    sliderWrap: { flex: 1, justifyContent: "center", paddingVertical: 4 },
    sliderTrack: {
      height: 3,
      backgroundColor: "rgba(255,255,255,0.15)",
      borderRadius: 1.5,
      overflow: "hidden",
    },
    sliderFill: { height: "100%", backgroundColor: colors.indigo, borderRadius: 1.5 },

    thinProgressWrap: {
      position: "absolute",
      left: 0,
      right: 0,
      height: 2,
      backgroundColor: "rgba(255,255,255,0.05)",
      zIndex: 40,
    },
    thinProgressFill: { height: "100%", backgroundColor: colors.indigo, opacity: 0.8 },

    searchBarWrap: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      backgroundColor: colors.background,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
      zIndex: 40,
    },
    searchBarRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    searchInputWrap: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.muted,
      borderRadius: radius.lg,
      paddingHorizontal: 10,
      height: 36,
      gap: 6,
    },
    searchInput: { flex: 1, fontSize: fontSize.sm, color: colors.foreground, padding: 0 },
    searchMetaRow: { flexDirection: "row", alignItems: "center" },
    searchCount: { fontSize: fontSize.xs, color: colors.mutedForeground },
    searchNavBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.lg,
      alignItems: "center",
      justifyContent: "center",
    },

    modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
    bottomSheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.xxl,
      borderTopRightRadius: radius.xxl,
      padding: 16,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    sheetTitle: {
      fontSize: fontSize.md,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    sheetScroll: { maxHeight: SCREEN_HEIGHT * 0.5 },
    sheetEmpty: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      textAlign: "center",
      paddingVertical: 32,
    },

    settingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
    },
    settingLabel: { fontSize: fontSize.sm, color: colors.mutedForeground },
    settingControl: { flexDirection: "row", alignItems: "center", gap: 12 },
    stepBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.lg,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    stepBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.foreground },
    settingValue: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
      minWidth: 32,
      textAlign: "center",
    },
    themeScroll: { maxWidth: 220 },
    themeRow: { flexDirection: "row", gap: 6 },
    themeBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.lg,
      backgroundColor: colors.muted,
    },
    themeBtnActive: { backgroundColor: colors.primary },
    themeBtnText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
    },
    themeBtnTextActive: { color: colors.primaryForeground },
    viewModeRow: { flexDirection: "row", gap: 8 },
    viewModeBtn: {
      paddingHorizontal: 16,
      paddingVertical: 6,
      borderRadius: radius.lg,
      backgroundColor: colors.muted,
    },
    viewModeBtnActive: { backgroundColor: colors.primary },
    viewModeBtnText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
    },
    viewModeBtnTextActive: { color: colors.primaryForeground },

    notebookPlaceholder: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 48,
      gap: 12,
    },
    notebookPlaceholderText: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      textAlign: "center",
      paddingHorizontal: 32,
    },

    highlightItem: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      paddingVertical: 8,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
    },
    highlightColorDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
    highlightContent: { flex: 1 },
    highlightText: { fontSize: fontSize.sm, color: colors.foreground, lineHeight: 18 },
    highlightNote: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 4 },

    noteViewOverlay: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "rgba(0,0,0,0.5)",
    },
    noteViewModal: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.xxl,
      borderTopRightRadius: radius.xxl,
      padding: 16,
      maxHeight: SCREEN_HEIGHT * 0.75,
    },
    noteViewHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    noteViewTitle: {
      fontSize: fontSize.md,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    noteViewCloseBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.muted,
    },
    noteViewQuote: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      marginBottom: 12,
      fontStyle: "italic",
      lineHeight: 20,
      paddingHorizontal: 8,
      borderLeftWidth: 2,
      borderLeftColor: colors.primary,
    },
    noteViewBody: {
      maxHeight: SCREEN_HEIGHT * 0.35,
      backgroundColor: colors.muted,
      borderRadius: radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    noteViewEditorContainer: {
      height: 200,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    noteViewActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 8,
      marginTop: 12,
    },
    noteViewEditBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.primary,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.lg,
    },
    noteViewEditText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primaryForeground,
    },
    noteViewCancelBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.lg,
    },
    noteViewCancelText: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    noteViewSaveBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.primary,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.lg,
    },
    noteViewSaveText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primaryForeground,
    },

    noteTooltip: {
      position: "absolute",
      width: 300,
      maxHeight: 200,
      backgroundColor: "rgba(15, 23, 42, 0.95)",
      borderRadius: radius.lg,
      padding: 12,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.3,
      shadowRadius: 16,
      elevation: 12,
      borderWidth: 1,
      borderColor: "rgba(100, 116, 139, 0.3)",
      zIndex: 90,
    },
    noteTooltipContent: {
      maxHeight: 140,
      overflow: "hidden",
    },
  });
