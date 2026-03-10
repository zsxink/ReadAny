/**
 * ReaderScreen — WebView-based reader with foliate-js engine.
 * Features: toolbar with back/notebook/chat/TTS/TOC/search/settings,
 * footer with prev/next + slider + progress, TOC panel, settings panel,
 * search bar, selection popover for highlights/notes.
 */
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  Animated,
  TextInput,
  ScrollView,
  Modal,
  Pressable,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { WebView } from "react-native-webview";
import * as FileSystem from "expo-file-system/legacy";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore, useAnnotationStore, useReadingSessionStore } from "@/stores";
import { useReaderBridge } from "@/hooks/use-reader-bridge";
import type { RelocateEvent, SelectionEvent } from "@/hooks/use-reader-bridge";
import { SelectionPopover } from "@/components/reader/SelectionPopover";
import type { TOCItem } from "@readany/core/types";
import { type ThemeColors, radius, fontSize, fontWeight, useColors } from "@/styles/theme";
import { useTheme } from "@/styles/ThemeContext";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  SearchIcon,
  NotebookPenIcon,
  BookOpenIcon,
  XIcon,
  Volume2Icon,
  MessageSquareIcon,
  HighlighterIcon,
} from "@/components/ui/Icon";
import Svg, { Path } from "react-native-svg";

// Read the bundled reader.html
const READER_HTML = require("../../assets/reader/reader.html");

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
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <Path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
    </Svg>
  );
}

function ListIcon({ size = 24, color = "#e8e8ed" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 12h18M3 6h18M3 18h18" />
    </Svg>
  );
}

// ──────────────────────────── TOC Tree Item ────────────────────────────
function TOCTreeItem({
  item, level, currentChapter, onSelect,
}: {
  item: TOCItem; level: number; currentChapter: string; onSelect: (href: string) => void;
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
          <TouchableOpacity style={tocS.expandBtn} onPress={() => setExpanded(!expanded)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            {expanded ? <ChevronDownIcon size={14} color={colors.mutedForeground} /> : <ChevronRightIcon size={14} color={colors.mutedForeground} />}
          </TouchableOpacity>
        ) : (
          <View style={tocS.expandPlaceholder} />
        )}
        <Text style={[tocS.itemText, isCurrent && tocS.itemTextActive]} numberOfLines={1}>{item.title}</Text>
      </TouchableOpacity>
      {expanded && hasChildren && (
        <View>
          {item.subitems!.map((child) => (
            <TOCTreeItem key={child.id || child.href} item={child} level={level + 1} currentChapter={currentChapter} onSelect={onSelect} />
          ))}
        </View>
      )}
    </View>
  );
}

const makeTocStyles = (colors: ThemeColors) => StyleSheet.create({
  item: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingRight: 12, borderRadius: radius.lg },
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
  const { bookId } = route.params;
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
  const [currentCfi, setCurrentCfi] = useState("");
  const [selection, setSelection] = useState<SelectionEvent | null>(null);

  // Settings
  const [settingFontSize, setSettingFontSize] = useState(16);
  const [settingLineHeight, setSettingLineHeight] = useState(1.6);
  const [settingParagraphSpacing, setSettingParagraphSpacing] = useState(8);
  const [settingPageMargin, setSettingPageMargin] = useState(16);
  const [settingFontTheme, setSettingFontTheme] = useState("default");
  const [settingViewMode, setSettingViewMode] = useState<"paginated" | "scroll">("paginated");

  const controlsTimer = useRef<NodeJS.Timeout | null>(null);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const toolbarAnim = useRef(new Animated.Value(-80)).current;
  const footerAnim = useRef(new Animated.Value(80)).current;

  const { books, updateBook } = useLibraryStore();
  const { startSession, stopSession } = useReadingSessionStore();
  const { addHighlight, loadAnnotations, highlights } = useAnnotationStore();

  const book = useMemo(() => books.find((b) => b.id === bookId), [books, bookId]);

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
        setCurrentCfi(detail.cfi);
        // Persist progress
        updateBook(bookId, {
          progress: detail.fraction ?? 0,
          lastLocation: detail.cfi,
        });
      }
    },
    onTocReady: (items: TOCItem[]) => {
      setToc(items);
    },
    onSelection: (detail: SelectionEvent) => {
      setSelection(detail);
    },
    onSelectionCleared: () => {
      setSelection(null);
    },
    onTap: () => {
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
    startSession(bookId);
    loadAnnotations(bookId);

    return () => {
      stopSession();
    };
  }, [bookId]);

  // When WebView is ready and book is available, send the open command
  useEffect(() => {
    if (!webViewReady || !book?.filePath) return;

    const loadBook = async () => {
      try {
        // Read the book file and send as base64 for reliability
        const base64 = await FileSystem.readAsStringAsync(book.filePath, {
          encoding: FileSystem.EncodingType.Base64,
        });

        bridge.openBook({
          base64,
          fileName: book.filePath.split("/").pop() || "book.epub",
          lastLocation: book.lastLocation || undefined,
          pageMargin: settingPageMargin,
        });

        // Set theme colors
        bridge.setThemeColors({
          background: colors.background,
          foreground: colors.foreground,
          muted: colors.mutedForeground,
        });
      } catch (err: any) {
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
    if (!webViewReady || highlights.length === 0) return;
    for (const h of highlights) {
      bridge.addAnnotation({ value: h.cfi, color: h.color, note: h.note });
    }
  }, [webViewReady, highlights.length]);

  // Controls toggle
  const toggleControls = useCallback(() => {
    const willShow = !showControls;
    setShowControls(willShow);
    Animated.parallel([
      Animated.spring(toolbarAnim, { toValue: willShow ? 0 : -80, useNativeDriver: true, friction: 20, tension: 100 }),
      Animated.spring(footerAnim, { toValue: willShow ? 0 : 80, useNativeDriver: true, friction: 20, tension: 100 }),
    ]).start();

    if (willShow) {
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
      controlsTimer.current = setTimeout(() => {
        setShowControls(false);
        Animated.parallel([
          Animated.spring(toolbarAnim, { toValue: -80, useNativeDriver: true, friction: 20, tension: 100 }),
          Animated.spring(footerAnim, { toValue: 80, useNativeDriver: true, friction: 20, tension: 100 }),
        ]).start();
      }, CONTROLS_TIMEOUT);
    }
  }, [showControls, toolbarAnim, footerAnim]);

  const goToTocItem = useCallback((href: string) => {
    bridge.goToHref(href);
    setShowTOC(false);
  }, [bridge]);

  const handleSearchInput = useCallback((query: string) => {
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
  }, [bridge]);

  const navigateSearch = useCallback((direction: "prev" | "next") => {
    if (searchResultCount === 0) return;
    const newIdx = direction === "next"
      ? (searchIndex + 1) % searchResultCount
      : (searchIndex - 1 + searchResultCount) % searchResultCount;
    setSearchIndex(newIdx);
    bridge.navigateSearch(newIdx);
  }, [searchIndex, searchResultCount, bridge]);

  const updateSetting = useCallback((key: string, value: number | string) => {
    switch (key) {
      case "fontSize":
        setSettingFontSize(value as number);
        bridge.applySettings({ fontSize: value as number });
        break;
      case "lineHeight":
        setSettingLineHeight(value as number);
        bridge.applySettings({ lineHeight: value as number });
        break;
      case "paragraphSpacing":
        setSettingParagraphSpacing(value as number);
        bridge.applySettings({ paragraphSpacing: value as number });
        break;
      case "pageMargin":
        setSettingPageMargin(value as number);
        bridge.applySettings({ pageMargin: value as number });
        break;
      case "fontTheme":
        setSettingFontTheme(value as string);
        bridge.applySettings({ fontTheme: value as string });
        break;
      case "viewMode":
        setSettingViewMode(value as "paginated" | "scroll");
        bridge.applySettings({ viewMode: value as string });
        break;
    }
  }, [bridge]);

  // Selection popover handlers
  const handleHighlight = useCallback((color: string) => {
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
  }, [selection, bookId, currentChapter, addHighlight, bridge]);

  const handleDismissSelection = useCallback(() => {
    setSelection(null);
  }, []);

  if (loading && !webViewReady) {
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

  const percent = Math.round(progress * 100);

  return (
    <View style={s.container}>
      {/* WebView with foliate-js */}
      <WebView
        ref={bridge.webViewRef}
        source={READER_HTML}
        style={s.webview}
        onMessage={bridge.handleMessage}
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
            // Copy handled in popover
            setSelection(null);
          }}
          onAIChat={() => {
            setSelection(null);
            navigation.navigate("BookChat", { bookId });
          }}
        />
      )}

      {/* ─── Toolbar ─── */}
      <Animated.View style={[s.toolbar, { paddingTop: insets.top, transform: [{ translateY: toolbarAnim }] }]}>
        <View style={s.toolbarRow}>
          <TouchableOpacity style={s.toolbarBtn} onPress={() => navigation.goBack()}>
            <ChevronLeftIcon size={20} color="#fff" />
          </TouchableOpacity>
          <View style={s.toolbarCenter}>
            <Text style={s.toolbarTitle} numberOfLines={1}>{bookTitle}</Text>
            {currentChapter ? <Text style={s.toolbarChapter} numberOfLines={1}>{currentChapter}</Text> : null}
          </View>
          <TouchableOpacity style={s.toolbarBtn} onPress={() => setShowNotebook(true)}>
            <NotebookPenIcon size={18} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={s.toolbarBtn} onPress={() => navigation.navigate("BookChat", { bookId })}>
            <MessageSquareIcon size={18} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={s.toolbarBtn} onPress={() => setShowTOC(true)}>
            <ListIcon size={18} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={s.toolbarBtn} onPress={() => setShowSearch(true)}>
            <SearchIcon size={18} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={s.toolbarBtn} onPress={() => setShowSettings(true)}>
            <SettingsIcon size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* ─── Footer ─── */}
      <Animated.View style={[s.footer, { paddingBottom: insets.bottom || 8, transform: [{ translateY: footerAnim }] }]}>
        <View style={s.footerPageRow}>
          <Text style={s.footerPageText}>
            {currentPage > 0 && totalPages > 0 ? `${currentPage} / ${totalPages}` : ""}
          </Text>
          <Text style={s.footerPageText}>{percent}%</Text>
        </View>
        <View style={s.footerSliderRow}>
          <TouchableOpacity style={s.footerNavBtn} onPress={bridge.goPrev}>
            <ChevronLeftIcon size={20} color="#fff" />
          </TouchableOpacity>
          <View style={s.sliderWrap}>
            <View style={s.sliderTrack}>
              <View style={[s.sliderFill, { width: `${percent}%` }]} />
            </View>
          </View>
          <TouchableOpacity style={s.footerNavBtn} onPress={bridge.goNext}>
            <ChevronRightIcon size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </Animated.View>

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
                <Text style={s.searchCount}>{searchIndex + 1} / {searchResultCount}</Text>
              ) : searchQuery && !isSearching ? (
                <Text style={s.searchCount}>0</Text>
              ) : null}
            </View>
            <TouchableOpacity style={s.searchNavBtn} onPress={() => navigateSearch("prev")} disabled={searchResultCount === 0}>
              <ChevronLeftIcon size={16} color={searchResultCount > 0 ? colors.foreground : colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity style={s.searchNavBtn} onPress={() => navigateSearch("next")} disabled={searchResultCount === 0}>
              <ChevronRightIcon size={16} color={searchResultCount > 0 ? colors.foreground : colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity style={s.searchNavBtn} onPress={() => { setShowSearch(false); setSearchQuery(""); setSearchResultCount(0); setSearchIndex(0); bridge.clearSearch(); }}>
              <XIcon size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ─── TOC Panel ─── */}
      <Modal visible={showTOC} transparent animationType="slide" onRequestClose={() => setShowTOC(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setShowTOC(false)} />
        <View style={[s.bottomSheet, { maxHeight: SCREEN_HEIGHT * 0.7, paddingBottom: insets.bottom || 16 }]}>
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>{t("reader.toc", "目录")}</Text>
            <TouchableOpacity onPress={() => setShowTOC(false)}>
              <XIcon size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} style={s.sheetScroll}>
            {toc.length > 0 ? (
              toc.map((item) => (
                <TOCTreeItem key={item.id || item.href} item={item} level={0} currentChapter={currentChapter} onSelect={goToTocItem} />
              ))
            ) : (
              <Text style={s.sheetEmpty}>{t("reader.noToc", "暂无目录信息")}</Text>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* ─── Settings Panel ─── */}
      <Modal visible={showSettings} transparent animationType="slide" onRequestClose={() => setShowSettings(false)}>
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
                <TouchableOpacity style={s.stepBtn} onPress={() => updateSetting("fontSize", Math.max(12, settingFontSize - 1))}>
                  <Text style={s.stepBtnText}>A-</Text>
                </TouchableOpacity>
                <Text style={s.settingValue}>{settingFontSize}</Text>
                <TouchableOpacity style={s.stepBtn} onPress={() => updateSetting("fontSize", Math.min(32, settingFontSize + 1))}>
                  <Text style={s.stepBtnText}>A+</Text>
                </TouchableOpacity>
              </View>
            </View>
            {/* Line Height */}
            <View style={s.settingRow}>
              <Text style={s.settingLabel}>{t("reader.lineHeight", "行高")}</Text>
              <View style={s.settingControl}>
                <TouchableOpacity style={s.stepBtn} onPress={() => updateSetting("lineHeight", Math.round(Math.max(1.2, settingLineHeight - 0.1) * 10) / 10)}>
                  <Text style={s.stepBtnText}>-</Text>
                </TouchableOpacity>
                <Text style={s.settingValue}>{settingLineHeight.toFixed(1)}</Text>
                <TouchableOpacity style={s.stepBtn} onPress={() => updateSetting("lineHeight", Math.round(Math.min(2.5, settingLineHeight + 0.1) * 10) / 10)}>
                  <Text style={s.stepBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
            {/* Paragraph Spacing */}
            <View style={s.settingRow}>
              <Text style={s.settingLabel}>{t("reader.paragraphSpacing", "段间距")}</Text>
              <View style={s.settingControl}>
                <TouchableOpacity style={s.stepBtn} onPress={() => updateSetting("paragraphSpacing", Math.max(0, settingParagraphSpacing - 2))}>
                  <Text style={s.stepBtnText}>-</Text>
                </TouchableOpacity>
                <Text style={s.settingValue}>{settingParagraphSpacing}</Text>
                <TouchableOpacity style={s.stepBtn} onPress={() => updateSetting("paragraphSpacing", Math.min(24, settingParagraphSpacing + 2))}>
                  <Text style={s.stepBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
            {/* Page Margin */}
            <View style={s.settingRow}>
              <Text style={s.settingLabel}>{t("reader.pageMargin", "页边距")}</Text>
              <View style={s.settingControl}>
                <TouchableOpacity style={s.stepBtn} onPress={() => updateSetting("pageMargin", Math.max(0, settingPageMargin - 4))}>
                  <Text style={s.stepBtnText}>-</Text>
                </TouchableOpacity>
                <Text style={s.settingValue}>{settingPageMargin}</Text>
                <TouchableOpacity style={s.stepBtn} onPress={() => updateSetting("pageMargin", Math.min(48, settingPageMargin + 4))}>
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
                    <TouchableOpacity key={theme.id} style={[s.themeBtn, settingFontTheme === theme.id && s.themeBtnActive]} onPress={() => updateSetting("fontTheme", theme.id)}>
                      <Text style={[s.themeBtnText, settingFontTheme === theme.id && s.themeBtnTextActive]}>{t(theme.labelKey, theme.fallback)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
            {/* View Mode */}
            <View style={s.settingRow}>
              <Text style={s.settingLabel}>{t("reader.viewMode", "阅读模式")}</Text>
              <View style={s.viewModeRow}>
                <TouchableOpacity style={[s.viewModeBtn, settingViewMode === "paginated" && s.viewModeBtnActive]} onPress={() => updateSetting("viewMode", "paginated")}>
                  <Text style={[s.viewModeBtnText, settingViewMode === "paginated" && s.viewModeBtnTextActive]}>{t("reader.paginated", "翻页")}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.viewModeBtn, settingViewMode === "scroll" && s.viewModeBtnActive]} onPress={() => updateSetting("viewMode", "scroll")}>
                  <Text style={[s.viewModeBtnText, settingViewMode === "scroll" && s.viewModeBtnTextActive]}>{t("reader.scrollMode", "滚动")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ─── Notebook Panel ─── */}
      <Modal visible={showNotebook} transparent animationType="slide" onRequestClose={() => setShowNotebook(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setShowNotebook(false)} />
        <View style={[s.bottomSheet, { maxHeight: SCREEN_HEIGHT * 0.7, paddingBottom: insets.bottom || 16 }]}>
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
                  <View style={[s.highlightColorDot, { backgroundColor: h.color === "yellow" ? "#facc15" : h.color === "green" ? "#4ade80" : h.color === "blue" ? "#60a5fa" : h.color === "pink" ? "#ec4899" : h.color === "red" ? "#f87171" : "#a78bfa" }]} />
                  <View style={s.highlightContent}>
                    <Text style={s.highlightText} numberOfLines={3}>{h.text}</Text>
                    {h.note && <Text style={s.highlightNote}>{h.note}</Text>}
                  </View>
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={s.notebookPlaceholder}>
              <NotebookPenIcon size={40} color={colors.mutedForeground} />
              <Text style={s.notebookPlaceholderText}>{t("reader.notebookHint", "在阅读时选中文字来创建笔记和高亮")}</Text>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  webview: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { fontSize: fontSize.sm, color: colors.mutedForeground },
  errorText: { fontSize: fontSize.base, color: colors.destructive, textAlign: "center", paddingHorizontal: 24 },
  backButton: { marginTop: 16, paddingHorizontal: 24, paddingVertical: 10, borderRadius: radius.lg, backgroundColor: colors.primary },
  backButtonText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.primaryForeground },
  loadingOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, zIndex: 20 },

  toolbar: { position: "absolute", top: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.6)", paddingBottom: 8, zIndex: 30 },
  toolbarRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingTop: 4 },
  toolbarBtn: { width: 36, height: 36, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  toolbarCenter: { flex: 1, paddingHorizontal: 4 },
  toolbarTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: "#fff" },
  toolbarChapter: { fontSize: fontSize.xs, color: "rgba(255,255,255,0.7)" },

  footer: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.6)", paddingTop: 8, paddingHorizontal: 16, zIndex: 30 },
  footerPageRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  footerPageText: { fontSize: fontSize.xs, color: "rgba(255,255,255,0.7)" },
  footerSliderRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  footerNavBtn: { width: 32, height: 32, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  sliderWrap: { flex: 1, justifyContent: "center", paddingVertical: 8 },
  sliderTrack: { height: 4, backgroundColor: "rgba(255,255,255,0.3)", borderRadius: 2, overflow: "hidden" },
  sliderFill: { height: "100%", backgroundColor: "#fff", borderRadius: 2 },

  searchBarWrap: { position: "absolute", top: 0, left: 0, right: 0, backgroundColor: colors.background, borderBottomWidth: 0.5, borderBottomColor: colors.border, zIndex: 40 },
  searchBarRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8 },
  searchInputWrap: { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: colors.muted, borderRadius: radius.lg, paddingHorizontal: 10, height: 36, gap: 6 },
  searchInput: { flex: 1, fontSize: fontSize.sm, color: colors.foreground, padding: 0 },
  searchMetaRow: { flexDirection: "row", alignItems: "center" },
  searchCount: { fontSize: fontSize.xs, color: colors.mutedForeground },
  searchNavBtn: { width: 32, height: 32, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  bottomSheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, padding: 16 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sheetTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.foreground },
  sheetScroll: { maxHeight: SCREEN_HEIGHT * 0.5 },
  sheetEmpty: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: "center", paddingVertical: 32 },

  settingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  settingLabel: { fontSize: fontSize.sm, color: colors.mutedForeground },
  settingControl: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepBtn: { width: 32, height: 32, borderRadius: radius.lg, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" },
  stepBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.foreground },
  settingValue: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.foreground, minWidth: 32, textAlign: "center" },
  themeScroll: { maxWidth: 220 },
  themeRow: { flexDirection: "row", gap: 6 },
  themeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.lg, backgroundColor: colors.muted },
  themeBtnActive: { backgroundColor: colors.primary },
  themeBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.mutedForeground },
  themeBtnTextActive: { color: colors.primaryForeground },
  viewModeRow: { flexDirection: "row", gap: 8 },
  viewModeBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: radius.lg, backgroundColor: colors.muted },
  viewModeBtnActive: { backgroundColor: colors.primary },
  viewModeBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.mutedForeground },
  viewModeBtnTextActive: { color: colors.primaryForeground },

  notebookPlaceholder: { alignItems: "center", justifyContent: "center", paddingVertical: 48, gap: 12 },
  notebookPlaceholderText: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: "center", paddingHorizontal: 32 },

  highlightItem: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  highlightColorDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  highlightContent: { flex: 1 },
  highlightText: { fontSize: fontSize.sm, color: colors.foreground, lineHeight: 18 },
  highlightNote: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 4 },
});
