import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { BookmarkRibbon } from "@/components/reader/BookmarkRibbon";
import { ChapterTranslationSheet } from "@/components/reader/ChapterTranslationSheet";
import { SelectionPopover } from "@/components/reader/SelectionPopover";
import { TTSPage } from "@/components/reader/TTSPage";
import { TranslationPanel } from "@/components/reader/TranslationPanel";
import {
  BotIcon,
  BookmarkFilledIcon,
  BookmarkIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EditIcon,
  HeadphonesIcon,
  LanguagesIcon,
  NotebookPenIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "@/components/ui/Icon";
import { RichTextEditor } from "@/components/ui/RichTextEditor";
import { useReaderBridge } from "@/hooks/use-reader-bridge";
import type { RelocateEvent, SelectionEvent, VisibleTTSSegment } from "@/hooks/use-reader-bridge";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import {
  useAnnotationStore,
  useLibraryStore,
  useReadingSessionStore,
  useReaderStore,
  useSettingsStore,
  useTTSStore,
} from "@/stores";
import { useTheme } from "@/styles/ThemeContext";
import {
  type ThemeColors,
  fontSize,
  fontWeight,
  radius,
  useColors,
  withOpacity,
} from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { readingContextService } from "@readany/core/ai/reading-context-service";
import { runWithDbRetry } from "@readany/core/db/write-retry";
import { useChapterTranslation } from "@readany/core/hooks";
import { useReadingSession } from "@readany/core/hooks/use-reading-session";
import { createSelectionNoteMutation } from "@readany/core/reader";
import { getPlatformService } from "@readany/core/services";
import { splitNarrationText } from "@readany/core/tts";
import type { ReadSettings, TOCItem } from "@readany/core/types";
import { generateId } from "@readany/core/utils";
import { eventBus } from "@readany/core/utils/event-bus";
import { throttle } from "@readany/core/utils/throttle";
import { Asset } from "expo-asset";
import * as Battery from "expo-battery";
import * as FileSystem from "expo-file-system/legacy";
import { setStatusBarHidden } from "expo-status-bar";
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
  Alert,
  Animated,
  Dimensions,
  Easing,
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
import Svg, { Path, Rect } from "react-native-svg";
import { WebView } from "react-native-webview";

const READER_HTML_ASSET = Asset.fromModule(require("../../assets/reader/reader.html"));

type Props = NativeStackScreenProps<RootStackParamList, "Reader">;
type TTSSegment = VisibleTTSSegment;

const SCREEN_WIDTH = Dimensions.get("window").width;
const SCREEN_HEIGHT = Dimensions.get("window").height;
const CONTROLS_TIMEOUT = 4000;

function formatReaderClock(date: Date) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const FONT_THEMES = [
  { id: "default", labelKey: "reader.fontThemeDefault", fallback: "System" },
  { id: "classic", labelKey: "reader.fontThemeClassic", fallback: "Classic" },
  { id: "modern", labelKey: "reader.fontThemeModern", fallback: "Modern" },
  { id: "elegant", labelKey: "reader.fontThemeElegant", fallback: "Elegant" },
  { id: "literary", labelKey: "reader.fontThemeLiterary", fallback: "Literary" },
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

function BatteryIcon({
  width = 24,
  height = 12,
  color = "#e8e8ed",
  level,
}: {
  width?: number;
  height?: number;
  color?: string;
  level?: number | null;
}) {
  const normalizedLevel =
    typeof level === "number" && Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : null;
  const bodyWidth = width - 3;
  const innerPadding = 1.5;
  const innerWidth = Math.max(0, bodyWidth - innerPadding * 2);
  const fillWidth =
    normalizedLevel == null ? innerWidth * 0.42 : Math.max(2, innerWidth * normalizedLevel);
  const fillColor =
    normalizedLevel != null && normalizedLevel <= 0.2 ? "#ef4444" : color;

  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Rect x={1} y={1} width={bodyWidth} height={height - 2} rx={2.8} />
      <Rect
        x={3}
        y={2.6}
        width={fillWidth}
        height={Math.max(0, height - 5.2)}
        rx={1.8}
        fill={fillColor}
        stroke="none"
      />
      <Rect
        x={width - 2}
        y={height / 2 - 2}
        width={2}
        height={4}
        rx={1}
        fill={color}
        stroke="none"
      />
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
    itemActive: { backgroundColor: `${colors.primary}18` },
    expandBtn: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
    expandPlaceholder: { width: 20 },
    itemText: { fontSize: fontSize.sm, color: colors.foreground, flex: 1 },
    itemTextActive: { color: colors.primary, fontWeight: fontWeight.medium },
  });

// ──────────────────────────── ReaderScreen ────────────────────────────
export function ReaderScreen({ route, navigation }: Props) {
  const colors = useColors();
  const { mode: themeMode } = useTheme();
  const s = makeStyles(colors);
  const { bookId, cfi, highlight: shouldHighlight } = route.params;
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const isWideLayout = SCREEN_WIDTH >= 768;
  const isIPadLayout = Platform.OS === "ios" && Platform.isPad;
  const shouldToggleSystemStatusBar = !isIPadLayout;
  const baseTopInset = Platform.OS === "ios" ? 20 : 24;

  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [showTOC, setShowTOC] = useState(false);
  const [tocActiveTab, setTocActiveTab] = useState<"toc" | "bookmarks">("toc");
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showNotebook, setShowNotebook] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translationText, setTranslationText] = useState("");
  const [showTTS, setShowTTS] = useState(false);
  const [showChapterTranslation, setShowChapterTranslation] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResultCount, setSearchResultCount] = useState(0);
  const [searchIndex, setSearchIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [searchStartCfi, setSearchStartCfi] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentChapter, setCurrentChapter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [toc, setToc] = useState<TOCItem[]>([]);
  const [bookTitle, setBookTitle] = useState("");
  const [webViewReady, setWebViewReady] = useState(false);
  const [translationReady, setTranslationReady] = useState(false);
  const [readerHtmlUri, setReaderHtmlUri] = useState<string | null>(null);
  const [ttsCoverUri, setTtsCoverUri] = useState<string | undefined>(undefined);
  const [ttsLastText, setTtsLastText] = useState("");
  const [ttsSegments, setTtsSegments] = useState<TTSSegment[]>([]);
  const [ttsPrevPageSegments, setTtsPrevPageSegments] = useState<TTSSegment[]>([]);
  const [ttsFutureSegments, setTtsFutureSegments] = useState<TTSSegment[]>([]);
  const [currentCfi, setCurrentCfi] = useState("");
  const [pageSnippet, setPageSnippet] = useState("");
  const [readerClock, setReaderClock] = useState(() => formatReaderClock(new Date()));
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [selection, setSelection] = useState<SelectionEvent | null>(null);
  const [stableTopInset, setStableTopInset] = useState(() =>
    Math.max(insets.top, isIPadLayout ? 24 : baseTopInset)
  );
  const [noteViewHighlight, setNoteViewHighlight] = useState<{
    id: string;
    text: string;
    note?: string;
    cfi: string;
    color: string;
  } | null>(null);
  const [noteViewEditing, setNoteViewEditing] = useState(false);
  const [noteViewContent, setNoteViewContent] = useState("");
  const [ttsSourceKind, setTtsSourceKind] = useState<"page" | "selection">("page");
  const [ttsContinuousEnabled, setTtsContinuousEnabled] = useState(true);
  const [noteTooltip, setNoteTooltip] = useState<{
    note: string;
    cfi: string;
    position: { x: number; y: number; selectionTop: number; selectionBottom: number };
  } | null>(null);
  const noteTooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assetLoadedRef = useRef(false);
  const pendingBookmarkRef = useRef(false);

  const bridgeRef = useRef<{
    requestPageSnippet: () => void;
    goNext: () => void;
    getVisibleText: () => Promise<string>;
    getVisibleTTSSegments: (alignCfi?: string | null) => Promise<TTSSegment[]>;
    getTTSSegmentContext: (
      cfi: string,
      before?: number,
      after?: number,
    ) => Promise<{ before: TTSSegment[]; after: TTSSegment[] }>;
    goToCFI: (cfi: string) => void;
    flashHighlight: (cfi: string, color?: string, duration?: number) => void;
    addAnnotation: (annotation: { value: string; type?: string; color?: string; note?: string }) => void;
    removeAnnotation: (annotation: { value: string; type?: string }) => void;
    setTTSHighlight: (cfi: string | null, color?: string, force?: boolean) => void;
  } | null>(null);

  // Chapter translation state
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const webViewRefForVisibility = useRef<WebView | null>(null);
  const chapterTranslationBridgeRef = useRef<{
    getChapterParagraphs: () => Promise<Array<{ id: string; text: string; tagName: string }>>;
    injectChapterTranslations: (
      results: Array<{ paragraphId: string; originalText: string; translatedText: string }>,
    ) => void;
    removeChapterTranslations: () => void;
  } | null>(null);

  const readSettings = useSettingsStore((s) => s.readSettings);
  const updateReadSettings = useSettingsStore((s) => s.updateReadSettings);
  const translationConfig = useSettingsStore((s) => s.translationConfig);
  const aiConfig = useSettingsStore((s) => s.aiConfig);
  const settingFontSize = readSettings.fontSize;
  const settingLineHeight = readSettings.lineHeight;
  const settingParagraphSpacing = readSettings.paragraphSpacing;
  const settingPageMargin = readSettings.pageMargin;
  const settingFontTheme = readSettings.fontTheme;
  const settingViewMode = readSettings.viewMode;
  const showTopTitleProgress = readSettings.showTopTitleProgress !== false;
  const showBottomTimeBattery = readSettings.showBottomTimeBattery !== false;

  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const TOOLBAR_HIDE_OFFSET = 100;
  const toolbarAnim = useRef(new Animated.Value(TOOLBAR_HIDE_OFFSET)).current;
  const readerPullAnim = useRef(new Animated.Value(0)).current;
  const lastCfiRef = useRef<string>("");
  const progressRef = useRef(0);
  const locationHistoryRef = useRef<string[]>([]);
  const lastNavigatedCfiRef = useRef<string | undefined>(undefined);
  const ttsSegmentsRef = useRef<TTSSegment[]>([]);
  const ttsLastTextRef = useRef("");
  const ttsFutureSegmentsRef = useRef<TTSSegment[]>([]);
  const ttsLoadMoreAboveRef = useRef<string | null>(null);
  const ttsLoadMoreBelowRef = useRef<string | null>(null);
  const lastTTSLyricPrimeSignatureRef = useRef<string | null>(null);
  const ttsContextCacheRef = useRef<Map<string, { before: TTSSegment[]; after: TTSSegment[] }>>(
    new Map(),
  );
  const ttsContextInflightRef = useRef<
    Map<string, Promise<{ before: TTSSegment[]; after: TTSSegment[] }>>
  >(new Map());

  const {} = useReadingSessionStore(); // Removed startSession and stopSession
  const { sendEvent } = useReadingSession(bookId); // Added useReadingSession hook
  const { books, updateBook } = useLibraryStore();
  const setGoToCfiFn = useReaderStore((s) => s.setGoToCfiFn);

  // Throttled progress save (same as desktop - 5 seconds)
  const throttledSaveProgress = useRef(
    throttle((bId: string, prog: number, cfi: string) => {
      updateBook(bId, {
        progress: prog,
        currentCfi: cfi,
      });
    }, 5000),
  ).current;
  const {
    addHighlight,
    updateHighlight,
    removeHighlight,
    loadAnnotations,
    highlights,
    bookmarks,
    addBookmark,
    removeBookmark,
  } = useAnnotationStore();
  const ttsPlay = useTTSStore((s) => s.play);
  const ttsPause = useTTSStore((s) => s.pause);
  const ttsResume = useTTSStore((s) => s.resume);
  const ttsStop = useTTSStore((s) => s.stop);
  const ttsPlayState = useTTSStore((s) => s.playState);
  const ttsCurrentText = useTTSStore((s) => s.currentText);
  const ttsConfig = useTTSStore((s) => s.config);
  const ttsUpdateConfig = useTTSStore((s) => s.updateConfig);
  const ttsSetOnEnd = useTTSStore((s) => s.setOnEnd);
  const ttsSetCurrentBook = useTTSStore((s) => s.setCurrentBook);
  const ttsSetCurrentLocation = useTTSStore((s) => s.setCurrentLocation);
  const ttsCurrentLocationCfi = useTTSStore((s) => s.currentLocationCfi);
  const ttsCurrentBookId = useTTSStore((s) => s.currentBookId);
  const ttsCurrentChunkIndex = useTTSStore((s) => s.currentChunkIndex);
  const ttsTotalChunks = useTTSStore((s) => s.totalChunks);
  const ttsJumpToChunk = useTTSStore((s) => s.jumpToChunk);
  const TTS_CONTEXT_CACHE_LIMIT = 24;
  const TTS_CONTEXT_WINDOW = 12;

  const book = useMemo(() => books.find((b) => b.id === bookId), [books, bookId]);
  const currentTTSSegment = useMemo(
    () =>
      ttsSegments.length > 0 && ttsCurrentChunkIndex >= 0
        ? ttsSegments[Math.min(ttsCurrentChunkIndex, ttsSegments.length - 1)] || null
        : null,
    [ttsCurrentChunkIndex, ttsSegments],
  );
  const ttsHighlightColor = "rgba(96, 165, 250, 0.35)";
  const ttsSourceLabel =
    ttsSourceKind === "selection"
      ? t("tts.fromSelection", "来自选中文本")
      : t("tts.fromCurrentPage", "从当前页开始");

  useEffect(() => {
    const raw = book?.meta.coverUrl;
    if (!raw) {
      setTtsCoverUri(undefined);
      return;
    }
    if (raw.startsWith("http") || raw.startsWith("blob") || raw.startsWith("file")) {
      setTtsCoverUri(raw);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();
        const absPath = await platform.joinPath(appData, raw);
        if (!cancelled) {
          setTtsCoverUri(absPath);
        }
      } catch {
        if (!cancelled) {
          setTtsCoverUri(undefined);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [book?.meta.coverUrl]);

  // Chapter translation hook
  const chapterTranslation = useChapterTranslation({
    bookId,
    sectionIndex: currentSectionIndex,
    aiConfig,
    ready: translationReady,
    translationConfig,
    getParagraphs: async () => {
      if (!chapterTranslationBridgeRef.current) return [];
      return chapterTranslationBridgeRef.current.getChapterParagraphs();
    },
    injectTranslations: (results) => {
      chapterTranslationBridgeRef.current?.injectChapterTranslations(results);
    },
    removeTranslations: () => {
      chapterTranslationBridgeRef.current?.removeChapterTranslations();
    },
    applyVisibility: (originalVisible, translationVisible) => {
      const translationHidden = !translationVisible;
      const originalHidden = !originalVisible;
      const solo = !originalVisible && translationVisible;
      webViewRefForVisibility.current?.injectJavaScript(`
        (function() {
          try {
            var doc = null;
            var renderer = typeof view !== 'undefined' && view && view.renderer;
            if (renderer && renderer.getContents) {
              var contents = renderer.getContents();
              if (contents && contents[0] && contents[0].doc) doc = contents[0].doc;
            }
            if (!doc) {
              var iframes = document.querySelectorAll('iframe');
              for (var fi = 0; fi < iframes.length; fi++) {
                try {
                  var iframeDoc = iframes[fi].contentDocument || (iframes[fi].contentWindow && iframes[fi].contentWindow.document);
                  if (iframeDoc && iframeDoc.body) { doc = iframeDoc; break; }
                } catch (e) {}
              }
            }
            if (!doc) return;
            var els = doc.querySelectorAll('.readany-translation');
            for (var i = 0; i < els.length; i++) {
              els[i].setAttribute('data-hidden', '${translationHidden}');
              els[i].setAttribute('data-solo', '${solo}');
            }
            var origEls = doc.querySelectorAll('[data-translate-id]');
            for (var j = 0; j < origEls.length; j++) {
              origEls[j].setAttribute('data-original-hidden', '${originalHidden}');
            }
          } catch(e) {}
        })();
        true;
      `);
    },
  });

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  // Bookmark state
  const existingBookmark = useMemo(
    () => bookmarks.find((b) => b.bookId === bookId && b.cfi === currentCfi),
    [bookmarks, bookId, currentCfi],
  );
  const isBookmarked = !!existingBookmark;
  const bookBookmarks = useMemo(
    () => bookmarks.filter((b) => b.bookId === bookId),
    [bookmarks, bookId],
  );

  const handleToggleBookmark = useCallback(() => {
    if (!currentCfi || !bookId) return;
    if (isBookmarked && existingBookmark) {
      removeBookmark(existingBookmark.id);
    } else {
      // Request fresh snippet from WebView — bookmark will be created in onPageSnippet callback
      pendingBookmarkRef.current = true;
      bridgeRef.current?.requestPageSnippet();
      // Safety fallback: create bookmark without snippet if WebView doesn't respond in 500ms
      setTimeout(() => {
        if (pendingBookmarkRef.current) {
          pendingBookmarkRef.current = false;
          addBookmark({
            id: generateId(),
            bookId,
            cfi: currentCfi,
            label: undefined,
            chapterTitle: currentChapter || undefined,
            createdAt: Date.now(),
          });
        }
      }, 500);
    }
  }, [
    currentCfi,
    bookId,
    isBookmarked,
    existingBookmark,
    currentChapter,
    removeBookmark,
    addBookmark,
  ]);

  // Keep the reserved top inset stable even when the system status bar hides.
  useEffect(() => {
    if (!shouldToggleSystemStatusBar) {
      setStatusBarHidden(false, "none");
      return;
    }
    setStatusBarHidden(!showSearch, "slide");
  }, [showSearch, shouldToggleSystemStatusBar]);

  useEffect(() => {
    return () => {
      setStatusBarHidden(false, "slide");
    };
  }, []);

  useEffect(() => {
    const nextInset = Math.max(insets.top, isIPadLayout ? 24 : baseTopInset);
    setStableTopInset((prev) => {
      if (isIPadLayout) {
        return Math.max(prev, nextInset);
      }
      return nextInset;
    });
  }, [baseTopInset, insets.top, isIPadLayout]);

  useEffect(() => {
    const updateClock = () => setReaderClock(formatReaderClock(new Date()));
    updateClock();
    const timer = setInterval(updateClock, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let mounted = true;

    const syncBattery = async () => {
      try {
        const nextLevel = await Battery.getBatteryLevelAsync();
        if (mounted) {
          setBatteryLevel(typeof nextLevel === "number" && nextLevel >= 0 ? nextLevel : null);
        }
      } catch {
        if (mounted) {
          setBatteryLevel(null);
        }
      }
    };

    syncBattery();
    const subscription = Battery.addBatteryLevelListener(({ batteryLevel: nextLevel }) => {
      setBatteryLevel(typeof nextLevel === "number" && nextLevel >= 0 ? nextLevel : null);
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  // Load reader HTML asset
  useEffect(() => {
    if (assetLoadedRef.current) return;
    assetLoadedRef.current = true;

    const loadAsset = async () => {
      try {
        const asset = READER_HTML_ASSET;
        await asset.downloadAsync();
        const uri = asset.localUri || asset.uri;
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
      // Patch WebView functions to bypass Expo Asset cache issues
      bridge.webViewRef.current?.injectJavaScript(`
        (function() {
          if (!window.__view && document.querySelector('foliate-view')) {
            window.__view = document.querySelector('foliate-view');
          }

          // ── Patch doGetVisibleTTSSegments ──
          // Only adds TTS engine reinit for section changes on top of the original.
          // The original extractVisibleTTSSegments handles paginated overflow correctly.
          window.doGetVisibleTTSSegments = async function(alignCfi) {
            try {
              var maxWaitMs = 3000, pollMs = 80, waited = 0;
              while (waited < maxWaitMs) {
                var contents = (window.__view || document.querySelector('foliate-view'));
                if (contents && contents.renderer) {
                  var c = contents.renderer.getContents();
                  if (c && c.length > 0 && c.some(function(x) { return x.overlayer; })) break;
                }
                await new Promise(function(r) { setTimeout(r, pollMs); });
                waited += pollMs;
              }

              // Ensure TTS engine is initialized (or reinit if section changed)
              // Prefer ensureTTSEngine which sets up the full CFI generation callback
              if (typeof ensureTTSEngine === 'function') {
                try { await ensureTTSEngine(); } catch(e) {}
              } else {
                var v = window.__view || document.querySelector('foliate-view');
                if (v) {
                  var currentDoc = v.renderer && v.renderer.getContents && v.renderer.getContents()[0] && v.renderer.getContents()[0].doc;
                  if (v.initTTS && (!v.tts || !v.tts.doc || (currentDoc && v.tts.doc !== currentDoc))) {
                    try { await v.initTTS('sentence'); } catch(e) {}
                  }
                }
              }

              // Delegate to the original extractVisibleTTSSegments
              // When alignCfi is provided, the original returns unfiltered TTS engine segments
              // (bypassing CFI intersection), which fixes sentence swallowing.
              var segments = [];
              if (typeof extractVisibleTTSSegments === 'function') {
                try { segments = extractVisibleTTSSegments(alignCfi || null) || []; } catch(e) {}
              }

              window.ReactNativeWebView.postMessage(JSON.stringify({type:'visibleTTSSegments',segments:segments}));
            } catch(e) {
              window.ReactNativeWebView.postMessage(JSON.stringify({type:'visibleTTSSegments',segments:[],error:String(e)}));
            }
          };
        })();
        true;
      `);
    },
    onLoaded: () => {
      setLoading(false);
      const settings = useSettingsStore.getState().readSettings;
      bridge.applySettings({
        fontSize: settings.fontSize,
        lineHeight: settings.lineHeight,
        paragraphSpacing: settings.paragraphSpacing,
        fontTheme: settings.fontTheme,
        viewMode: settings.viewMode,
      });
    },
    onRelocate: (detail: RelocateEvent) => {
      console.log("[ReaderScreen] onRelocate", {
        section: detail.section,
        fraction: detail.fraction,
        cfi: detail.cfi,
        routeCfi: cfi,
        lastNavigated: lastNavigatedCfiRef.current,
      });
      // Track section changes for chapter translation reset
      const newSection = detail.section?.current ?? 0;
      if (newSection !== currentSectionIndex) {
        setCurrentSectionIndex(newSection);
        setTranslationReady(false);
        chapterTranslation.reset();
      }

      if (detail.fraction != null) setProgress(detail.fraction);
      if (detail.location?.total) {
        setCurrentPage(Math.max(1, detail.location.current));
        setTotalPages(Math.max(1, detail.location.total));
      } else if (detail.page) {
        setCurrentPage(Math.max(1, detail.page.current));
        setTotalPages(Math.max(1, detail.page.total));
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
        // Use throttled save instead of immediate update
        throttledSaveProgress(bookId, detail.fraction ?? 0, detail.cfi);
      }

      // Mark translation ready after first successful relocate (CFI navigation done)
      if (!translationReady) setTranslationReady(true);

      // If TTS is waiting for a page turn to complete, fire the continuation callback now
      // that the renderer has fully updated its position (renderer.start reflects new page).
      if (pendingTTSContinueCallbackRef.current) {
        console.log("[ReaderScreen][TTS] onRelocate triggered pending TTS continuation");
        const cb = pendingTTSContinueCallbackRef.current;
        pendingTTSContinueCallbackRef.current = null;
        // Cancel the safety timer since onRelocate fired successfully
        if (pendingTTSContinueSafetyTimerRef.current) {
          clearTimeout(pendingTTSContinueSafetyTimerRef.current);
          pendingTTSContinueSafetyTimerRef.current = null;
        }
        void cb();
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
    onToggleBookmark: () => {
      handleToggleBookmark();
    },
    onBookmarkPull: ({ offset, active }) => {
      if (active) {
        readerPullAnim.setValue(offset);
        return;
      }

      Animated.timing(readerPullAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start();
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
    onPageSnippet: (text: string) => {
      setPageSnippet(text);
    },
    onBookmarkSnippet: (text: string) => {
      if (pendingBookmarkRef.current) {
        pendingBookmarkRef.current = false;
        const cfi = currentCfi;
        if (cfi && bookId) {
          addBookmark({
            id: generateId(),
            bookId,
            cfi,
            label: text || undefined,
            chapterTitle: currentChapter || undefined,
            createdAt: Date.now(),
          });
        }
      }
    },
  });

  bridgeRef.current = bridge;
  chapterTranslationBridgeRef.current = bridge;

  useEffect(() => {
    setGoToCfiFn(() => bridge.goToCFI);
    return () => setGoToCfiFn(null);
  }, [bridge.goToCFI, setGoToCfiFn]);

  useEffect(() => {
    ttsSegmentsRef.current = ttsSegments;
    ttsLastTextRef.current = ttsLastText;
    ttsFutureSegmentsRef.current = ttsFutureSegments;
  }, [ttsFutureSegments, ttsLastText, ttsSegments]);

  useEffect(() => {
    ttsContextCacheRef.current.clear();
    ttsContextInflightRef.current.clear();
    ttsLoadMoreAboveRef.current = null;
    ttsLoadMoreBelowRef.current = null;
    lastTTSLyricPrimeSignatureRef.current = null;
  }, [bookId]);

  useEffect(() => {
    return eventBus.on("tts:jump-to-current", ({ bookId: targetBookId, cfi: targetCfi, respond }) => {
      if (targetBookId !== bookId || !targetCfi) return;
      setShowTTS(false);
      setShowControls(false);
      bridge.goToCFI(targetCfi);
      bridge.flashHighlight(targetCfi, colors.primary, 1200);
      respond?.();
    });
  }, [bookId, bridge, colors.primary]);

  useEffect(() => {
    return eventBus.on("tts:open-lyrics-page", ({ bookId: targetBookId, respond }) => {
      if (targetBookId !== bookId) return;
      setShowControls(false);
      setShowTTS(true);
      respond?.();
    });
  }, [bookId]);

  useEffect(() => {
    if (!webViewReady) return;
    if (ttsPlayState !== "playing" && ttsPlayState !== "paused" && ttsPlayState !== "loading") {
      bridge.setTTSHighlight(null);
      return;
    }
    if (ttsSourceKind !== "page") {
      bridge.setTTSHighlight(null);
      return;
    }
    const targetCfi = currentTTSSegment?.cfi || ttsCurrentLocationCfi || currentCfi || null;
    if (!targetCfi) {
      bridge.setTTSHighlight(null);
      return;
    }
    bridge.setTTSHighlight(targetCfi, ttsHighlightColor);
  }, [
    bridge,
    currentCfi,
    currentTTSSegment?.cfi,
    ttsCurrentLocationCfi,
    ttsPlayState,
    ttsSourceKind,
    webViewReady,
  ]);

  useEffect(() => {
    if (!webViewReady) return;
    if (ttsSourceKind !== "page") return;
    if (ttsPlayState !== "playing" && ttsPlayState !== "paused" && ttsPlayState !== "loading") return;
    const targetCfi = currentTTSSegment?.cfi || ttsCurrentLocationCfi || currentCfi || null;
    if (!targetCfi) return;
    bridge.setTTSHighlight(targetCfi, ttsHighlightColor, true);
  }, [
    bridge,
    currentCfi,
    currentTTSSegment?.cfi,
    ttsCurrentLocationCfi,
    ttsHighlightColor,
    ttsPlayState,
    ttsSourceKind,
    webViewReady,
  ]);

  useEffect(() => {
    if (ttsCurrentBookId !== bookId) return;
    const targetCfi =
      ttsSourceKind === "page" && (ttsPlayState === "playing" || ttsPlayState === "paused")
        ? currentTTSSegment?.cfi || currentCfi
        : currentCfi;
    if (targetCfi) {
      ttsSetCurrentLocation(targetCfi);
    }
  }, [
    bookId,
    currentCfi,
    currentTTSSegment?.cfi,
    ttsCurrentBookId,
    ttsPlayState,
    ttsSetCurrentLocation,
    ttsSourceKind,
  ]);

  useEffect(() => {
    if (!webViewReady) return;
    bridge.setBookmarkPullState({
      bookmarked: isBookmarked,
      pullToAdd: t("bookmarks.pullToAdd", "下滑添加书签"),
      releaseToAdd: t("bookmarks.releaseToAdd", "松手添加书签"),
      pullToRemove: t("bookmarks.pullToRemove", "下滑删除书签"),
      releaseToRemove: t("bookmarks.releaseToRemove", "松手删除书签"),
    });
  }, [bridge, isBookmarked, t, webViewReady]);

  // Sync webViewRefForVisibility when WebView is ready
  useEffect(() => {
    if (webViewReady && bridge.webViewRef.current) {
      webViewRefForVisibility.current = bridge.webViewRef.current;
    }
  }, [webViewReady]);

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

  useEffect(() => {
    return eventBus.on("sync:completed", () => {
      void loadAnnotations(bookId);
    });
  }, [bookId, loadAnnotations]);

  // Save progress immediately on unmount
  useEffect(() => {
    return () => {
      // Flush the last known position to database immediately
      if (lastCfiRef.current) {
        const db = require("@readany/core/db/database");
        runWithDbRetry(
          () =>
            db.updateBook(bookId, {
              progress: progressRef.current,
              currentCfi: lastCfiRef.current,
            }),
          { attempts: 10, initialDelayMs: 150 },
        ).catch((err: Error) => console.error("Failed to save progress on unmount:", err));
      }
    };
  }, [bookId]);

  // When WebView is ready and book is available, send the open command
  useEffect(() => {
    if (!webViewReady || !book?.filePath) {
      return;
    }

    const loadBook = async () => {
      try {
        // Resolve absolute path from relative path
        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();
        const absPath = await platform.joinPath(appData, book.filePath);
        const lastLocation = book.currentCfi || undefined;

        if (Platform.OS === "android") {
          // Android WebView fetch(file:// / content://) is unreliable here and can throw
          // "TypeError: Failed to fetch". Use base64 like iOS for consistent loading.
          const base64 = await FileSystem.readAsStringAsync(absPath, {
            encoding: FileSystem.EncodingType.Base64,
          });
          bridge.openBook({
            base64,
            fileName: book.filePath.split("/").pop() || "book.epub",
            lastLocation,
            pageMargin: settingPageMargin,
          });
        } else {
          const base64 = await FileSystem.readAsStringAsync(absPath, {
            encoding: FileSystem.EncodingType.Base64,
          });
          bridge.openBook({
            base64,
            fileName: book.filePath.split("/").pop() || "book.epub",
            lastLocation,
            pageMargin: settingPageMargin,
          });
        }

        // Set theme colors
        bridge.setThemeColors({
          background: colors.background,
          foreground: colors.foreground,
          muted: colors.mutedForeground,
          primary: colors.primary,
        });
      } catch (err: any) {
        console.error("[ReaderScreen] Failed to load book:", err);
        setError(err.message || "Failed to load book file");
        setLoading(false);
      }
    };

    loadBook();
  }, [webViewReady, book?.filePath, bookId]);

  // Apply theme colors when theme changes
  useEffect(() => {
    if (!webViewReady) return;
    bridge.setThemeColors({
      background: colors.background,
      foreground: colors.foreground,
      muted: colors.mutedForeground,
      primary: colors.primary,
    });
  }, [themeMode, webViewReady]);

  // Load annotations into reader when ready
  useEffect(() => {
    if (!webViewReady || loading || highlights.length === 0) return;
    for (const h of highlights) {
      bridge.addAnnotation({ value: h.cfi, type: "highlight", color: h.color, note: h.note });
    }
  }, [webViewReady, loading, highlights]);

  // Reset last navigated CFI when book changes
  useEffect(() => {
    lastNavigatedCfiRef.current = undefined;
  }, [bookId]);

  // Navigate to CFI when book is loaded (from NotesPage or AI citation navigation)
  useEffect(() => {
    if (!webViewReady || loading || !cfi || cfi === lastNavigatedCfiRef.current) return;
    console.log("[ReaderScreen] goToCFI effect fired", {
      routeCfi: cfi,
      lastNavigated: lastNavigatedCfiRef.current,
      webViewReady,
      loading,
    });
    bridge.goToCFI(cfi);
    lastNavigatedCfiRef.current = cfi;

    // Only flash highlight for AI citation (shouldHighlight === true)
    // Notes navigation should NOT highlight
    if (shouldHighlight) {
      let flashCount = 0;
      const maxFlashes = 3;
      const flashInterval = 500;

      const doFlash = () => {
        if (flashCount >= maxFlashes) return;

        bridge.flashHighlight(cfi, "orange", flashInterval);

        flashCount++;
        if (flashCount < maxFlashes) {
          setTimeout(doFlash, flashInterval + 100);
        }
      };

      setTimeout(doFlash, 100);
    }
  }, [webViewReady, loading, cfi, shouldHighlight, bridge]);

  // Lock navigation when selection is active
  useEffect(() => {
    if (!webViewReady) return;
    bridge.setNavigationLocked(!!selection);
  }, [webViewReady, selection]);

  // Controls toggle
  const toggleControls = useCallback(() => {
    const willShow = !showControls;
    setShowControls(willShow);
    Animated.timing(toolbarAnim, {
      toValue: willShow ? 0 : TOOLBAR_HIDE_OFFSET,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    if (willShow) {
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
      controlsTimer.current = setTimeout(() => {
        setShowControls(false);
        Animated.timing(toolbarAnim, {
          toValue: TOOLBAR_HIDE_OFFSET,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      }, CONTROLS_TIMEOUT);
    }
  }, [showControls, toolbarAnim]);

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
          // Record current position before searching
          if (!searchStartCfi && currentCfi) {
            setSearchStartCfi(currentCfi);
          }
          setIsSearching(true);
          bridge.search(trimmed);
        } else {
          setSearchResultCount(0);
          setSearchIndex(0);
          bridge.clearSearch();
        }
      }, 300);
    },
    [bridge, searchStartCfi, currentCfi],
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
    <K extends keyof ReadSettings,>(key: K, value: ReadSettings[K]) => {
      const updates = { [key]: value } as Partial<ReadSettings>;
      updateReadSettings(updates);
      const currentSettings = useSettingsStore.getState().readSettings;
      bridge.applySettings({
        ...currentSettings,
        ...updates,
      });
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
      bridge.addAnnotation({ value: selection.cfi, type: "highlight", color });
      setSelection(null);
    },
    [selection, bookId, currentChapter, addHighlight, bridge],
  );

  const handleDismissSelection = useCallback(() => {
    setSelection(null);
  }, []);

  const getNormalizedVisibleTTSSegments = useCallback(async (alignCfi?: string | null) => {
    const segmentCandidates = await bridgeRef.current?.getVisibleTTSSegments(alignCfi);
    const segments =
      segmentCandidates && segmentCandidates.length > 0
        ? segmentCandidates
        : splitNarrationText((await bridgeRef.current?.getVisibleText()) || "").map((segmentText) => ({
            text: segmentText,
            cfi: alignCfi || currentCfi,
          }));

    return segments
      .map((segment) => ({
        text: segment.text.trim(),
        cfi: segment.cfi,
      }))
      .filter((segment) => segment.text.length > 0);
  }, [currentCfi]);

  const dedupeTTSSegments = useCallback(
    (segments: TTSSegment[]) => {
      const seenCfi = new Set<string>();
      const result: TTSSegment[] = [];
      for (const segment of segments) {
        if (segment.cfi) {
          if (seenCfi.has(segment.cfi)) continue;
          seenCfi.add(segment.cfi);
        }
        if (!segment.text.trim()) continue;
        result.push(segment);
      }
      return result;
    },
    [],
  );

  const filterDistinctTTSSegments = useCallback(
    (incoming: TTSSegment[], ...existingGroups: TTSSegment[][]) => {
      const blockedCfi = new Set<string>();
      for (const segment of existingGroups.flat()) {
        if (segment.cfi) blockedCfi.add(segment.cfi);
      }
      const result: TTSSegment[] = [];
      for (const segment of dedupeTTSSegments(incoming)) {
        if (segment.cfi && blockedCfi.has(segment.cfi)) continue;
        if (segment.cfi) blockedCfi.add(segment.cfi);
        result.push(segment);
      }
      return result;
    },
    [dedupeTTSSegments],
  );

  const areTTSSegmentListsEqual = useCallback((a: TTSSegment[], b: TTSSegment[]) => {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if ((a[i]?.cfi || null) !== (b[i]?.cfi || null)) return false;
      if ((a[i]?.text || "").trim() !== (b[i]?.text || "").trim()) return false;
    }
    return true;
  }, []);

  const mergeUniqueTTSSegments: (
    base: TTSSegment[],
    incoming: TTSSegment[],
    direction?: "prepend" | "append",
  ) => TTSSegment[] = useCallback(
    (
      base: TTSSegment[],
      incoming: TTSSegment[],
      direction: "prepend" | "append" = "append",
    ) => {
      const ordered = direction === "prepend" ? [...incoming, ...base] : [...base, ...incoming];
      return dedupeTTSSegments(ordered);
    },
    [dedupeTTSSegments],
  );

  const getCachedTTSSegmentContext = useCallback(
    async (cfi: string | null | undefined, before = TTS_CONTEXT_WINDOW, after = TTS_CONTEXT_WINDOW) => {
      if (!cfi || !bridgeRef.current?.getTTSSegmentContext) {
        return { before: [], after: [] };
      }
      const key = `${cfi}|${before}|${after}`;
      const cached = ttsContextCacheRef.current.get(key);
      if (cached) {
        ttsContextCacheRef.current.delete(key);
        ttsContextCacheRef.current.set(key, cached);
        return cached;
      }

      const inflight = ttsContextInflightRef.current.get(key);
      if (inflight) {
        return inflight;
      }

      const request = bridgeRef.current
        .getTTSSegmentContext(cfi, before, after)
        .then((context) => {
          const normalized = {
            before: dedupeTTSSegments(
              (context.before || [])
                .map((segment) => ({ text: segment.text.trim(), cfi: segment.cfi }))
                .filter((segment) => segment.text.length > 0),
            ),
            after: dedupeTTSSegments(
              (context.after || [])
                .map((segment) => ({ text: segment.text.trim(), cfi: segment.cfi }))
                .filter((segment) => segment.text.length > 0),
            ),
          };
          ttsContextCacheRef.current.set(key, normalized);
          while (ttsContextCacheRef.current.size > TTS_CONTEXT_CACHE_LIMIT) {
            const oldestKey = ttsContextCacheRef.current.keys().next().value;
            if (!oldestKey) break;
            ttsContextCacheRef.current.delete(oldestKey);
          }
          return normalized;
        })
        .finally(() => {
          ttsContextInflightRef.current.delete(key);
        });

      ttsContextInflightRef.current.set(key, request);
      return request;
    },
    [TTS_CONTEXT_CACHE_LIMIT, TTS_CONTEXT_WINDOW, dedupeTTSSegments],
  );

  const primeTTSLyricContext = useCallback(
    async (
      currentCfi: string | null | undefined,
      firstCfi?: string | null,
      lastCfi?: string | null,
    ) => {
      if (!currentCfi) return;
      const [centerContext, leadingContext, trailingContext] = await Promise.all([
        getCachedTTSSegmentContext(currentCfi, TTS_CONTEXT_WINDOW, TTS_CONTEXT_WINDOW),
        firstCfi
          ? getCachedTTSSegmentContext(firstCfi, TTS_CONTEXT_WINDOW, 0)
          : Promise.resolve({ before: [], after: [] }),
        lastCfi
          ? getCachedTTSSegmentContext(lastCfi, 0, TTS_CONTEXT_WINDOW)
          : Promise.resolve({ before: [], after: [] }),
      ]);

      const previous = filterDistinctTTSSegments(
        [...(leadingContext.before || []), ...(centerContext.before || [])],
        ttsSegmentsRef.current,
      ).slice(-(TTS_CONTEXT_WINDOW * 2));

      const future = filterDistinctTTSSegments(
        [...(centerContext.after || []), ...(trailingContext.after || [])],
        previous,
        ttsSegmentsRef.current,
      ).slice(0, TTS_CONTEXT_WINDOW * 2);

      setTtsPrevPageSegments((prev) =>
        areTTSSegmentListsEqual(prev, previous) ? prev : previous,
      );
      setTtsFutureSegments((prev) => {
        if (areTTSSegmentListsEqual(prev, future)) {
          ttsFutureSegmentsRef.current = prev;
          return prev;
        }
        ttsFutureSegmentsRef.current = future;
        return future;
      });
    },
    [
      TTS_CONTEXT_WINDOW,
      areTTSSegmentListsEqual,
      filterDistinctTTSSegments,
      getCachedTTSSegmentContext,
    ],
  );

  const trimLeadingTTSOverlap = useCallback((previousSegments: TTSSegment[], nextSegments: TTSSegment[]) => {
    if (!previousSegments.length || !nextSegments.length) return nextSegments;
    const maxOverlap = Math.min(previousSegments.length, nextSegments.length);
    for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
      let matches = true;
      for (let i = 0; i < overlap; i += 1) {
        const previous = previousSegments[previousSegments.length - overlap + i];
        const next = nextSegments[i];
        const same = previous?.cfi
          ? previous.cfi === next?.cfi
          : previous?.text?.trim() === next?.text?.trim();
        if (!same) {
          matches = false;
          break;
        }
      }
      if (matches) {
        return nextSegments.slice(overlap);
      }
    }
    return nextSegments;
  }, []);

  // TTS auto page-turn handler
  const ttsContinuousRef = useRef(false);
  // Stores the callback to resume TTS after a page turn; triggered by onRelocate
  const pendingTTSContinueCallbackRef = useRef<(() => void) | null>(null);
  const pendingTTSContinueSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTTSPageEnd = useCallback(() => {
    if (!ttsContinuousRef.current) return;
    const previousSegments = ttsSegmentsRef.current;
    const previousFirstCfi = previousSegments[0]?.cfi || currentTTSSegment?.cfi || currentCfi;
    const previousText = ttsLastTextRef.current;
    console.log("[ReaderScreen][TTS] page end", {
      previousFirstCfi,
      previousTextLength: previousText.length,
      previousSegmentCount: previousSegments.length,
    });

    // Accumulate ALL previous pages so the lyric list is infinitely scrollable upward
    if (previousSegments.length > 0) {
      setTtsPrevPageSegments((prev) => mergeUniqueTTSSegments(prev, previousSegments, "append"));
    }
    setTtsSegments([]);
    setTtsFutureSegments([]);
    ttsFutureSegmentsRef.current = [];

    // Clear any lingering safety timer from a previous page turn
    if (pendingTTSContinueSafetyTimerRef.current) {
      clearTimeout(pendingTTSContinueSafetyTimerRef.current);
      pendingTTSContinueSafetyTimerRef.current = null;
    }

    // Store the continuation logic — will be triggered by onRelocate once the renderer
    // has fully updated to the new page position (renderer.start reflects new page).
    const continuationCallback = async () => {
      pendingTTSContinueCallbackRef.current = null;
      if (pendingTTSContinueSafetyTimerRef.current) {
        clearTimeout(pendingTTSContinueSafetyTimerRef.current);
        pendingTTSContinueSafetyTimerRef.current = null;
      }
      if (!ttsContinuousRef.current) return;

      const tryContinue = async (attempt = 0) => {
        const pageAnchorCfi =
          lastCfiRef.current || currentCfi || previousFirstCfi || previousSegments[0]?.cfi || null;
        const normalizedSegments = await getNormalizedVisibleTTSSegments(pageAnchorCfi);
        const dedupedSegments = trimLeadingTTSOverlap(previousSegments, normalizedSegments);
        const text = dedupedSegments.map((segment) => segment.text).join(" ").trim();
        const firstCfi = dedupedSegments[0]?.cfi || null;
        const isSamePage = !!text && text === previousText && firstCfi === previousFirstCfi;
        console.log("[ReaderScreen][TTS] continue check (post-relocate)", {
          attempt,
          pageAnchorCfi,
          firstCfi,
          textLength: text.length,
          segmentCount: dedupedSegments.length,
          rawSegmentCount: normalizedSegments.length,
          isSamePage,
        });

        // The WebView already polls internally for up to 3s waiting for renderer to settle.
        // If we still get nothing or same page, wait before the next attempt to avoid
        // concurrent requests conflicting on the single-slot pendingVisibleTTSSegmentsResolveRef.
        if (ttsContinuousRef.current && (!text || isSamePage) && attempt < 4) {
          setTimeout(() => {
            void tryContinue(attempt + 1);
          }, 800);
          return;
        }

        if (text && ttsContinuousRef.current) {
          setTtsSegments(dedupedSegments);
          setTtsFutureSegments([]);
          setTtsLastText(text);
          ttsSegmentsRef.current = dedupedSegments;
          ttsLastTextRef.current = text;
          ttsFutureSegmentsRef.current = [];
          void primeTTSLyricContext(
            dedupedSegments[0]?.cfi || firstCfi,
            dedupedSegments[0]?.cfi || firstCfi,
            dedupedSegments[dedupedSegments.length - 1]?.cfi || firstCfi,
          );
          ttsPlay(dedupedSegments.length > 0 ? dedupedSegments.map((segment) => segment.text) : text);
        } else {
          ttsContinuousRef.current = false;
          ttsSetOnEnd(null);
          ttsStop();
        }
      };

      void tryContinue(0);
    };

    pendingTTSContinueCallbackRef.current = continuationCallback;

    // Clear TTS highlight BEFORE navigating — otherwise addAnnotation for the
    // old segment's CFI will navigate the renderer back to the previous page,
    // causing a page-bounce loop that prevents the continuation from finding
    // any segments on the new page.
    bridgeRef.current?.setTTSHighlight(null);

    // Go to next page — onRelocate will fire after the renderer has fully updated
    bridgeRef.current?.goNext();

    // Safety fallback: if onRelocate never fires within 8s, run the callback anyway
    pendingTTSContinueSafetyTimerRef.current = setTimeout(() => {
      pendingTTSContinueSafetyTimerRef.current = null;
      // Atomically read-and-clear to prevent double-fire with onRelocate
      const cb = pendingTTSContinueCallbackRef.current;
      if (!cb) return;
      pendingTTSContinueCallbackRef.current = null;
      console.log("[ReaderScreen][TTS] safety timeout — onRelocate didn't fire, running continuation");
      void cb();
    }, 8000);
  }, [currentCfi, currentTTSSegment?.cfi, getNormalizedVisibleTTSSegments, mergeUniqueTTSSegments, primeTTSLyricContext, trimLeadingTTSOverlap, ttsPlay, ttsSetOnEnd, ttsStop]);

  useEffect(() => {
    const shouldContinue = ttsContinuousRef.current && ttsSourceKind === "page";
    ttsSetOnEnd(shouldContinue ? handleTTSPageEnd : null);
  }, [handleTTSPageEnd, ttsSetOnEnd, ttsSourceKind]);

  const handleTTSPrevChapter = useCallback(() => {
    // Find index of current chapter in toc, go to previous
    const idx = toc.findIndex((item) => item.title === currentChapter);
    const prevIdx = idx > 0 ? idx - 1 : 0;
    const prevHref = toc[prevIdx]?.href;
    if (prevHref) {
      bridge.goToHref(prevHref);
    }
  }, [toc, currentChapter, bridge]);

  const handleTTSNextChapter = useCallback(() => {
    const idx = toc.findIndex((item) => item.title === currentChapter);
    const nextIdx = idx >= 0 && idx < toc.length - 1 ? idx + 1 : toc.length - 1;
    const nextHref = toc[nextIdx]?.href;
    if (nextHref) {
      bridge.goToHref(nextHref);
    }
  }, [toc, currentChapter, bridge]);

  const startSelectionTTS = useCallback(
    (text: string) => {
      const normalized = text.trim();
      if (!normalized) return;
      const segments = splitNarrationText(normalized).map((segmentText) => ({
        text: segmentText,
        cfi: selection?.cfi || currentCfi,
      }));
      setTtsSourceKind("selection");
      setTtsContinuousEnabled(false);
      setTtsLastText(normalized);
      setTtsSegments(segments);
      setTtsPrevPageSegments([]);
      setTtsFutureSegments([]);
      ttsLastTextRef.current = normalized;
      ttsSegmentsRef.current = segments;
      ttsFutureSegmentsRef.current = [];
      ttsContinuousRef.current = false;
      ttsSetOnEnd(null);
      ttsSetCurrentLocation(selection?.cfi || currentCfi);
      ttsSetCurrentBook(bookTitle || book?.meta.title || "", currentChapter, bookId);
      setShowControls(false);
      setShowTTS(true);
      ttsPlay(segments.length > 0 ? segments.map((segment) => segment.text) : normalized);
    },
    [
      ttsPlay,
      ttsSetOnEnd,
      ttsSetCurrentBook,
      ttsSetCurrentLocation,
      bookTitle,
      book,
      currentChapter,
      bookId,
      selection?.cfi,
      currentCfi,
    ],
  );

  const startPageTTS = useCallback(
    async (continuous = ttsContinuousEnabled) => {
      const pageAnchorCfi = lastCfiRef.current || currentCfi || null;
      const normalizedSegments = await getNormalizedVisibleTTSSegments(pageAnchorCfi);
      const normalized = normalizedSegments.map((segment) => segment.text).join(" ").trim();
      if (!normalized) return;
      ttsStartChapterRef.current = currentChapter;
      setTtsSourceKind("page");
      setTtsContinuousEnabled(continuous);
      setTtsLastText(normalized);
      setTtsSegments(normalizedSegments);
      setTtsPrevPageSegments([]); // fresh start — no prev page
      setTtsFutureSegments([]);
      ttsLastTextRef.current = normalized;
      ttsSegmentsRef.current = normalizedSegments;
      ttsFutureSegmentsRef.current = [];
      ttsContinuousRef.current = continuous;
      ttsSetOnEnd(continuous ? handleTTSPageEnd : null);
      ttsSetCurrentBook(bookTitle || book?.meta.title || "", currentChapter, bookId);
      ttsSetCurrentLocation(normalizedSegments[0]?.cfi || pageAnchorCfi);
      setShowControls(false);
      setShowTTS(true);
      void primeTTSLyricContext(
        normalizedSegments[0]?.cfi || pageAnchorCfi,
        normalizedSegments[0]?.cfi || pageAnchorCfi,
        normalizedSegments[normalizedSegments.length - 1]?.cfi ||
          normalizedSegments[0]?.cfi ||
          pageAnchorCfi,
      );
      ttsPlay(normalizedSegments.length > 0 ? normalizedSegments.map((segment) => segment.text) : normalized);
    },
    [
      handleTTSPageEnd,
      getNormalizedVisibleTTSSegments,
      ttsContinuousEnabled,
      ttsPlay,
      ttsSetOnEnd,
      ttsSetCurrentBook,
      ttsSetCurrentLocation,
      bookTitle,
      book,
      currentChapter,
      bookId,
      currentCfi,
      primeTTSLyricContext,
    ],
  );

  const startPageTTSFromCfi = useCallback(
    async (targetCfi: string, targetText?: string) => {
      if (!targetCfi || !bridgeRef.current) return;
      pendingTTSContinueCallbackRef.current = null;
      if (pendingTTSContinueSafetyTimerRef.current) {
        clearTimeout(pendingTTSContinueSafetyTimerRef.current);
        pendingTTSContinueSafetyTimerRef.current = null;
      }
      bridgeRef.current.goToCFI(targetCfi);
      await new Promise((resolve) => setTimeout(resolve, 320));
      const normalizedSegments = await getNormalizedVisibleTTSSegments(targetCfi);
      const visibleSegments = normalizedSegments.length
        ? normalizedSegments
        : [{ text: (targetText || "").trim(), cfi: targetCfi }].filter((segment) => segment.text.length > 0);
      if (!visibleSegments.length) return;
      const context = await getCachedTTSSegmentContext(targetCfi, TTS_CONTEXT_WINDOW, TTS_CONTEXT_WINDOW);
      const previous = filterDistinctTTSSegments(context.before || [], visibleSegments);
      const future = filterDistinctTTSSegments(context.after || [], previous, visibleSegments);
      const nextText = visibleSegments.map((segment) => segment.text).join(" ").trim();
      setTtsSegments(visibleSegments);
      setTtsPrevPageSegments(previous);
      setTtsFutureSegments(future);
      setTtsLastText(nextText);
      ttsSegmentsRef.current = visibleSegments;
      ttsLastTextRef.current = nextText;
      ttsFutureSegmentsRef.current = future;
      ttsSetCurrentLocation(visibleSegments[0]?.cfi || targetCfi);
      ttsContinuousRef.current = ttsSourceKind === "page" && ttsContinuousEnabled;
      ttsSetOnEnd(ttsContinuousRef.current ? handleTTSPageEnd : null);
      ttsPlay(visibleSegments.map((segment) => segment.text));
    },
    [
      filterDistinctTTSSegments,
      getCachedTTSSegmentContext,
      getNormalizedVisibleTTSSegments,
      handleTTSPageEnd,
      TTS_CONTEXT_WINDOW,
      ttsContinuousEnabled,
      ttsPlay,
      ttsSetCurrentLocation,
      ttsSetOnEnd,
      ttsSourceKind,
    ],
  );

  const handleSpeak = useCallback(() => {
    if (!selection) return;
    startSelectionTTS(selection.text);
    setSelection(null);
  }, [selection, startSelectionTTS]);

  // Track the chapter that was active when TTS was last started, so we know
  // if the user has navigated to a different chapter since then.
  const ttsStartChapterRef = useRef<string>("");

  const handleToggleTTS = useCallback(async () => {
    if (showTTS) {
      setShowTTS(false);
      return;
    }

    const hasActiveSession = ttsPlayState !== "stopped" || !!(ttsCurrentText || ttsLastText).trim();
    const isPlaying = ttsPlayState === "playing" || ttsPlayState === "loading";
    const chapterChanged = ttsStartChapterRef.current !== "" && ttsStartChapterRef.current !== currentChapter;

    // If playing, always just re-show (don't interrupt playback)
    // If stopped/paused with active session and same chapter, also just re-show
    if (hasActiveSession && (isPlaying || !chapterChanged)) {
      setShowControls(false);
      setShowTTS(true);
      return;
    }

    // Otherwise refresh: either first time, or chapter changed while not playing
    ttsStartChapterRef.current = currentChapter;
    await startPageTTS(ttsContinuousEnabled);
  }, [
    showTTS,
    startPageTTS,
    ttsContinuousEnabled,
    ttsCurrentText,
    ttsLastText,
    ttsPlayState,
    currentChapter,
  ]);

  const handleTTSReplay = useCallback(async () => {
    if (ttsSourceKind === "selection") {
      const text = (ttsCurrentText || ttsLastText).trim();
      if (text) {
        startSelectionTTS(text);
      }
      return;
    }

    await startPageTTS(ttsContinuousEnabled);
  }, [
    startPageTTS,
    startSelectionTTS,
    ttsContinuousEnabled,
    ttsCurrentText,
    ttsLastText,
    ttsSourceKind,
  ]);

  const handleTTSPlayPause = useCallback(async () => {
    if (ttsPlayState === "loading" || ttsPlayState === "playing") {
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

    await startPageTTS(ttsContinuousEnabled);
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

  const handleJumpToTTSSegment = useCallback(
    (offsetFromCurrent = 0) => {
      // Play from the tapped sentence — keep TTS page open
      if (offsetFromCurrent < 0) {
        // Tapped a prev-page segment — compute absolute index in prevPageSegments
        const prevIndex = ttsPrevPageSegments.length + offsetFromCurrent;
        const safeIdx = Math.max(0, prevIndex);
        const fromPrev = ttsPrevPageSegments.slice(safeIdx);
        const allSegments = [...fromPrev, ...ttsSegments];
        if (allSegments.length === 0) return;
        // Update UI state first, then play after React re-renders so safeChunkIndex is correct
        const newPrev = ttsPrevPageSegments.slice(0, safeIdx);
        const nextText = allSegments.map((segment) => segment.text).join(" ").trim();
        const nextCfi = allSegments[0]?.cfi || currentCfi;
        setTtsPrevPageSegments(newPrev);
        setTtsSegments(allSegments);
        setTtsLastText(nextText);
        ttsSegmentsRef.current = allSegments;
        ttsLastTextRef.current = nextText;
        ttsSetCurrentLocation(nextCfi);
        if (nextCfi) {
          bridge.goToCFI(nextCfi);
        }
        setTimeout(() => ttsPlay(allSegments.map((s) => s.text)), 0);
      } else {
        // Tapped a current-page segment — slice from that offset
        const safeIdx = Math.max(0, Math.min(offsetFromCurrent, ttsSegments.length - 1));
        const sliced = ttsSegments.slice(safeIdx);
        if (sliced.length === 0) return;
        // Update UI state first, then play after React re-renders so safeChunkIndex is correct
        const newPrev = [...ttsPrevPageSegments, ...ttsSegments.slice(0, safeIdx)];
        const nextText = sliced.map((segment) => segment.text).join(" ").trim();
        const nextCfi = sliced[0]?.cfi || currentCfi;
        setTtsPrevPageSegments(newPrev);
        setTtsSegments(sliced);
        setTtsLastText(nextText);
        ttsSegmentsRef.current = sliced;
        ttsLastTextRef.current = nextText;
        ttsSetCurrentLocation(nextCfi);
        if (nextCfi) {
          bridge.goToCFI(nextCfi);
        }
        setTimeout(() => ttsPlay(sliced.map((s) => s.text)), 0);
      }
    },
    [
      bridge,
      currentCfi,
      ttsPlay,
      ttsPrevPageSegments,
      ttsSegments,
      ttsSetCurrentLocation,
    ],
  );

  const handleJumpToTTSLyricSegment = useCallback(
    (segment: { text: string; cfi?: string | null }, offsetFromCurrent: number) => {
      // offsetFromCurrent = lyricIndex - prevCount
      // lyricSegments = [...ttsPrevPageSegments, ...ttsSegments, ...ttsFutureSegments]
      // offsetFromCurrent < 0                      → prev segment
      // 0 <= offsetFromCurrent < ttsSegments.length → current TTS session
      // offsetFromCurrent >= ttsSegments.length     → future segment

      // ── Within current TTS session: instant jump ──
      if (offsetFromCurrent >= 0 && offsetFromCurrent < ttsSegments.length) {
        ttsJumpToChunk(offsetFromCurrent);
        if (segment.cfi) {
          bridge.setTTSHighlight(segment.cfi, ttsHighlightColor);
        }
        return;
      }

      // ── Jumping to a prev-page segment (data already in memory) ──
      if (offsetFromCurrent < 0) {
        const prevIndex = ttsPrevPageSegments.length + offsetFromCurrent;
        const safeIdx = Math.max(0, prevIndex);
        const fromPrev = ttsPrevPageSegments.slice(safeIdx);
        const allSegments = [...fromPrev, ...ttsSegments, ...ttsFutureSegments];
        if (allSegments.length === 0) return;
        const newPrev = ttsPrevPageSegments.slice(0, safeIdx);
        const targetChunkInNew = 0; // play from the first (target) segment
        const nextText = allSegments.map((s) => s.text).join(" ").trim();
        const nextCfi = allSegments[0]?.cfi || currentCfi;
        setTtsPrevPageSegments(newPrev);
        setTtsSegments(allSegments);
        setTtsFutureSegments([]);
        setTtsLastText(nextText);
        ttsSegmentsRef.current = allSegments;
        ttsLastTextRef.current = nextText;
        ttsFutureSegmentsRef.current = [];
        ttsSetCurrentLocation(nextCfi);
        if (nextCfi) bridge.goToCFI(nextCfi);
        // Play all segments, starting from the target
        ttsPlay(allSegments.map((s) => s.text));
        // jumpToChunk(0) is implicit since play() starts from index 0
        return;
      }

      // ── Jumping to a future segment (data already in memory) ──
      const futureOffset = offsetFromCurrent - ttsSegments.length;
      if (futureOffset >= 0 && futureOffset < ttsFutureSegments.length) {
        // Move consumed ttsSegments + skipped future segments to prev
        const consumedCurrent = ttsSegments;
        const skippedFuture = ttsFutureSegments.slice(0, futureOffset);
        const remainingFuture = ttsFutureSegments.slice(futureOffset);
        const newPrev = [...ttsPrevPageSegments, ...consumedCurrent, ...skippedFuture];
        const nextText = remainingFuture.map((s) => s.text).join(" ").trim();
        const nextCfi = remainingFuture[0]?.cfi || currentCfi;
        setTtsPrevPageSegments(newPrev);
        setTtsSegments(remainingFuture);
        setTtsFutureSegments([]);
        setTtsLastText(nextText);
        ttsSegmentsRef.current = remainingFuture;
        ttsLastTextRef.current = nextText;
        ttsFutureSegmentsRef.current = [];
        ttsSetCurrentLocation(nextCfi);
        if (nextCfi) bridge.goToCFI(nextCfi);
        ttsPlay(remainingFuture.map((s) => s.text));
        // Prime more context from the new position
        void primeTTSLyricContext(
          remainingFuture[0]?.cfi || nextCfi,
          remainingFuture[0]?.cfi || nextCfi,
          remainingFuture[remainingFuture.length - 1]?.cfi ||
            nextCfi,
        );
        return;
      }

      // ── Data not loaded yet — should not normally happen ──
      // Fall back to startPageTTSFromCfi which navigates and reloads
      if (segment.cfi) {
        void startPageTTSFromCfi(segment.cfi, segment.text);
      }
    },
    [
      bridge,
      currentCfi,
      primeTTSLyricContext,
      startPageTTSFromCfi,
      ttsJumpToChunk,
      ttsPlay,
      ttsPrevPageSegments,
      ttsSegments,
      ttsFutureSegments,
      ttsSetCurrentLocation,
    ],
  );

  const handleLoadMoreAboveTTSLyrics = useCallback(async () => {
    const anchorCfi = ttsPrevPageSegments[0]?.cfi || ttsSegments[0]?.cfi || null;
    if (!anchorCfi || ttsLoadMoreAboveRef.current === anchorCfi) {
      return;
    }
    ttsLoadMoreAboveRef.current = anchorCfi;
    try {
      const context = await getCachedTTSSegmentContext(anchorCfi, TTS_CONTEXT_WINDOW, 0);
      if (context.before?.length) {
        const incoming = filterDistinctTTSSegments(context.before, ttsPrevPageSegments, ttsSegments);
        if (incoming.length > 0) {
          setTtsPrevPageSegments((prev) => mergeUniqueTTSSegments(prev, incoming, "prepend"));
        }
      }
    } finally {
      ttsLoadMoreAboveRef.current = null;
    }
  }, [
    TTS_CONTEXT_WINDOW,
    filterDistinctTTSSegments,
    getCachedTTSSegmentContext,
    mergeUniqueTTSSegments,
    ttsPrevPageSegments,
    ttsSegments,
  ]);

  const handleLoadMoreBelowTTSLyrics = useCallback(async () => {
    const anchorCfi =
      ttsFutureSegments[ttsFutureSegments.length - 1]?.cfi ||
      ttsSegments[ttsSegments.length - 1]?.cfi ||
      null;
    if (!anchorCfi || ttsLoadMoreBelowRef.current === anchorCfi) {
      return;
    }
    ttsLoadMoreBelowRef.current = anchorCfi;
    try {
      const context = await getCachedTTSSegmentContext(anchorCfi, 0, TTS_CONTEXT_WINDOW);
      if (context.after?.length) {
        const incoming = filterDistinctTTSSegments(
          context.after,
          ttsPrevPageSegments,
          ttsSegments,
          ttsFutureSegments,
        );
        if (incoming.length > 0) {
          setTtsFutureSegments((prev) => {
            const next = mergeUniqueTTSSegments(prev, incoming, "append");
            ttsFutureSegmentsRef.current = next;
            return next;
          });
        }
      }
    } finally {
      ttsLoadMoreBelowRef.current = null;
    }
  }, [
    TTS_CONTEXT_WINDOW,
    filterDistinctTTSSegments,
    getCachedTTSSegmentContext,
    mergeUniqueTTSSegments,
    ttsFutureSegments,
    ttsPrevPageSegments,
    ttsSegments,
  ]);

  useEffect(() => {
    if (!showTTS) {
      lastTTSLyricPrimeSignatureRef.current = null;
      return;
    }
    const activeCfi = currentTTSSegment?.cfi || ttsSegments[0]?.cfi || null;
    if (!activeCfi) return;
    const firstCfi = ttsPrevPageSegments[0]?.cfi || ttsSegments[0]?.cfi || activeCfi;
    const lastKnownCfi =
      ttsFutureSegments[ttsFutureSegments.length - 1]?.cfi ||
      ttsSegments[ttsSegments.length - 1]?.cfi ||
      activeCfi;
    const signature = `${activeCfi}|${firstCfi}|${lastKnownCfi}`;
    if (lastTTSLyricPrimeSignatureRef.current === signature) return;
    lastTTSLyricPrimeSignatureRef.current = signature;
    void primeTTSLyricContext(activeCfi, firstCfi, lastKnownCfi);
  }, [
    currentTTSSegment?.cfi,
    primeTTSLyricContext,
    showTTS,
    ttsFutureSegments,
    ttsPrevPageSegments,
    ttsSegments,
  ]);

  useEffect(() => {
    return () => {
      // Don't stop TTS on unmount — the floating bubble should keep playing
      // while the user navigates to other screens.
      // Just clear the continuous-reading callback that depends on this WebView.
      ttsContinuousRef.current = false;
      ttsSetOnEnd(null);
      bridgeRef.current?.setTTSHighlight(null);
    };
  }, [ttsSetOnEnd]);

  if (loading && !webViewReady && !readerHtmlUri) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]}>
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
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
          <TouchableOpacity
            style={s.backButton}
            onPress={() => navigation.reset({ routes: [{ name: "Tabs" }] })}
          >
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
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={s.loadingText}>{t("reader.loading", "加载阅读器...")}</Text>
        </View>
      </View>
    );
  }

  const layoutTopInset = stableTopInset;
  const topToolbarRowHeight = isWideLayout ? 62 : 48;
  const bottomDockIconSize = isWideLayout ? 24 : 22;
  const topToolbarIconSize = isWideLayout ? 24 : 22;
  const percent = Math.round(progress * 100);
  const topControlsTranslate = toolbarAnim.interpolate({
    inputRange: [0, TOOLBAR_HIDE_OFFSET],
    outputRange: [0, -10],
  });
  const topControlsOpacity = toolbarAnim.interpolate({
    inputRange: [0, TOOLBAR_HIDE_OFFSET * 0.5, TOOLBAR_HIDE_OFFSET],
    outputRange: [1, 0.28, 0],
  });
  const bottomControlsTranslate = toolbarAnim.interpolate({
    inputRange: [0, TOOLBAR_HIDE_OFFSET],
    outputRange: [0, 12],
  });
  const bottomControlsOpacity = toolbarAnim.interpolate({
    inputRange: [0, TOOLBAR_HIDE_OFFSET * 0.5, TOOLBAR_HIDE_OFFSET],
    outputRange: [1, 0.28, 0],
  });
  const auxToolsTranslate = toolbarAnim.interpolate({
    inputRange: [0, TOOLBAR_HIDE_OFFSET],
    outputRange: [0, 14],
  });
  const auxToolsOpacity = toolbarAnim.interpolate({
    inputRange: [0, TOOLBAR_HIDE_OFFSET * 0.55, TOOLBAR_HIDE_OFFSET],
    outputRange: [1, 0.24, 0],
  });

  const isPanelOpen = showTOC || showSettings || showSearch || showNotebook || showTranslation;
  const existingSelectionHighlight = selection
    ? (highlights.find((highlight) => highlight.cfi === selection.cfi) ?? null)
    : null;
  const readerTopMargin = !showSearch
    ? showTopTitleProgress
      ? layoutTopInset + 30
      : layoutTopInset
    : 0;
  const readerBottomInset = !showSearch && showBottomTimeBattery ? Math.max(insets.bottom, 8) + 14 : 0;
  const batteryLabel = batteryLevel == null ? "--%" : `${Math.round(batteryLevel * 100)}%`;

  return (
    <View style={[s.container, { paddingBottom: insets.bottom }]}>
      <Animated.View
        style={[s.readerStage, { transform: [{ translateY: readerPullAnim }] }]}
        pointerEvents="box-none"
      >
        {/* WebView with foliate-js */}
        <View style={{ flex: 1 }}>
          <WebView
            ref={bridge.webViewRef}
            source={{ uri: readerHtmlUri }}
            style={[
              s.webview,
              {
                marginTop: readerTopMargin,
                marginBottom: readerBottomInset,
              },
            ]}
            pointerEvents={isPanelOpen ? "none" : "auto"}
            onMessage={bridge.handleMessage}
            onError={(e) => {
              console.error("[ReaderScreen] WebView error:", e.nativeEvent);
            }}
            onHttpError={(e) => {
              console.error("[ReaderScreen] WebView HTTP error:", e.nativeEvent);
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
        </View>

        {/* Loading overlay */}
        {loading && (
          <View style={s.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )}

        {/* ─── Top Info Bar (always visible) ─── */}
        {!showSearch && !showControls && showTopTitleProgress && (
          <View style={[s.topInfoBar, { top: layoutTopInset }]}>
            <View style={s.topInfoRow}>
              <Text style={s.topInfoText} numberOfLines={1}>
                {currentChapter || bookTitle}
              </Text>
              <Text style={s.topInfoPageText}>
                {currentPage > 0 && totalPages > 0 ? `${currentPage}/${totalPages}` : `${percent}%`}
              </Text>
            </View>
          </View>
        )}

      </Animated.View>

      {/* ─── Bookmark Ribbon (top-right) ─── */}
      <BookmarkRibbon visible={isBookmarked} topOffset={0} />

      {!showSearch && (
        <Animated.View
          pointerEvents={showControls ? "auto" : "none"}
          style={[
            s.topToolbar,
            {
              top: 0,
              left: 0,
              right: 0,
              opacity: topControlsOpacity,
              transform: [{ translateY: topControlsTranslate }],
            },
          ]}
        >
          <View
            style={[
              s.topToolbarBar,
              {
                paddingTop: layoutTopInset,
                minHeight: layoutTopInset + topToolbarRowHeight,
              },
            ]}
          >
            <View
              style={[
                s.topToolbarRow,
                {
                  minHeight: topToolbarRowHeight,
                  paddingLeft: insets.left + 12,
                  paddingRight: insets.right + 16,
                },
              ]}
            >
              <View style={s.topToolbarSideSlot}>
                <TouchableOpacity
                  style={s.topToolbarBackBtn}
                  onPress={() => navigation.reset({ routes: [{ name: "Tabs" }] })}
                >
                  <ChevronLeftIcon size={topToolbarIconSize} color={colors.foreground} />
                </TouchableOpacity>
              </View>
              <View style={s.topToolbarTitleWrap}>
                <Text style={s.topToolbarTitleText} numberOfLines={1}>
                  {currentChapter || bookTitle}
                </Text>
              </View>
              <View style={[s.topToolbarSideSlot, s.topToolbarMetaWrap]}>
                <Text style={s.topToolbarMetaText}>
                  {currentPage > 0 && totalPages > 0 ? `${currentPage}/${totalPages}` : `${percent}%`}
                </Text>
              </View>
            </View>
            <View style={s.topToolbarProgressTrack}>
              <View style={[s.topToolbarProgressFill, { width: `${percent}%` }]} />
            </View>
          </View>
        </Animated.View>
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
            const selectedText = selection.text;
            const chapter = currentChapter;
            setSelection(null);
            navigation.navigate("BookChat", {
              bookId,
              selectedText,
              chapterTitle: chapter,
            });
          }}
          onNote={(text, cfi) => {
            const mutation = createSelectionNoteMutation({
              bookId,
              cfi,
              text: selection.text,
              note: text,
              chapterTitle: currentChapter,
              existingHighlight: existingSelectionHighlight,
              defaultColor: "yellow",
            });

            if (mutation.kind === "create") {
              addHighlight(mutation.highlight);
              bridge.addAnnotation({
                value: cfi,
                type: "highlight",
                color: mutation.highlight.color,
                note: mutation.highlight.note,
              });
              return;
            }

            updateHighlight(mutation.id, mutation.updates);
            bridge.addAnnotation({
              value: cfi,
              type: "highlight",
              color: existingSelectionHighlight?.color || "yellow",
              note: mutation.updates.note,
            });
          }}
          onTranslate={(text) => {
            setShowTranslation(true);
            setTranslationText(text);
          }}
          existingHighlight={
            existingSelectionHighlight
              ? {
                  id: existingSelectionHighlight.id,
                  color: existingSelectionHighlight.color,
                  note: existingSelectionHighlight.note,
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
                left: Math.max(12, Math.min(noteTooltip.position.x - 150, SCREEN_WIDTH - 312)),
                ...(noteTooltip.position.selectionTop > 220
                  ? { bottom: SCREEN_HEIGHT - noteTooltip.position.selectionTop + 8 }
                  : { top: noteTooltip.position.selectionBottom + 12 }),
              },
            ]}
            onStartShouldSetResponder={() => true}
          >
            <View style={s.noteTooltipContent}>
              <MarkdownRenderer
                content={noteTooltip.note || ""}
                styleOverrides={noteTooltipMdStyles}
              />
            </View>
          </View>
        </TouchableOpacity>
      )}

      {!showSearch && (
        <Animated.View
          pointerEvents={showControls ? "auto" : "none"}
          style={[
            s.floatingTools,
            {
              right: insets.right + 16,
              bottom: insets.bottom + 110,
              opacity: auxToolsOpacity,
              transform: [{ translateY: auxToolsTranslate }],
            },
          ]}
        >
          <TouchableOpacity
            style={[
              s.floatingToolBtn,
              (showChapterTranslation || chapterTranslation.state.status !== "idle") &&
                s.floatingToolBtnActive,
            ]}
            onPress={() => setShowChapterTranslation(true)}
          >
            <LanguagesIcon size={18} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              s.floatingToolBtn,
              (showTTS || ttsPlayState !== "stopped") && s.floatingToolBtnActive,
            ]}
            onPress={handleToggleTTS}
          >
            <HeadphonesIcon size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={s.floatingToolBtn}
            onPress={() => navigation.navigate("BookChat", { bookId })}
          >
            <BotIcon size={20} color="#fff" />
          </TouchableOpacity>
        </Animated.View>
      )}

      {!showSearch && !showControls && showBottomTimeBattery && (
        <View
          pointerEvents="none"
          style={[
            s.bottomInfoBar,
            {
              left: insets.left + 18,
              right: insets.right + 18,
              bottom: Math.max(insets.bottom, 8) + 4,
            },
          ]}
        >
          <Text style={s.bottomInfoText}>{readerClock}</Text>
          <View style={s.bottomInfoSide}>
            <BatteryIcon width={22} height={11} color={colors.mutedForeground} level={batteryLevel} />
            <Text style={s.bottomInfoText}>{batteryLabel}</Text>
          </View>
        </View>
      )}

      {/* ─── Bottom Toolbar ─── */}
      {!showSearch && (
        <Animated.View
          pointerEvents={showControls ? "auto" : "none"}
          style={[
            s.bottomToolbar,
            {
              left: 0,
              right: 0,
              opacity: bottomControlsOpacity,
              transform: [{ translateY: bottomControlsTranslate }],
            },
          ]}
        >
          <View
            style={[
              s.bottomToolbarGlass,
              {
                paddingBottom: Math.max(insets.bottom, 8) + 6,
                paddingLeft: insets.left + 18,
                paddingRight: insets.right + 18,
              },
            ]}
          >
            <View style={s.bottomToolbarProgressTrack}>
              <View style={[s.bottomToolbarProgressFill, { width: `${percent}%` }]} />
            </View>
            <View style={s.bottomDockRow}>
              <TouchableOpacity
                style={s.bottomDockBtn}
                onPress={() => {
                  setTocActiveTab("toc");
                  setShowTOC(true);
                }}
              >
                <ListIcon size={bottomDockIconSize} color={colors.foreground} />
                <Text style={s.bottomDockLabel}>{t("reader.toc", "目录")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.bottomDockBtn, isBookmarked && s.bottomDockBtnActive]}
                onPress={handleToggleBookmark}
              >
                {isBookmarked ? (
                  <BookmarkFilledIcon size={bottomDockIconSize} color={colors.primary} />
                ) : (
                  <BookmarkIcon size={bottomDockIconSize} color={colors.foreground} />
                )}
                <Text style={[s.bottomDockLabel, isBookmarked && s.bottomDockLabelActive]}>
                  {t("reader.bookmarks", "书签")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.bottomDockBtn}
                onPress={() => navigation.navigate("FullScreenNotes", { bookId })}
              >
                <NotebookPenIcon size={bottomDockIconSize} color={colors.foreground} />
                <Text style={s.bottomDockLabel}>{t("notes.title", "笔记")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.bottomDockBtn}
                onPress={() => {
                  setShowSearch(true);
                  setShowControls(false);
                  Animated.timing(toolbarAnim, {
                    toValue: TOOLBAR_HIDE_OFFSET,
                    duration: 180,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                  }).start();
                }}
              >
                <SearchIcon size={bottomDockIconSize} color={colors.foreground} />
                <Text style={s.bottomDockLabel}>{t("reader.search", "搜索")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.bottomDockBtn} onPress={() => setShowSettings(true)}>
                <SettingsIcon size={bottomDockIconSize} color={colors.foreground} />
                <Text style={s.bottomDockLabel}>{t("common.settings", "设置")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      )}

      {/* ─── Search Bar ─── */}
      {showSearch && (
        <View style={[s.searchBarWrap, { paddingTop: layoutTopInset }]}>
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
                // Ask user if they want to return to original position
                if (searchStartCfi && searchResultCount > 0) {
                  Alert.alert(
                    t("reader.searchComplete", "搜索完成"),
                    t("reader.returnToOriginal", "是否返回搜索前的位置？"),
                    [
                      {
                        text: t("common.cancel", "取消"),
                        style: "cancel",
                        onPress: () => {
                          setSearchStartCfi(null);
                        },
                      },
                      {
                        text: t("common.confirm", "确定"),
                        onPress: () => {
                          bridge.goToCFI(searchStartCfi);
                          setSearchStartCfi(null);
                        },
                      },
                    ],
                  );
                } else {
                  setSearchStartCfi(null);
                }
                setShowSearch(false);
                setSearchQuery("");
                setSearchResultCount(0);
                setSearchIndex(0);
                bridge.clearSearch();
                setShowControls(true);
                Animated.timing(toolbarAnim, {
                  toValue: 0,
                  duration: 180,
                  easing: Easing.out(Easing.cubic),
                  useNativeDriver: true,
                }).start();
              }}
            >
              <XIcon size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ─── TOC & Bookmarks Panel ─── */}
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
          {/* Tab Header */}
          <View style={s.sheetHeader}>
            <View style={s.tocTabBar}>
              <TouchableOpacity
                style={[
                  s.tocTab,
                  tocActiveTab === "toc" && { backgroundColor: `${colors.primary}14` },
                ]}
                onPress={() => setTocActiveTab("toc")}
              >
                <ListIcon
                  size={14}
                  color={tocActiveTab === "toc" ? colors.primary : colors.mutedForeground}
                />
                <Text
                  style={[
                    s.tocTabText,
                    { color: tocActiveTab === "toc" ? colors.primary : colors.mutedForeground },
                  ]}
                >
                  {t("reader.toc", "目录")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  s.tocTab,
                  tocActiveTab === "bookmarks" && { backgroundColor: `${colors.primary}14` },
                ]}
                onPress={() => setTocActiveTab("bookmarks")}
              >
                {tocActiveTab === "bookmarks" ? (
                  <BookmarkFilledIcon size={14} color={colors.primary} />
                ) : (
                  <BookmarkIcon size={14} color={colors.mutedForeground} />
                )}
                <Text
                  style={[
                    s.tocTabText,
                    {
                      color: tocActiveTab === "bookmarks" ? colors.primary : colors.mutedForeground,
                    },
                  ]}
                >
                  {t("bookmarks.title", "书签")}
                  {bookBookmarks.length > 0 ? ` (${bookBookmarks.length})` : ""}
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => setShowTOC(false)}>
              <XIcon size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {/* Tab Content */}
          {tocActiveTab === "toc" ? (
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
          ) : bookBookmarks.length > 0 ? (
            <ScrollView showsVerticalScrollIndicator={false} style={s.sheetScroll}>
              {bookBookmarks.map((bm) => (
                <TouchableOpacity
                  key={bm.id}
                  style={s.bookmarkItem}
                  onPress={() => {
                    bridge.goToCFI(bm.cfi);
                    setShowTOC(false);
                  }}
                  activeOpacity={0.6}
                >
                  <BookmarkFilledIcon size={14} color={colors.primary} />
                  <View style={s.bookmarkContent}>
                    <Text style={[s.bookmarkLabel, { color: colors.foreground }]} numberOfLines={1}>
                      {bm.chapterTitle || t("common.unnamed")}
                    </Text>
                    {bm.label ? (
                      <Text
                        style={[s.bookmarkSnippet, { color: colors.mutedForeground }]}
                        numberOfLines={2}
                      >
                        {bm.label}
                      </Text>
                    ) : null}
                    <Text style={[s.bookmarkDate, { color: colors.mutedForeground }]}>
                      {new Date(bm.createdAt).toLocaleDateString(i18n.language, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={s.bookmarkDeleteBtn}
                    onPress={() => removeBookmark(bm.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Trash2Icon size={14} color={colors.mutedForeground} />
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <View style={s.notebookPlaceholder}>
              <BookmarkIcon size={32} color={`${colors.mutedForeground}60`} />
              <Text style={s.notebookPlaceholderText}>{t("bookmarks.empty", "暂无书签")}</Text>
              <Text style={[s.notebookPlaceholderText, { fontSize: fontSize.xs, opacity: 0.6 }]}>
                {t("bookmarks.emptyHint", "使用工具栏的书签按钮来标记页面")}
              </Text>
            </View>
          )}
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
            <View style={s.settingRow}>
              <Text style={s.settingLabel}>{t("settings.showTopTitleProgress")}</Text>
              <TouchableOpacity
                style={[
                  s.settingToggleBtn,
                  showTopTitleProgress && s.settingToggleBtnActive,
                ]}
                onPress={() => updateSetting("showTopTitleProgress", !showTopTitleProgress)}
              >
                <Text
                  style={[
                    s.settingToggleText,
                    showTopTitleProgress && s.settingToggleTextActive,
                  ]}
                >
                  {showTopTitleProgress ? t("settings.enabled") : t("settings.disabled")}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={s.settingRow}>
              <Text style={s.settingLabel}>{t("settings.showBottomTimeBattery")}</Text>
              <TouchableOpacity
                style={[
                  s.settingToggleBtn,
                  showBottomTimeBattery && s.settingToggleBtnActive,
                ]}
                onPress={() => updateSetting("showBottomTimeBattery", !showBottomTimeBattery)}
              >
                <Text
                  style={[
                    s.settingToggleText,
                    showBottomTimeBattery && s.settingToggleTextActive,
                  ]}
                >
                  {showBottomTimeBattery ? t("settings.enabled") : t("settings.disabled")}
                </Text>
              </TouchableOpacity>
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
          behavior={Platform.OS === "ios" ? "padding" : "height"}
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
                          setNoteViewContent(noteViewHighlight.note || "");
                        }}
                      >
                        <XIcon size={14} color={colors.mutedForeground} />
                        <Text style={s.noteViewCancelText}>{t("common.cancel", "取消")}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={s.noteViewSaveBtn}
                        onPress={() => {
                          const mutation = createSelectionNoteMutation({
                            bookId,
                            cfi: noteViewHighlight.cfi,
                            text: noteViewHighlight.text,
                            note: noteViewContent,
                            existingHighlight: noteViewHighlight,
                          });

                          if (mutation.kind !== "update") {
                            setNoteViewEditing(false);
                            return;
                          }

                          const { updateHighlight } = useAnnotationStore.getState();
                          updateHighlight(mutation.id, mutation.updates);
                          bridge.removeAnnotation({ value: noteViewHighlight.cfi });
                          bridge.addAnnotation({
                            value: noteViewHighlight.cfi,
                            type: "highlight",
                            color: noteViewHighlight.color,
                            note: mutation.updates.note,
                          });
                          setNoteViewHighlight({
                            ...noteViewHighlight,
                            note: mutation.updates.note,
                          });
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
                      <MarkdownRenderer content={noteViewHighlight.note || ""} />
                    </ScrollView>
                    <View style={s.noteViewActions}>
                      <TouchableOpacity
                        style={s.noteViewEditBtn}
                        onPress={() => {
                          setNoteViewContent(noteViewHighlight.note || "");
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

      {/* ─── Chapter Translation Sheet ─── */}
      <ChapterTranslationSheet
        visible={showChapterTranslation}
        onClose={() => setShowChapterTranslation(false)}
        state={chapterTranslation.state}
        onStart={chapterTranslation.startTranslation}
        onCancel={chapterTranslation.cancelTranslation}
        onToggleOriginalVisible={chapterTranslation.toggleOriginalVisible}
        onToggleTranslationVisible={chapterTranslation.toggleTranslationVisible}
        onReset={chapterTranslation.reset}
      />

      <TTSPage
        visible={showTTS}
        bookTitle={bookTitle || book?.meta.title || ""}
        chapterTitle={currentChapter}
        coverUri={ttsCoverUri}
        playState={ttsPlayState}
        currentText={ttsCurrentText || ttsLastText}
        config={ttsConfig}
        readingProgress={progress}
        currentPage={currentPage}
        totalPages={totalPages}
        sourceLabel={ttsSourceLabel}
        continuousEnabled={ttsContinuousEnabled}
        narrationSegments={[...ttsSegments, ...ttsFutureSegments]}
        prevNarrationSegments={ttsPrevPageSegments}
        currentSegmentCfi={currentTTSSegment?.cfi || ttsCurrentLocationCfi || null}
        currentChunkIndex={ttsCurrentChunkIndex}
        totalChunks={ttsTotalChunks}
        onClose={() => setShowTTS(false)}
        onReturnToReading={() => {
          const targetCfi = currentTTSSegment?.cfi || ttsCurrentLocationCfi || currentCfi;
          setShowTTS(false);
          if (!targetCfi) return;
          bridge.goToCFI(targetCfi);
          bridge.flashHighlight(targetCfi, colors.primary, 1200);
          setTimeout(() => {
            bridge.setTTSHighlight(targetCfi, ttsHighlightColor, true);
          }, 120);
        }}
        onReplay={handleTTSReplay}
        onPlayPause={handleTTSPlayPause}
        onJumpToSegment={handleJumpToTTSSegment}
        onJumpToLyricSegment={handleJumpToTTSLyricSegment}
        onLoadMoreAbove={handleLoadMoreAboveTTSLyrics}
        onLoadMoreBelow={handleLoadMoreBelowTTSLyrics}
        onStop={() => {
          ttsContinuousRef.current = false;
          ttsSetOnEnd(null);
          bridge.setTTSHighlight(null);
          setTtsSegments([]);
          ttsSegmentsRef.current = [];
          setTtsPrevPageSegments([]);
          setTtsFutureSegments([]);
          ttsFutureSegmentsRef.current = [];
          setTtsLastText("");
          ttsLastTextRef.current = "";
          ttsStop();
        }}
        onAdjustRate={handleAdjustTTSRate}
        onAdjustPitch={handleAdjustTTSPitch}
        onToggleContinuous={handleToggleTTSContinuous}
        onUpdateConfig={ttsUpdateConfig}
        onPrevChapter={toc.length > 0 ? handleTTSPrevChapter : undefined}
        onNextChapter={toc.length > 0 ? handleTTSNextChapter : undefined}
      />
    </View>
  );
}

const TOOLTIP_FG = "#f1f5f9";
const TOOLTIP_MUTED = "rgba(148, 163, 184, 0.5)";
const noteTooltipMdStyles = {
  body: { color: TOOLTIP_FG, fontSize: 13, lineHeight: 19 },
  textgroup: { color: TOOLTIP_FG, fontSize: 13, lineHeight: 19 },
  text: { color: TOOLTIP_FG, fontSize: 13, lineHeight: 19 },
  paragraph: { color: TOOLTIP_FG, fontSize: 13, lineHeight: 19, marginBottom: 4, marginTop: 0 },
  heading1: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600" as const,
    marginBottom: 4,
    marginTop: 4,
  },
  heading2: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600" as const,
    marginBottom: 3,
    marginTop: 3,
  },
  heading3: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600" as const,
    marginBottom: 2,
    marginTop: 2,
  },
  strong: { fontWeight: "700" as const, color: "#fff" },
  em: { fontStyle: "italic" as const, color: "#e2e8f0" },
  link: { color: "#60a5fa" },
  code_inline: {
    backgroundColor: "rgba(255,255,255,0.1)",
    color: TOOLTIP_FG,
    fontSize: 14,
    fontFamily: "Menlo",
  },
  code_block: {
    backgroundColor: "rgba(0,0,0,0.3)",
    color: TOOLTIP_FG,
    fontSize: 14,
    fontFamily: "Menlo",
    padding: 8,
  },
  fence: {
    backgroundColor: "rgba(0,0,0,0.3)",
    color: TOOLTIP_FG,
    fontSize: 14,
    fontFamily: "Menlo",
    padding: 8,
  },
  blockquote: {
    borderLeftWidth: 2,
    borderLeftColor: TOOLTIP_MUTED,
    paddingLeft: 10,
    backgroundColor: "transparent",
    color: TOOLTIP_FG,
  },
  bullet_list: { marginVertical: 2 },
  ordered_list: { marginVertical: 2 },
  list_item: { marginBottom: 2, flexDirection: "row" as const },
  bullet_list_icon: { color: TOOLTIP_FG, marginLeft: 0, marginRight: 8 },
  bullet_list_content: { color: TOOLTIP_FG, flex: 1 },
  ordered_list_icon: { color: TOOLTIP_FG, marginLeft: 0, marginRight: 8 },
  ordered_list_content: { color: TOOLTIP_FG, flex: 1 },
  hardbreak: { color: TOOLTIP_FG },
  softbreak: { color: TOOLTIP_FG },
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    readerStage: { flex: 1 },
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

    topToolbar: {
      position: "absolute",
      zIndex: 34,
      left: 0,
      right: 0,
      top: 0,
    },
    topToolbarBar: {
      backgroundColor: withOpacity(colors.background, 0.94),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withOpacity(colors.foreground, 0.1),
    },
    topToolbarRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    topToolbarBackBtn: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
    },
    topToolbarSideSlot: {
      width: 68,
      justifyContent: "center",
      alignItems: "flex-start",
    },
    topToolbarSpacer: {
      flex: 1,
      minHeight: 44,
    },
    topToolbarTitleWrap: {
      flex: 1,
      minWidth: 0,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 12,
    },
    topToolbarTitleText: {
      fontSize: fontSize.sm,
      color: colors.foreground,
      fontWeight: fontWeight.medium,
    },
    topToolbarMetaWrap: {
      width: 60,
      alignItems: "flex-end",
      justifyContent: "center",
    },
    topToolbarMetaText: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      fontWeight: fontWeight.medium,
    },
    topToolbarRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
    },
    topToolbarBtn: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    topToolbarBtnActive: {
      backgroundColor: withOpacity(colors.foreground, 0.06),
    },
    topToolbarProgressTrack: {
      height: 2,
      backgroundColor: withOpacity(colors.foreground, 0.08),
      overflow: "hidden",
    },
    topToolbarProgressFill: {
      height: "100%",
      backgroundColor: withOpacity(colors.foreground, 0.48),
    },

    floatingTools: {
      position: "absolute",
      zIndex: 34,
      gap: 10,
      alignItems: "center",
    },
    floatingToolBtn: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(76, 82, 94, 0.88)",
    },
    floatingToolBtnActive: {
      backgroundColor: "rgba(59, 130, 246, 0.9)",
    },

    bottomToolbar: {
      position: "absolute",
      bottom: 0,
      zIndex: 30,
      left: 0,
      right: 0,
    },
    bottomToolbarGlass: {
      backgroundColor: withOpacity(colors.background, 0.98),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.foreground, 0.12),
      paddingTop: 10,
    },
    bottomDockRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 2,
    },
    bottomDockBtn: {
      flex: 1,
      height: 54,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      paddingTop: 4,
    },
    bottomDockBtnActive: {
      backgroundColor: withOpacity(colors.foreground, 0.06),
    },
    bottomDockLabel: {
      fontSize: fontSize.xs,
      lineHeight: 14,
      color: colors.mutedForeground,
      fontWeight: fontWeight.medium,
    },
    bottomDockLabelActive: {
      color: colors.primary,
    },
    bottomToolbarProgressTrack: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 2,
      backgroundColor: withOpacity(colors.foreground, 0.08),
      overflow: "hidden",
    },
    bottomToolbarProgressFill: {
      height: "100%",
      backgroundColor: withOpacity(colors.foreground, 0.48),
      borderRadius: 999,
    },
    toolbarRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    toolbarBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    toolbarBtnActive: { backgroundColor: `${colors.primary}30` },
    toolbarBtnDisabled: { opacity: 0.4 },
    toolbarCenter: { flex: 1, paddingHorizontal: 8, alignItems: "center" },
    toolbarTitle: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: "#fff",
      letterSpacing: 0.3,
    },
    toolbarChapter: { fontSize: fontSize.xs, color: "rgba(255,255,255,0.5)", marginTop: 1 },

    topInfoBar: {
      position: "absolute",
      left: 0,
      right: 0,
      paddingHorizontal: 18,
      paddingVertical: 6,
      gap: 8,
    },
    topInfoRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    topInfoText: {
      flex: 1,
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      marginRight: 8,
    },
    topInfoPageText: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
    },
    topInfoProgressTrack: {
      height: 2,
      borderRadius: 999,
      overflow: "hidden",
      backgroundColor: withOpacity(colors.foreground, 0.08),
    },
    topInfoProgressFill: {
      height: "100%",
      borderRadius: 999,
      backgroundColor: withOpacity(colors.foreground, 0.42),
    },
    bottomInfoBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      position: "absolute",
      zIndex: 24,
    },
    bottomInfoSide: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    bottomInfoText: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      fontVariant: ["tabular-nums"],
    },
    footerSliderRow: { flexDirection: "row", alignItems: "center", gap: 6 },
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
    sliderFill: { height: "100%", backgroundColor: colors.primary, borderRadius: 1.5 },

    thinProgressWrap: {
      position: "absolute",
      left: 0,
      right: 0,
      height: 2,
      backgroundColor: "rgba(255,255,255,0.05)",
      zIndex: 40,
    },
    thinProgressFill: { height: "100%", backgroundColor: colors.primary, opacity: 0.8 },

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

    tocTabBar: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
    },
    tocTab: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.md,
    },
    tocTabText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
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
    settingToggleBtn: {
      minWidth: 68,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.lg,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    settingToggleBtnActive: {
      backgroundColor: `${colors.primary}18`,
    },
    settingToggleText: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      fontWeight: fontWeight.medium,
    },
    settingToggleTextActive: {
      color: colors.primary,
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

    bookmarkItem: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
    },
    bookmarkContent: {
      flex: 1,
      minWidth: 0,
    },
    bookmarkLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      lineHeight: 20,
    },
    bookmarkSnippet: {
      fontSize: fontSize.xs,
      lineHeight: 16,
      marginTop: 2,
      opacity: 0.7,
    },
    bookmarkDate: {
      fontSize: fontSize.xs,
      marginTop: 3,
      opacity: 0.6,
    },
    bookmarkDeleteBtn: {
      padding: 6,
      borderRadius: radius.md,
      opacity: 0.5,
    },

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
