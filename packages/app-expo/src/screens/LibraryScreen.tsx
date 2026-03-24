import { BookCard } from "@/components/library/BookCard";
import { type ExtractorRef, ExtractorWebView } from "@/components/rag/ExtractorWebView";
import {
  ArrowDownAZIcon,
  ArrowUpAZIcon,
  CheckIcon,
  ClockIcon,
  EditIcon,
  PlusIcon,
  SearchIcon,
  SortAscIcon,
  Trash2Icon,
  XIcon,
} from "@/components/ui/Icon";
import { triggerVectorizeBook } from "@/lib/rag/vectorize-trigger";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore } from "@/stores/library-store";
import { useVectorModelStore } from "@/stores/vector-model-store";
import {
  type ThemeColors,
  fontSize,
  fontWeight,
  radius,
  useColors,
  useTheme,
  withOpacity,
} from "@/styles/theme";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { onLibraryChanged } from "@readany/core/events/library-events";
import { getPlatformService } from "@readany/core/services";
import type { Book, SortField } from "@readany/core/types";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
/**
 * LibraryScreen — matching Tauri mobile LibraryPage exactly.
 * Features: header search/sort/import, tag filter, vectorization progress banner,
 * tag management sheet, book grid (3 cols), empty/loading states.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const BOOK_PNG = require("../../assets/book.png");
const BOOK_DARK_PNG = require("../../assets/book-dark.png");

type Nav = NativeStackNavigationProp<RootStackParamList>;

const NUM_COLUMNS = 3;
const GRID_GAP = 12;
const SCREEN_PADDING = 16;
const screenWidth = Dimensions.get("window").width;

const SORT_OPTIONS: { field: SortField; labelKey: string }[] = [
  { field: "lastOpenedAt", labelKey: "library.sortRecent" },
  { field: "addedAt", labelKey: "library.sortAdded" },
  { field: "title", labelKey: "library.sortTitle" },
  { field: "author", labelKey: "library.sortAuthor" },
  { field: "progress", labelKey: "library.sortProgress" },
];

export function LibraryScreen() {
  const colors = useColors();
  const { isDark } = useTheme();
  const s = makeStyles(colors);
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const [showSearch, setShowSearch] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const searchAnim = useRef(new Animated.Value(0)).current;
  const searchInputRef = useRef<TextInput>(null);

  // Tag management sheet state
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  const [tagSheetBook, setTagSheetBook] = useState<Book | null>(null);
  const [newTagInput, setNewTagInput] = useState("");
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  // Vectorization queue state
  const [vectorQueue, setVectorQueue] = useState<Book[]>([]);
  const vectorQueueRef = useRef<Book[]>([]);
  const [vectorizingBookId, setVectorizingBookId] = useState<string | null>(null);
  const [vectorizingBookTitle, setVectorizingBookTitle] = useState("");
  const [vectorProgress, setVectorProgress] = useState<{
    status: string;
    processedChunks: number;
    totalChunks: number;
  } | null>(null);
  const isProcessingRef = useRef(false);

  const extractorRef = useRef<ExtractorRef>(null);

  const {
    books,
    isLoaded,
    isImporting,
    filter,
    allTags,
    activeTag,
    loadBooks,
    importBooks,
    removeBook,
    setFilter,
    setActiveTag,
    addTag,
    addTagToBook,
    removeTagFromBook,
    removeTag,
    renameTag,
  } = useLibraryStore();

  const openSearch = useCallback(() => {
    setShowSearch(true);
    Animated.timing(searchAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: false,
    }).start(() => {
      searchInputRef.current?.focus();
    });
  }, [searchAnim]);

  const closeSearch = useCallback(() => {
    Animated.timing(searchAnim, {
      toValue: 0,
      duration: 250,
      useNativeDriver: false,
    }).start(() => {
      setShowSearch(false);
      setFilter({ search: "" });
    });
  }, [searchAnim, setFilter]);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  // Refresh library when AI tools modify books/tags
  useEffect(() => {
    return onLibraryChanged((deletedTags) => loadBooks(deletedTags));
  }, [loadBooks]);

  // Filter & sort books
  const filteredBooks = useMemo(() => {
    let result = [...books];

    if (activeTag === "__uncategorized__") {
      result = result.filter((b) => b.tags.length === 0);
    } else if (activeTag) {
      result = result.filter((b) => b.tags.includes(activeTag));
    }

    const search = filter.search.toLowerCase().trim();
    if (search) {
      result = result.filter(
        (b) =>
          b.meta.title.toLowerCase().includes(search) ||
          b.meta.author?.toLowerCase().includes(search) ||
          b.tags.some((tag) => tag.toLowerCase().includes(search)),
      );
    }

    const { sortField, sortOrder } = filter;
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "title":
          cmp = a.meta.title.localeCompare(b.meta.title);
          break;
        case "author":
          cmp = (a.meta.author || "").localeCompare(b.meta.author || "");
          break;
        case "addedAt":
          cmp = (a.addedAt || 0) - (b.addedAt || 0);
          break;
        case "lastOpenedAt":
          cmp = (a.lastOpenedAt || 0) - (b.lastOpenedAt || 0);
          break;
        case "progress":
          cmp = a.progress - b.progress;
          break;
      }
      return sortOrder === "desc" ? -cmp : cmp;
    });

    return result;
  }, [books, filter, activeTag]);

  const handleImport = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/epub+zip",
          "application/pdf",
          "application/x-mobipocket-ebook",
          "application/vnd.amazon.ebook",
          "application/vnd.comicbook+zip",
          "application/x-fictionbook+xml",
          "text/plain",
          "application/octet-stream",
        ],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const files = result.assets.map((a) => ({ uri: a.uri, name: a.name }));
      console.log(
        "[handleImport] Picked files:",
        files.map((f) => `${f.name} -> ${f.uri}`),
      );
      await importBooks(files);
      Alert.alert(
        t("library.importComplete", "导入完成"),
        t("library.importedCount", {
          count: files.length,
        }),
      );
    } catch (err) {
      console.error("Import failed:", err);
      Alert.alert(t("common.error", "错误"), t("library.importFailed", "导入失败，请重试"));
    }
  }, [importBooks, t]);

  const handleOpen = useCallback(
    (book: Book) => {
      nav.navigate("Reader", { bookId: book.id });
    },
    [nav],
  );

  const handleManageTags = useCallback((book: Book) => {
    setTagSheetBook(book);
    setTagSheetOpen(true);
    setNewTagInput("");
  }, []);

  // Process a single book vectorization
  const processOneBook = useCallback(
    async (book: Book) => {
      setVectorizingBookId(book.id);
      setVectorizingBookTitle(book.meta.title);
      setVectorProgress({ status: "chunking", processedChunks: 0, totalChunks: 0 });

      try {
        if (!extractorRef.current) {
          throw new Error("Extractor WebView not ready");
        }

        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();
        const absPath = await platform.joinPath(appData, book.filePath);

        const base64 = await FileSystem.readAsStringAsync(absPath, {
          encoding: FileSystem.EncodingType.Base64,
        });

        const chapters = await extractorRef.current.extractChapters(base64, "application/epub+zip");
        if (!chapters || chapters.length === 0) {
          throw new Error("No chapters extracted from book");
        }

        await triggerVectorizeBook(book.id, book.filePath, chapters, (progress) => {
          setVectorProgress(progress);
        });

        setVectorProgress({ status: "completed", processedChunks: 1, totalChunks: 1 });
        await new Promise((resolve) => setTimeout(resolve, 800));
      } catch (err) {
        console.error(`[LibraryScreen] Vectorization failed for "${book.meta.title}":`, err);
        setVectorProgress({ status: "error", processedChunks: 0, totalChunks: 0 });
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    },
    [],
  );

  // Process the vectorization queue serially
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    try {
      while (vectorQueueRef.current.length > 0) {
        const nextBook = vectorQueueRef.current[0]!;
        vectorQueueRef.current = vectorQueueRef.current.slice(1);
        setVectorQueue([...vectorQueueRef.current]);

        await processOneBook(nextBook);
      }
    } finally {
      isProcessingRef.current = false;
      setVectorizingBookId(null);
      setVectorProgress(null);
    }
  }, [processOneBook]);

  const handleVectorize = useCallback(
    (book: Book) => {
      // Check if vector model is configured
      const hasCapability = useVectorModelStore.getState().hasVectorCapability();
      if (!hasCapability) {
        Alert.alert(t("settings.vectorModel"), t("vectorize.notConfiguredDesc"), [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("vectorize.goSettings"),
            onPress: () => nav.navigate("VectorModelSettings"),
          },
        ]);
        return;
      }

      // Don't add if already in queue or currently processing
      const alreadyQueued = vectorQueueRef.current.some((b) => b.id === book.id);
      if (alreadyQueued || vectorizingBookId === book.id) return;

      vectorQueueRef.current = [...vectorQueueRef.current, book];
      setVectorQueue([...vectorQueueRef.current]);

      // Start processing if not already running
      if (!isProcessingRef.current) {
        processQueue();
      }
    },
    [nav, t, vectorizingBookId, processQueue],
  );

  const handleSortChange = useCallback(
    (field: SortField) => {
      if (filter.sortField === field) {
        setFilter({ sortOrder: filter.sortOrder === "asc" ? "desc" : "asc" });
      } else {
        setFilter({
          sortField: field,
          sortOrder: field === "title" || field === "author" ? "asc" : "desc",
        });
      }
      setShowSort(false);
    },
    [filter, setFilter],
  );

  const handleCreateAndAssignTag = useCallback(() => {
    const trimmed = newTagInput.trim();
    if (!trimmed || !tagSheetBook) return;
    addTag(trimmed);
    addTagToBook(tagSheetBook.id, trimmed);
    setNewTagInput("");
  }, [newTagInput, tagSheetBook, addTag, addTagToBook]);

  const isEmpty = filteredBooks.length === 0;
  const hasBooks = books.length > 0;

  const renderBookCard = useCallback(
    ({ item }: { item: Book }) => (
      <View style={s.gridItem}>
        <BookCard
          book={item}
          onOpen={handleOpen}
          onDelete={removeBook}
          onManageTags={handleManageTags}
          onVectorize={handleVectorize}
          isVectorizing={vectorizingBookId === item.id}
          isQueued={vectorQueue.some((b) => b.id === item.id)}
          vectorProgress={vectorizingBookId === item.id ? vectorProgress : null}
        />
      </View>
    ),
    [handleOpen, removeBook, handleManageTags, handleVectorize, vectorizingBookId, vectorQueue, vectorProgress],
  );

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={["top"]}>
      {showSearch && (
        <Pressable
          style={[StyleSheet.absoluteFill, { zIndex: 10 }]}
          onPress={() => {
            Keyboard.dismiss();
            if (!filter.search.trim()) closeSearch();
          }}
        />
      )}

      {/* Hidden Extractor WebView */}
      <ExtractorWebView ref={extractorRef} />

      {/* Header */}
      <View style={[s.header, { zIndex: 20 }]}>
        <View style={s.headerRow}>
          <Text style={s.headerTitle}>{t("sidebar.library", "书库")}</Text>
          <View style={s.headerActions}>
            {hasBooks && (
              <Animated.View
                style={[
                  s.animatedSearchWrap,
                  {
                    width: searchAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [36, screenWidth - 210],
                    }),
                    borderBottomColor: searchAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["transparent", colors.primary],
                    }),
                    borderBottomWidth: searchAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, 1],
                    }),
                  },
                ]}
              >
                <TouchableOpacity
                  style={s.headerBtn}
                  onPress={() => {
                    if (showSearch) {
                      if (!filter.search.trim()) {
                        closeSearch();
                        Keyboard.dismiss();
                      }
                    } else {
                      openSearch();
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <SearchIcon
                    size={18}
                    color={showSearch ? colors.primary : colors.mutedForeground}
                  />
                </TouchableOpacity>

                <Animated.View
                  style={{
                    flex: 1,
                    opacity: searchAnim,
                    flexDirection: "row",
                    alignItems: "center",
                  }}
                >
                  <TextInput
                    ref={searchInputRef}
                    style={s.searchInputInline}
                    placeholder={t("library.searchPlaceholder", "搜索...")}
                    placeholderTextColor={colors.mutedForeground}
                    value={filter.search}
                    onChangeText={(text) => setFilter({ search: text })}
                    onBlur={() => {
                      if (!filter.search.trim()) {
                        closeSearch();
                      }
                    }}
                    returnKeyType="search"
                  />
                  {filter.search.length > 0 && showSearch && (
                    <TouchableOpacity
                      style={s.clearSearchBtn}
                      onPress={() => {
                        setFilter({ search: "" });
                        searchInputRef.current?.focus();
                      }}
                    >
                      <XIcon size={14} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  )}
                </Animated.View>
              </Animated.View>
            )}

            {hasBooks && (
              <TouchableOpacity style={s.headerBtn} onPress={() => setShowSort(!showSort)}>
                <SortAscIcon size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={s.importBtn}
              onPress={handleImport}
              disabled={isImporting}
              activeOpacity={0.8}
            >
              {isImporting ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <PlusIcon size={18} color={colors.primaryForeground} />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Tag filter */}
        {hasBooks && allTags.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.tagScroll}
            contentContainerStyle={s.tagScrollContent}
          >
            <TouchableOpacity
              style={[s.tagChip, !activeTag && s.tagChipActive]}
              onPress={() => setActiveTag("")}
            >
              <Text style={[s.tagChipText, !activeTag && s.tagChipTextActive]}>
                {t("library.all", "全部")}
              </Text>
            </TouchableOpacity>
            {allTags.map((tag) => (
              <TouchableOpacity
                key={tag}
                style={[s.tagChip, activeTag === tag && s.tagChipActive]}
                onPress={() => setActiveTag(activeTag === tag ? "" : tag)}
              >
                <Text style={[s.tagChipText, activeTag === tag && s.tagChipTextActive]}>{tag}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[s.tagChip, activeTag === "__uncategorized__" && s.tagChipActive]}
              onPress={() =>
                setActiveTag(activeTag === "__uncategorized__" ? "" : "__uncategorized__")
              }
            >
              <Text
                style={[s.tagChipText, activeTag === "__uncategorized__" && s.tagChipTextActive]}
              >
                {t("sidebar.uncategorized", "未分类")}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>

      {/* Sort dropdown */}
      <Modal
        visible={showSort}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSort(false)}
      >
        <Pressable style={s.sortOverlay} onPress={() => setShowSort(false)} />
        <View style={s.sortDropdown}>
          {SORT_OPTIONS.map(({ field, labelKey }) => (
            <TouchableOpacity
              key={field}
              style={[s.sortItem, filter.sortField === field && s.sortItemActive]}
              onPress={() => handleSortChange(field)}
            >
              {field === "lastOpenedAt" ? (
                <ClockIcon size={14} color={colors.mutedForeground} />
              ) : filter.sortField === field && filter.sortOrder === "asc" ? (
                <ArrowUpAZIcon size={14} color={colors.mutedForeground} />
              ) : (
                <ArrowDownAZIcon size={14} color={colors.mutedForeground} />
              )}
              <Text style={[s.sortText, filter.sortField === field && s.sortTextActive]}>
                {t(labelKey)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </Modal>

      {/* Content */}
      <View style={s.content}>
        {!isLoaded && (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={colors.mutedForeground} />
          </View>
        )}

        {/* Importing banner */}
        {isImporting && (
          <View style={s.importBanner}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={s.importBannerText}>{t("library.importing", "正在导入...")}</Text>
          </View>
        )}

        {/* Empty state */}
        {isLoaded && books.length === 0 && (
          <View style={s.emptyWrap}>
            <Image source={isDark ? BOOK_DARK_PNG : BOOK_PNG} style={{ width: 160, height: 160 }} />
            <Text style={s.emptyTitle}>{t("library.empty", "暂无书籍")}</Text>
            <Text style={s.emptyHint}>{t("library.emptyHint", "导入电子书开始阅读之旅")}</Text>
            <TouchableOpacity style={s.emptyImportBtn} onPress={handleImport} activeOpacity={0.8}>
              <Text style={s.emptyImportText}>{t("library.importFirst", "导入书籍")}</Text>
            </TouchableOpacity>
          </View>
        )}

        {isLoaded && hasBooks && isEmpty && (
          <View style={s.noResultsWrap}>
            <SearchIcon size={40} color={withOpacity(colors.mutedForeground, 0.3)} />
            <Text style={s.noResultsText}>{t("library.noResults", "没有找到匹配的书籍")}</Text>
          </View>
        )}

        {isLoaded && hasBooks && filter.search && !isEmpty && (
          <Text style={s.resultsCount}>
            {t("library.resultsCount", { count: filteredBooks.length })}
          </Text>
        )}

        {isLoaded && !isEmpty && (
          <FlatList
            data={filteredBooks}
            renderItem={renderBookCard}
            keyExtractor={(item) => item.id}
            numColumns={NUM_COLUMNS}
            columnWrapperStyle={s.gridRow}
            contentContainerStyle={s.gridContent}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      {/* Tag Management Sheet */}
      <Modal
        visible={tagSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setTagSheetOpen(false)}
      >
        <Pressable style={s.tagSheetOverlay} onPress={() => setTagSheetOpen(false)} />
        <View style={s.tagSheet}>
          <View style={s.tagSheetHandle} />
          <Text style={s.tagSheetTitle}>{t("home.manageTags", "管理标签")}</Text>

          <ScrollView style={s.tagSheetList}>
            {allTags.length > 0 ? (
              allTags.map((tag) => {
                const hasTag = tagSheetBook?.tags.includes(tag) ?? false;
                const isEditing = editingTag === tag;
                return (
                  <View key={tag} style={s.tagSheetItem}>
                    <TouchableOpacity
                      style={s.tagCheckboxRow}
                      onPress={() => {
                        if (!tagSheetBook) return;
                        if (hasTag) removeTagFromBook(tagSheetBook.id, tag);
                        else addTagToBook(tagSheetBook.id, tag);
                      }}
                    >
                      <View style={[s.tagCheckbox, hasTag && s.tagCheckboxActive]}>
                        {hasTag && <CheckIcon size={12} color={colors.primaryForeground} />}
                      </View>
                      {isEditing ? (
                        <TextInput
                          style={s.tagEditInput}
                          value={editingName}
                          onChangeText={setEditingName}
                          autoFocus
                          onSubmitEditing={() => {
                            const trimmed = editingName.trim();
                            if (trimmed && trimmed !== tag) {
                              renameTag(tag, trimmed);
                            }
                            setEditingTag(null);
                            setEditingName("");
                          }}
                          onBlur={() => {
                            setEditingTag(null);
                            setEditingName("");
                          }}
                          returnKeyType="done"
                        />
                      ) : (
                        <Text style={s.tagSheetItemText}>{tag}</Text>
                      )}
                    </TouchableOpacity>
                    <View style={s.tagActionRow}>
                      <TouchableOpacity
                        style={s.tagActionBtn}
                        onPress={() => {
                          setEditingTag(tag);
                          setEditingName(tag);
                        }}
                      >
                        <EditIcon size={14} color={colors.mutedForeground} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={s.tagActionBtn}
                        onPress={() => {
                          Alert.alert(
                            t("common.confirm", "确认"),
                            t("library.deleteTagConfirm", `确定删除标签"${tag}"？`),
                            [
                              { text: t("common.cancel", "取消"), style: "cancel" },
                              {
                                text: t("common.delete", "删除"),
                                style: "destructive",
                                onPress: () => removeTag(tag),
                              },
                            ],
                          );
                        }}
                      >
                        <Trash2Icon size={14} color={colors.mutedForeground} />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            ) : (
              <Text style={s.tagSheetEmpty}>{t("sidebar.noTags", "暂无标签")}</Text>
            )}

            {/* New tag input */}
            <View style={s.tagInputDivider} />
            <View style={s.tagInputRow}>
              <View style={s.tagInputWrap}>
                <PlusIcon size={16} color={colors.mutedForeground} />
                <TextInput
                  style={s.tagInput}
                  placeholder={t("sidebar.tagPlaceholder", "输入标签名...")}
                  placeholderTextColor={colors.mutedForeground}
                  value={newTagInput}
                  onChangeText={setNewTagInput}
                  onSubmitEditing={handleCreateAndAssignTag}
                  returnKeyType="done"
                />
                {newTagInput.length > 0 && (
                  <TouchableOpacity onPress={() => setNewTagInput("")}>
                    <XIcon size={14} color={colors.mutedForeground} />
                  </TouchableOpacity>
                )}
              </View>
              {newTagInput.trim().length > 0 && (
                <TouchableOpacity style={s.tagAddBtn} onPress={handleCreateAndAssignTag}>
                  <Text style={s.tagAddText}>{t("common.add", "添加")}</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: SCREEN_PADDING, paddingTop: 12, paddingBottom: 8 },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    headerTitle: {
      fontSize: fontSize["2xl"],
      fontWeight: fontWeight.bold,
      color: colors.foreground,
    },
    headerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
    headerBtn: {
      width: 36,
      height: 36,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
    },
    importBtn: {
      width: 36,
      height: 36,
      borderRadius: radius.full,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    animatedSearchWrap: {
      flexDirection: "row",
      alignItems: "center",
      height: 36,
      overflow: "hidden",
    },
    searchInputInline: {
      flex: 1,
      fontSize: fontSize.sm,
      color: colors.foreground,
      padding: 0,
      minWidth: 50,
    },
    clearSearchBtn: {
      width: 24,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    // Tags
    tagScroll: { marginBottom: 4 },
    tagScrollContent: { gap: 6, paddingRight: 8 },
    tagChip: {
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: radius.full,
      backgroundColor: colors.muted,
    },
    tagChipActive: { backgroundColor: colors.primary },
    tagChipText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
    },
    tagChipTextActive: { color: colors.primaryForeground },
    // Sort dropdown
    sortOverlay: { flex: 1 },
    sortDropdown: {
      position: "absolute",
      top: 110,
      right: 16,
      minWidth: 160,
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 0.5,
      borderColor: colors.border,
      padding: 4,
      elevation: 5,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
    },
    sortItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.lg,
    },
    sortItemActive: { backgroundColor: colors.muted },
    sortText: { fontSize: fontSize.xs, color: colors.foreground },
    sortTextActive: { fontWeight: fontWeight.medium },
    // Content
    content: { flex: 1, paddingHorizontal: SCREEN_PADDING },
    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
    importBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.muted + "0D",
      borderRadius: radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginBottom: 12,
    },
    importBannerText: { fontSize: fontSize.xs, color: colors.primary },
    // Vectorization banner
    vecBanner: {
      backgroundColor: colors.muted + "0D",
      borderRadius: radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 12,
    },
    vecBannerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    vecBannerInfo: { flex: 1, minWidth: 0 },
    vecBannerStatusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    vecBannerStatus: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.primary,
    },
    vecBannerTitle: { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
    vecProgressBg: {
      height: 4,
      backgroundColor: colors.muted + "1A",
      borderRadius: radius.full,
      marginTop: 8,
      overflow: "hidden",
    },
    vecProgressFill: { height: 4, backgroundColor: colors.primary, borderRadius: radius.full },
    // Empty
    emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
    emptyIconWrap: {
      width: 80,
      height: 80,
      borderRadius: radius.full,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
    },
    emptyTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      marginBottom: 8,
    },
    emptyHint: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      textAlign: "center",
      maxWidth: 240,
      marginBottom: 24,
    },
    emptyImportBtn: {
      backgroundColor: colors.primary,
      borderRadius: radius.full,
      paddingHorizontal: 24,
      paddingVertical: 10,
    },
    emptyImportText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primaryForeground,
    },
    noResultsWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 80 },
    noResultsText: { fontSize: fontSize.sm, color: colors.mutedForeground, marginTop: 12 },
    resultsCount: { fontSize: fontSize.xs, color: colors.mutedForeground, marginBottom: 8 },
    // Grid
    gridRow: { gap: GRID_GAP },
    gridContent: { paddingBottom: 16, paddingTop: 4 },
    gridItem: {
      width: (screenWidth - SCREEN_PADDING * 2 - GRID_GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS,
      marginBottom: 4,
    },
    // Tag Management Sheet
    tagSheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
    tagSheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingBottom: 34,
      maxHeight: "70%",
    },
    tagSheetHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.muted,
      alignSelf: "center",
      marginTop: 12,
      marginBottom: 8,
    },
    tagSheetTitle: {
      fontSize: fontSize.md,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      paddingHorizontal: 20,
      marginBottom: 8,
    },
    tagSheetList: { paddingHorizontal: 8 },
    tagSheetItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: radius.lg,
    },
    tagCheckboxRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      flex: 1,
      minWidth: 0,
    },
    tagCheckbox: {
      width: 20,
      height: 20,
      borderRadius: 4,
      borderWidth: 2,
      borderColor: withOpacity(colors.mutedForeground, 0.4),
      alignItems: "center",
      justifyContent: "center",
    },
    tagCheckboxActive: { borderColor: colors.primary, backgroundColor: colors.primary },
    tagSheetItemText: { fontSize: fontSize.sm, color: colors.foreground },
    tagEditInput: {
      flex: 1,
      fontSize: fontSize.sm,
      color: colors.foreground,
      padding: 0,
      borderBottomWidth: 1,
      borderBottomColor: colors.primary,
    },
    tagActionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    tagActionBtn: {
      padding: 6,
      borderRadius: radius.sm,
    },
    tagSheetEmpty: {
      textAlign: "center",
      paddingVertical: 16,
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    tagInputDivider: {
      height: 0.5,
      backgroundColor: colors.border,
      marginTop: 12,
      marginBottom: 12,
    },
    tagInputRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 },
    tagInputWrap: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.muted,
      borderRadius: radius.lg,
      paddingHorizontal: 12,
      height: 36,
    },
    tagInput: { flex: 1, fontSize: fontSize.sm, color: colors.foreground, padding: 0 },
    tagAddBtn: {
      backgroundColor: colors.primary,
      borderRadius: radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    tagAddText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primaryForeground,
    },
  });
