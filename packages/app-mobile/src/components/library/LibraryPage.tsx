/**
 * LibraryPage — Mobile book library with grid, search, tag filter, sort, import
 */
import type { Book, SortField } from "@readany/core/types";
import { getPlatformService } from "@readany/core/services";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  BookOpen,
  Clock,
  Loader2,
  Plus,
  Search,
  SortAsc,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLibraryStore } from "@/stores/library-store";
import { MobileBookCard } from "./MobileBookCard";
import { TagManageSheet } from "./TagManageSheet";

const SORT_OPTIONS: { field: SortField; labelKey: string }[] = [
  { field: "lastOpenedAt", labelKey: "library.sortRecent" },
  { field: "addedAt", labelKey: "library.sortAdded" },
  { field: "title", labelKey: "library.sortTitle" },
  { field: "author", labelKey: "library.sortAuthor" },
  { field: "progress", labelKey: "library.sortProgress" },
];

export function LibraryPage() {
  const { t } = useTranslation();
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
  } = useLibraryStore();

  const [showSearch, setShowSearch] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  const [tagSheetBook, setTagSheetBook] = useState<Book | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load books on mount
  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  // Focus search input when opened
  useEffect(() => {
    if (showSearch) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [showSearch]);

  // Filter & sort books
  const filteredBooks = useMemo(() => {
    let result = [...books];

    // Tag filter
    if (activeTag === "__uncategorized__") {
      result = result.filter((b) => b.tags.length === 0);
    } else if (activeTag) {
      result = result.filter((b) => b.tags.includes(activeTag));
    }

    // Search filter
    const search = filter.search.toLowerCase().trim();
    if (search) {
      result = result.filter(
        (b) =>
          b.meta.title.toLowerCase().includes(search) ||
          b.meta.author?.toLowerCase().includes(search) ||
          b.tags.some((tag) => tag.toLowerCase().includes(search)),
      );
    }

    // Sort
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
      const platform = getPlatformService();
      const result = await platform.pickFile({
        multiple: true,
        filters: [
          {
            name: "Books",
            extensions: ["epub", "pdf", "mobi", "azw", "azw3", "cbz", "fb2", "fbz"],
          },
        ],
      });
      if (result) {
        await importBooks(Array.isArray(result) ? result : [result]);
      }
    } catch (err) {
      console.error("Import failed:", err);
    }
  }, [importBooks]);

  const handleOpen = useCallback((_book: Book) => {
    // TODO: navigate to reader when Phase 2 is implemented
    console.log("[LibraryPage] Open book:", _book.id);
  }, []);

  const handleManageTags = useCallback((book: Book) => {
    setTagSheetBook(book);
    setTagSheetOpen(true);
  }, []);

  const handleSortChange = useCallback(
    (field: SortField) => {
      if (filter.sortField === field) {
        setFilter({ sortOrder: filter.sortOrder === "asc" ? "desc" : "asc" });
      } else {
        setFilter({ sortField: field, sortOrder: field === "title" || field === "author" ? "asc" : "desc" });
      }
      setShowSort(false);
    },
    [filter, setFilter],
  );

  const isEmpty = filteredBooks.length === 0;
  const hasBooks = books.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="shrink-0 bg-background px-4 pb-2 pt-3">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold">{t("sidebar.library")}</h1>
          <div className="flex items-center gap-1">
            {/* Search toggle */}
            {hasBooks && (
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:bg-muted transition-colors"
                onClick={() => {
                  setShowSearch(!showSearch);
                  if (showSearch) setFilter({ search: "" });
                }}
              >
                {showSearch ? <X className="h-4.5 w-4.5" /> : <Search className="h-4.5 w-4.5" />}
              </button>
            )}

            {/* Sort button */}
            {hasBooks && (
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:bg-muted transition-colors"
                onClick={() => setShowSort(!showSort)}
              >
                <SortAsc className="h-4.5 w-4.5" />
              </button>
            )}

            {/* Import button */}
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground active:scale-95 transition-transform"
              onClick={handleImport}
              disabled={isImporting}
            >
              {isImporting ? (
                <Loader2 className="h-4.5 w-4.5 animate-spin" />
              ) : (
                <Plus className="h-4.5 w-4.5" />
              )}
            </button>
          </div>
        </div>

        {/* Search bar — collapsible */}
        {showSearch && (
          <div className="relative mb-2 animate-in slide-in-from-top-2 duration-200">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder={t("library.searchPlaceholder")}
              value={filter.search}
              onChange={(e) => setFilter({ search: e.target.value })}
              className="h-9 w-full rounded-lg bg-muted pl-9 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {filter.search && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1"
                onClick={() => setFilter({ search: "" })}
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        )}

        {/* Tag horizontal scroll filter */}
        {hasBooks && allTags.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {/* All */}
            <button
              type="button"
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                !activeTag
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground active:bg-muted/80"
              }`}
              onClick={() => setActiveTag("")}
            >
              {t("library.all")}
            </button>

            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  activeTag === tag
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground active:bg-muted/80"
                }`}
                onClick={() => setActiveTag(activeTag === tag ? "" : tag)}
              >
                {tag}
              </button>
            ))}

            {/* Uncategorized */}
            <button
              type="button"
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeTag === "__uncategorized__"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground active:bg-muted/80"
              }`}
              onClick={() =>
                setActiveTag(activeTag === "__uncategorized__" ? "" : "__uncategorized__")
              }
            >
              {t("sidebar.uncategorized")}
            </button>
          </div>
        )}
      </header>

      {/* Sort dropdown */}
      {showSort && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowSort(false)} />
          <div className="absolute right-4 top-14 z-50 min-w-40 rounded-xl border bg-popover p-1 shadow-lg animate-in fade-in slide-in-from-top-2 duration-150">
            {SORT_OPTIONS.map(({ field, labelKey }) => (
              <button
                key={field}
                type="button"
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
                  filter.sortField === field ? "bg-muted font-medium" : "active:bg-muted"
                }`}
                onClick={() => handleSortChange(field)}
              >
                {field === "lastOpenedAt" ? (
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                ) : filter.sortField === field && filter.sortOrder === "asc" ? (
                  <ArrowUpAZ className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ArrowDownAZ className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span>{t(labelKey)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {/* Loading state */}
        {!isLoaded && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Importing banner */}
        {isImporting && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-xs text-primary">{t("library.importing")}</span>
          </div>
        )}

        {/* Empty state */}
        {isLoaded && books.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-muted">
              <BookOpen className="h-10 w-10 text-muted-foreground" />
            </div>
            <h2 className="mb-2 text-lg font-semibold">{t("library.empty")}</h2>
            <p className="mb-6 text-sm text-muted-foreground max-w-[240px]">
              {t("library.emptyHint")}
            </p>
            <button
              type="button"
              className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground active:scale-95 transition-transform"
              onClick={handleImport}
            >
              {t("library.importFirst")}
            </button>
          </div>
        )}

        {/* Filter empty state */}
        {isLoaded && hasBooks && isEmpty && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Search className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{t("library.noResults")}</p>
          </div>
        )}

        {/* Search results count */}
        {isLoaded && hasBooks && filter.search && !isEmpty && (
          <p className="mb-2 text-xs text-muted-foreground">
            {t("library.resultsCount", { count: filteredBooks.length })}
          </p>
        )}

        {/* Book grid — 3 columns */}
        {isLoaded && !isEmpty && (
          <div className="grid grid-cols-3 gap-x-3 gap-y-4">
            {filteredBooks.map((book) => (
              <MobileBookCard
                key={book.id}
                book={book}
                onOpen={handleOpen}
                onDelete={removeBook}
                onManageTags={handleManageTags}
              />
            ))}
          </div>
        )}
      </div>

      {/* Tag management sheet */}
      <TagManageSheet
        open={tagSheetOpen}
        onOpenChange={setTagSheetOpen}
        book={tagSheetBook}
        allTags={allTags}
        onAddTag={addTag}
        onAddTagToBook={addTagToBook}
        onRemoveTagFromBook={removeTagFromBook}
      />
    </div>
  );
}
