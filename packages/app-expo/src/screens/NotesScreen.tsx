/**
 * NotesScreen — matching Tauri mobile NotesPage exactly.
 * Features: stats header, book notebooks list with covers, detail view with
 * highlights/notes tabs, chapter grouping, color dots, edit/delete, export, search.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  ScrollView,
  Alert,
  Modal,
  Pressable,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useAnnotationStore, useLibraryStore } from "@/stores";
import type { HighlightWithBook } from "@readany/core/db/database";
import { HIGHLIGHT_COLOR_HEX } from "@readany/core/types";
import { type ThemeColors, radius, fontSize, fontWeight, useColors } from "@/styles/theme";
import { getPlatformService } from "@readany/core/services";
import {
  NotebookPenIcon,
  HighlighterIcon,
  BookOpenIcon,
  SearchIcon,
  XIcon,
  ChevronLeftIcon,
  Trash2Icon,
  EditIcon,
  CheckIcon,
  ShareIcon,
} from "@/components/ui/Icon";

const NOTE_PNG = require("../../assets/note.png");

type Nav = NativeStackNavigationProp<RootStackParamList>;
type DetailTab = "notes" | "highlights";

export function NotesScreen() {
  const colors = useColors();
  const s = makeStyles(colors);
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const {
    highlightsWithBooks,
    loadAllHighlightsWithBooks,
    removeHighlight,
    updateHighlight,
    stats,
    loadStats,
  } = useAnnotationStore();
  const books = useLibraryStore((s) => s.books);

  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [detailTab, setDetailTab] = useState<DetailTab>("notes");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [resolvedCovers, setResolvedCovers] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      loadAllHighlightsWithBooks(500),
      loadStats(),
    ]).finally(() => setIsLoading(false));
  }, [loadAllHighlightsWithBooks, loadStats]);

  // Group by book — matching Tauri exactly
  const bookNotebooks = useMemo(() => {
    const grouped = new Map<string, {
      bookId: string;
      title: string;
      author: string;
      coverUrl: string | null;
      highlights: HighlightWithBook[];
      notesCount: number;
      highlightsOnlyCount: number;
      latestAt: number;
    }>();

    for (const h of highlightsWithBooks) {
      const existing = grouped.get(h.bookId);
      if (existing) {
        existing.highlights.push(h);
        if (h.note) existing.notesCount++;
        else existing.highlightsOnlyCount++;
        if (h.createdAt > existing.latestAt) existing.latestAt = h.createdAt;
      } else {
        grouped.set(h.bookId, {
          bookId: h.bookId,
          title: h.bookTitle || t("notes.unknownBook", "未知书籍"),
          author: h.bookAuthor || t("notes.unknownAuthor", "未知作者"),
          coverUrl: h.bookCoverUrl || null,
          highlights: [h],
          notesCount: h.note ? 1 : 0,
          highlightsOnlyCount: h.note ? 0 : 1,
          latestAt: h.createdAt,
        });
      }
    }

    return Array.from(grouped.values()).sort((a, b) => b.latestAt - a.latestAt);
  }, [highlightsWithBooks, t]);

  // Resolve cover URLs from relative paths to absolute paths
  useEffect(() => {
    const resolveCovers = async () => {
      const newMap = new Map<string, string>();
      try {
        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();

        for (const book of bookNotebooks) {
          if (!book.coverUrl) continue;

          // If already absolute, use as-is
          if (book.coverUrl.startsWith("http") || book.coverUrl.startsWith("blob") || book.coverUrl.startsWith("file")) {
            newMap.set(book.bookId, book.coverUrl);
            continue;
          }

          // Resolve relative path
          try {
            const absPath = await platform.joinPath(appData, book.coverUrl);
            newMap.set(book.bookId, absPath);
          } catch {
            // If resolution fails, skip this cover
          }
        }

        setResolvedCovers(newMap);
      } catch (err) {
        console.error("Failed to resolve cover URLs:", err);
      }
    };

    if (bookNotebooks.length > 0) {
      resolveCovers();
    }
  }, [bookNotebooks]);

  const selectedBook = useMemo(() => {
    if (!selectedBookId) return null;
    return bookNotebooks.find((b) => b.bookId === selectedBookId) || null;
  }, [selectedBookId, bookNotebooks]);

  const { notesList, highlightsList } = useMemo(() => {
    if (!selectedBook) return { notesList: [], highlightsList: [] };
    let all = selectedBook.highlights;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      all = all.filter(
        (h) => h.text.toLowerCase().includes(q) ||
          h.note?.toLowerCase().includes(q) ||
          h.chapterTitle?.toLowerCase().includes(q),
      );
    }
    const sorted = all.sort((a, b) => b.createdAt - a.createdAt);
    return {
      notesList: sorted.filter((h) => h.note),
      highlightsList: sorted.filter((h) => !h.note),
    };
  }, [selectedBook, searchQuery]);

  const currentList = detailTab === "notes" ? notesList : highlightsList;

  // Group by chapter
  const itemsByChapter = useMemo(() => {
    const chapters: { chapter: string; items: HighlightWithBook[] }[] = [];
    const chapterMap = new Map<string, HighlightWithBook[]>();
    for (const h of currentList) {
      const chapter = h.chapterTitle || t("notes.unknownChapter", "未知章节");
      const arr = chapterMap.get(chapter) || [];
      arr.push(h);
      chapterMap.set(chapter, arr);
    }
    for (const [chapter, items] of chapterMap) {
      chapters.push({ chapter, items });
    }
    return chapters;
  }, [currentList, t]);

  const handleOpenBook = useCallback((bookId: string, cfi?: string) => {
    nav.navigate("Reader", { bookId, cfi });
  }, [nav]);

  const handleDeleteNote = useCallback((highlight: HighlightWithBook) => {
    Alert.alert(t("common.confirm", "确认"), t("notes.deleteNoteConfirm", "确定删除此笔记？"), [
      { text: t("common.cancel", "取消"), style: "cancel" },
      {
        text: t("common.delete", "删除"), style: "destructive",
        onPress: () => { updateHighlight(highlight.id, { note: undefined }); loadStats(); },
      },
    ]);
  }, [updateHighlight, loadStats, t]);

  const handleDeleteHighlight = useCallback((highlight: HighlightWithBook) => {
    Alert.alert(t("common.confirm", "确认"), t("notes.deleteHighlightConfirm", "确定删除此高亮？"), [
      { text: t("common.cancel", "取消"), style: "cancel" },
      {
        text: t("common.delete", "删除"), style: "destructive",
        onPress: () => { removeHighlight(highlight.id); loadStats(); },
      },
    ]);
  }, [removeHighlight, loadStats, t]);

  const startEditNote = useCallback((highlight: HighlightWithBook) => {
    setEditingId(highlight.id);
    setEditNote(highlight.note || "");
  }, []);

  const saveNote = useCallback((id: string) => {
    updateHighlight(id, { note: editNote || undefined });
    setEditingId(null);
    setEditNote("");
  }, [updateHighlight, editNote]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditNote("");
  }, []);

  const totalHighlights = stats?.totalHighlights ?? 0;
  const totalNotes = stats?.highlightsWithNotes ?? 0;
  const totalBooks = stats?.totalBooks ?? 0;

  // Loading
  if (isLoading) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={["top"]}>
        <View style={s.loadingWrap}>
          <View style={s.spinner} />
          <Text style={s.loadingText}>{t("common.loading", "加载中...")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Empty
  if (bookNotebooks.length === 0) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={["top"]}>
        <View style={s.header}>
          <Text style={s.headerTitle}>{t("notes.title", "笔记")}</Text>
        </View>
        <View style={s.emptyWrap}>
          <Image source={NOTE_PNG} style={{ width: 160, height: 160 }} />
          <Text style={s.emptyTitle}>{t("notes.empty", "暂无笔记")}</Text>
          <Text style={s.emptyHint}>{t("notes.emptyHint", "阅读时长按文字添加高亮和笔记")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Detail view
  if (selectedBookId && selectedBook) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={["top", "bottom"]}>
        {/* Detail header */}
        <View style={s.detailHeader}>
          <View style={s.detailHeaderTop}>
            <TouchableOpacity
              style={s.backBtn}
              onPress={() => {
                setSelectedBookId(null);
                setSearchQuery("");
                setEditingId(null);
              }}
            >
              <ChevronLeftIcon size={20} color={colors.foreground} />
            </TouchableOpacity>

            {/* Book cover */}
            {(resolvedCovers.get(selectedBook.bookId) || selectedBook.coverUrl) ? (
              <Image
                source={{ uri: resolvedCovers.get(selectedBook.bookId) || selectedBook.coverUrl }}
                style={s.detailCover}
                resizeMode="cover"
              />
            ) : (
              <View style={s.detailCoverFallback}>
                <BookOpenIcon size={16} color={colors.mutedForeground} />
              </View>
            )}

            <View style={s.detailHeaderInfo}>
              <Text style={s.detailTitle} numberOfLines={1}>{selectedBook.title}</Text>
              <Text style={s.detailAuthor}>{selectedBook.author}</Text>
            </View>

            {/* Export button */}
            <TouchableOpacity
              style={s.exportBtn}
              onPress={() => setShowExportMenu(!showExportMenu)}
            >
              <ShareIcon size={16} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          {/* Tabs + search */}
          <View style={s.detailTabRow}>
            <View style={s.tabSwitcher}>
              <TouchableOpacity
                style={[s.tabBtn, detailTab === "notes" && s.tabBtnActive]}
                onPress={() => setDetailTab("notes")}
              >
                <NotebookPenIcon size={12} color={detailTab === "notes" ? colors.primaryForeground : colors.mutedForeground} />
                <Text style={[s.tabBtnText, detailTab === "notes" && s.tabBtnTextActive]}>
                  {t("notebook.notesSection", "笔记")} ({selectedBook.notesCount || 0})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.tabBtn, detailTab === "highlights" && s.tabBtnActive]}
                onPress={() => setDetailTab("highlights")}
              >
                <HighlighterIcon size={12} color={detailTab === "highlights" ? colors.primaryForeground : colors.mutedForeground} />
                <Text style={[s.tabBtnText, detailTab === "highlights" && s.tabBtnTextActive]}>
                  {t("notebook.highlightsSection", "高亮")} ({selectedBook.highlightsOnlyCount || 0})
                </Text>
              </TouchableOpacity>
            </View>

            <View style={s.detailSearch}>
              <SearchIcon size={14} color={colors.mutedForeground} />
              <TextInput
                style={s.detailSearchInput}
                placeholder={t("notes.searchPlaceholder", "搜索...")}
                placeholderTextColor={colors.mutedForeground}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
          </View>
        </View>

        {/* Detail content */}
        {currentList.length === 0 ? (
          <View style={s.detailEmpty}>
            <Text style={s.detailEmptyText}>
              {searchQuery
                ? t("notes.noSearchResults", "没有匹配结果")
                : detailTab === "notes"
                  ? t("notes.noNotes", "暂无笔记")
                  : t("highlights.noHighlights", "暂无高亮")}
            </Text>
          </View>
        ) : (
          <ScrollView style={s.detailList} showsVerticalScrollIndicator={false}>
            {itemsByChapter.map(({ chapter, items }) => (
              <View key={chapter} style={s.chapterGroup}>
                {/* Chapter divider */}
                <View style={s.chapterDivider}>
                  <View style={s.chapterLine} />
                  <Text style={s.chapterName}>{chapter}</Text>
                  <View style={s.chapterLine} />
                </View>

                {items.map((item) => (
                  detailTab === "notes" ? (
                    <NoteCard
                      key={item.id}
                      highlight={item}
                      isEditing={editingId === item.id}
                      editNote={editNote}
                      setEditNote={setEditNote}
                      onStartEdit={() => startEditNote(item)}
                      onSaveNote={() => saveNote(item.id)}
                      onCancelEdit={cancelEdit}
                      onDeleteNote={() => handleDeleteNote(item)}
                      onNavigate={() => handleOpenBook(selectedBook.bookId, item.cfi)}
                      t={t}
                    />
                  ) : (
                    <HighlightCard
                      key={item.id}
                      highlight={item}
                      onDelete={() => handleDeleteHighlight(item)}
                      onNavigate={() => handleOpenBook(selectedBook.bookId, item.cfi)}
                    />
                  )
                ))}
              </View>
            ))}
            <View style={{ height: 24 }} />
          </ScrollView>
        )}

        {/* Export menu */}
        <Modal visible={showExportMenu} transparent animationType="fade" onRequestClose={() => setShowExportMenu(false)}>
          <Pressable style={s.exportOverlay} onPress={() => setShowExportMenu(false)} />
          <View style={s.exportDropdown}>
            {(["markdown", "json", "obsidian", "notion"] as const).map((fmt) => (
              <TouchableOpacity
                key={fmt}
                style={s.exportItem}
                onPress={() => {
                  setShowExportMenu(false);
                }}
              >
                <Text style={s.exportItemText}>
                  {fmt === "markdown" ? "Markdown" : fmt === "json" ? "JSON" : fmt === "obsidian" ? "Obsidian" : "Notion"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  // Main list view
  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={["top", "bottom"]}>
      <View style={s.header}>
        <View style={s.headerRow}>
          <Text style={s.headerTitle}>{t("notes.title", "笔记")}</Text>
          {bookNotebooks.length > 0 && (
            <TouchableOpacity
              style={s.searchToggle}
              onPress={() => {
                setShowSearch(!showSearch);
                if (showSearch) setSearchQuery("");
              }}
            >
              {showSearch ? (
                <XIcon size={18} color={colors.mutedForeground} />
              ) : (
                <SearchIcon size={18} color={colors.mutedForeground} />
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Stats row */}
        <View style={s.statsRow}>
          <View style={s.statBadge}>
            <HighlighterIcon size={14} color={colors.amber} />
            <Text style={s.statValue}>{totalHighlights}</Text>
            <Text style={s.statLabel}>{t("notebook.highlightsSection", "高亮")}</Text>
          </View>
          <View style={s.statBadge}>
            <NotebookPenIcon size={14} color={colors.blue} />
            <Text style={s.statValue}>{totalNotes}</Text>
            <Text style={s.statLabel}>{t("notebook.notesSection", "笔记")}</Text>
          </View>
          <View style={s.statBadge}>
            <BookOpenIcon size={14} color={colors.emerald} />
            <Text style={s.statValue}>{totalBooks}</Text>
            <Text style={s.statLabel}>{t("profile.booksUnit", "本")}</Text>
          </View>
        </View>

        {showSearch && (
          <View style={s.searchBar}>
            <SearchIcon size={14} color={colors.mutedForeground} />
            <TextInput
              style={s.searchInput}
              placeholder={t("notes.searchPlaceholder", "搜索笔记...")}
              placeholderTextColor={colors.mutedForeground}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <XIcon size={14} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* Notebook list */}
      <FlatList
        data={bookNotebooks}
        keyExtractor={(item) => item.bookId}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <NotebookCard
            book={item}
            resolvedCoverUrl={resolvedCovers.get(item.bookId)}
            onPress={() => {
              setSelectedBookId(item.bookId);
              setSearchQuery("");
              setEditingId(null);
              setDetailTab("notes");
            }}
          />
        )}
      />
    </SafeAreaView>
  );
}

/** NotebookCard with cover — matching Tauri exactly */
function NotebookCard({
  book,
  onPress,
  resolvedCoverUrl,
}: {
  book: {
    bookId: string;
    title: string;
    author: string;
    coverUrl: string | null;
    highlights: HighlightWithBook[];
    notesCount: number;
    highlightsOnlyCount: number;
  };
  onPress: () => void;
  resolvedCoverUrl?: string;
}) {
  const colors = useColors();
  const s = makeStyles(colors);
  return (
    <TouchableOpacity style={s.notebookCard} activeOpacity={0.7} onPress={onPress}>
      {/* Cover */}
      {(resolvedCoverUrl || book.coverUrl) ? (
        <Image source={{ uri: resolvedCoverUrl || book.coverUrl }} style={s.notebookCover} resizeMode="cover" />
      ) : (
        <View style={s.notebookCoverFallback}>
          <BookOpenIcon size={20} color={colors.mutedForeground} />
        </View>
      )}

      <View style={s.notebookInfo}>
        <Text style={s.notebookTitle} numberOfLines={1}>{book.title}</Text>
        <Text style={s.notebookAuthor} numberOfLines={1}>{book.author}</Text>
        <View style={s.notebookStats}>
          <View style={s.notebookStatItem}>
            <NotebookPenIcon size={12} color={colors.mutedForeground} />
            <Text style={s.notebookStatText}>{book.notesCount}</Text>
          </View>
          <View style={s.notebookStatItem}>
            <HighlighterIcon size={12} color={colors.mutedForeground} />
            <Text style={s.notebookStatText}>{book.highlightsOnlyCount}</Text>
          </View>
        </View>
      </View>

      <View style={s.notebookBadge}>
        <Text style={s.notebookBadgeText}>{book.highlights.length}</Text>
      </View>
    </TouchableOpacity>
  );
}

/** Note detail card — matching Tauri NoteDetailCard */
function NoteCard({
  highlight,
  isEditing,
  editNote,
  setEditNote,
  onStartEdit,
  onSaveNote,
  onCancelEdit,
  onDeleteNote,
  onNavigate,
  t,
}: {
  highlight: HighlightWithBook;
  isEditing: boolean;
  editNote: string;
  setEditNote: (note: string) => void;
  onStartEdit: () => void;
  onSaveNote: () => void;
  onCancelEdit: () => void;
  onDeleteNote: () => void;
  onNavigate: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const colors = useColors();
  const s = makeStyles(colors);
  return (
    <View style={s.noteCard}>
      <TouchableOpacity style={s.noteCardTop} onPress={onNavigate}>
        <View
          style={[s.colorDot, { backgroundColor: HIGHLIGHT_COLOR_HEX[highlight.color] || colors.amber }]}
        />
        <Text style={s.noteQuote} numberOfLines={2}>"{highlight.text}"</Text>
      </TouchableOpacity>

      {isEditing ? (
        <View style={s.editArea}>
          <TextInput
            style={s.editInput}
            value={editNote}
            onChangeText={setEditNote}
            multiline
            autoFocus
            placeholder={t("notebook.addNote", "添加笔记")}
            placeholderTextColor={colors.mutedForeground}
          />
          <View style={s.editActions}>
            <TouchableOpacity style={s.editCancelBtn} onPress={onCancelEdit}>
              <XIcon size={12} color={colors.mutedForeground} />
              <Text style={s.editCancelText}>{t("common.cancel", "取消")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.editSaveBtn} onPress={onSaveNote}>
              <CheckIcon size={12} color={colors.primaryForeground} />
              <Text style={s.editSaveText}>{t("common.save", "保存")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <>
          {highlight.note && (
            <TouchableOpacity style={s.noteBody} onPress={onNavigate}>
              <Text style={s.noteText}>{highlight.note}</Text>
            </TouchableOpacity>
          )}
          <View style={s.noteActions}>
            <TouchableOpacity style={s.noteActionBtn} onPress={onStartEdit}>
              <EditIcon size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity style={s.noteActionBtn} onPress={onDeleteNote}>
              <Trash2Icon size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

/** Highlight detail card — matching Tauri HighlightDetailCard */
function HighlightCard({
  highlight,
  onDelete,
  onNavigate,
}: {
  highlight: HighlightWithBook;
  onDelete: () => void;
  onNavigate: () => void;
}) {
  const colors = useColors();
  const s = makeStyles(colors);
  return (
    <View style={s.highlightCard}>
      <TouchableOpacity
        style={[s.colorDot, { backgroundColor: HIGHLIGHT_COLOR_HEX[highlight.color] || colors.amber, marginTop: 4 }]}
        onPress={onNavigate}
      />
      <View style={s.highlightBody}>
        <TouchableOpacity onPress={onNavigate}>
          <Text style={s.highlightText} numberOfLines={2}>"{highlight.text}"</Text>
        </TouchableOpacity>
        {highlight.chapterTitle && (
          <Text style={s.highlightChapter}>{highlight.chapterTitle}</Text>
        )}
      </View>
      <TouchableOpacity style={s.highlightDeleteBtn} onPress={onDelete}>
        <Trash2Icon size={14} color={colors.mutedForeground} />
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  spinner: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: "rgba(224,224,230,0.3)", borderTopColor: colors.primary },
  loadingText: { fontSize: fontSize.sm, color: colors.mutedForeground },
  // Header
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerTitle: { fontSize: fontSize["2xl"], fontWeight: fontWeight.bold, color: colors.foreground },
  searchToggle: { width: 36, height: 36, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  statsRow: { flexDirection: "row", gap: 12, marginTop: 10 },
  statBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.muted, borderRadius: radius.lg, paddingHorizontal: 10, paddingVertical: 6 },
  statValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  statLabel: { fontSize: 10, color: colors.mutedForeground },
  searchBar: { flexDirection: "row", alignItems: "center", backgroundColor: colors.muted, borderRadius: radius.lg, paddingHorizontal: 12, height: 36, gap: 8, marginTop: 10 },
  searchInput: { flex: 1, fontSize: fontSize.sm, color: colors.foreground, padding: 0 },
  // Empty
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  emptyIconWrap: { width: 80, height: 80, borderRadius: radius.full, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground, marginBottom: 8 },
  emptyHint: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: "center", maxWidth: 260 },
  // Notebook list
  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },
  notebookCard: { flexDirection: "row", alignItems: "flex-start", backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 0.5, borderColor: colors.border, padding: 12, marginBottom: 12, gap: 12 },
  notebookCover: { width: 44, height: 64, borderRadius: radius.sm, backgroundColor: colors.muted },
  notebookCoverFallback: { width: 44, height: 64, borderRadius: radius.sm, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" },
  notebookInfo: { flex: 1, gap: 4 },
  notebookTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.foreground },
  notebookAuthor: { fontSize: fontSize.xs, color: colors.mutedForeground },
  notebookStats: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  notebookStatItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  notebookStatText: { fontSize: fontSize.xs, color: colors.mutedForeground },
  notebookBadge: { backgroundColor: colors.muted, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  notebookBadgeText: { fontSize: fontSize.xs, color: colors.mutedForeground },
  // Detail header
  detailHeader: { borderBottomWidth: 0.5, borderBottomColor: colors.border },
  detailHeaderTop: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 32, height: 32, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  detailCover: { width: 28, height: 40, borderRadius: 4, backgroundColor: colors.muted },
  detailCoverFallback: { width: 28, height: 40, borderRadius: 4, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" },
  detailHeaderInfo: { flex: 1, minWidth: 0 },
  detailTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  detailAuthor: { fontSize: fontSize.xs, color: colors.mutedForeground },
  exportBtn: { width: 32, height: 32, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  // Tabs
  detailTabRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  tabSwitcher: { flexDirection: "row", borderWidth: 0.5, borderColor: colors.border, borderRadius: radius.lg, padding: 2 },
  tabBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.md },
  tabBtnActive: { backgroundColor: colors.primary },
  tabBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.mutedForeground },
  tabBtnTextActive: { color: colors.primaryForeground },
  detailSearch: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.muted, borderRadius: radius.lg, paddingHorizontal: 12, height: 32 },
  detailSearchInput: { flex: 1, fontSize: fontSize.sm, color: colors.foreground, padding: 0 },
  // Detail empty
  detailEmpty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  detailEmptyText: { fontSize: fontSize.sm, color: colors.mutedForeground },
  // Detail list
  detailList: { flex: 1, paddingHorizontal: 16 },
  chapterGroup: { marginBottom: 16 },
  chapterDivider: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  chapterLine: { flex: 1, height: 0.5, backgroundColor: colors.border },
  chapterName: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.mutedForeground, paddingHorizontal: 8 },
  // Note card
  noteCard: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 0.5, borderColor: colors.border, padding: 12, marginBottom: 8 },
  noteCardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  colorDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  noteQuote: { flex: 1, fontSize: fontSize.sm, color: colors.foreground, lineHeight: 20 },
  noteBody: { marginTop: 8, backgroundColor: colors.muted, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 6 },
  noteText: { fontSize: fontSize.xs, color: colors.mutedForeground, lineHeight: 16 },
  noteActions: { flexDirection: "row", justifyContent: "flex-end", gap: 4, marginTop: 8 },
  noteActionBtn: { padding: 6, borderRadius: radius.sm },
  // Edit
  editArea: { marginTop: 8 },
  editInput: { minHeight: 80, backgroundColor: colors.muted, borderRadius: radius.md, padding: 12, fontSize: fontSize.sm, color: colors.foreground, textAlignVertical: "top" },
  editActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8 },
  editCancelBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.md },
  editCancelText: { fontSize: fontSize.xs, color: colors.mutedForeground },
  editSaveBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.primary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.md },
  editSaveText: { fontSize: fontSize.xs, color: colors.primaryForeground },
  // Highlight card
  highlightCard: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 0.5, borderColor: colors.border, padding: 12, marginBottom: 8 },
  highlightBody: { flex: 1, minWidth: 0 },
  highlightText: { fontSize: fontSize.sm, color: colors.foreground, lineHeight: 20 },
  highlightChapter: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 4 },
  highlightDeleteBtn: { padding: 6, borderRadius: radius.sm },
  // Export
  exportOverlay: { flex: 1 },
  exportDropdown: { position: "absolute", top: 56, right: 16, minWidth: 140, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 0.5, borderColor: colors.border, padding: 4, elevation: 5, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
  exportItem: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md },
  exportItemText: { fontSize: fontSize.sm, color: colors.foreground },
});
