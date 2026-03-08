/**
 * Mobile Library Store — book collection CRUD, import, filtering, tags
 * Adapted from desktop library-store. Uses core DB + FS persistence.
 * DocumentLoader is imported from the local mobile reader module.
 */
import type { Book, LibraryFilter, SortField, SortOrder } from "@readany/core/types";
import * as db from "@readany/core/db/database";
import { create } from "zustand";
import { debouncedSave, loadFromFS } from "@readany/core/stores/persist";
import { getPlatformService } from "@readany/core/services";

export type LibraryViewMode = "grid" | "list";

export interface LibraryState {
  books: Book[];
  filter: LibraryFilter;
  viewMode: LibraryViewMode;
  isImporting: boolean;
  isLoaded: boolean;
  allTags: string[];
  activeTag: string;

  loadBooks: () => Promise<void>;
  setBooks: (books: Book[]) => void;
  addBook: (book: Book) => Promise<void>;
  removeBook: (bookId: string) => Promise<void>;
  updateBook: (bookId: string, updates: Partial<Book>) => void;
  setFilter: (filter: Partial<LibraryFilter>) => void;
  setViewMode: (mode: LibraryViewMode) => void;
  setSortField: (field: SortField) => void;
  setSortOrder: (order: SortOrder) => void;
  importBooks: (filePaths: string[]) => Promise<void>;
  setActiveTag: (tag: string) => void;
  addTag: (tag: string) => void;
  removeTag: (tag: string) => void;
  renameTag: (oldName: string, newName: string) => void;
  addTagToBook: (bookId: string, tag: string) => void;
  removeTagFromBook: (bookId: string, tag: string) => void;
}

/**
 * Resolve a relative path (e.g. "books/xxx.epub") to an absolute path under appDataDir.
 * On iOS the absolute appDataDir path changes every reinstall, so we must NEVER persist it.
 */
async function resolveAppPath(relativePath: string): Promise<string> {
  const platform = getPlatformService();
  const appData = await platform.getAppDataDir();
  return platform.joinPath(appData, relativePath);
}

/** Ensure a directory exists under appDataDir */
async function ensureAppSubDir(subDir: string): Promise<void> {
  const platform = getPlatformService();
  const absDir = await resolveAppPath(subDir);
  try { await platform.mkdir(absDir); } catch { /* may exist */ }
}

/**
 * Save cover image to appData. Returns a RELATIVE path (e.g. "covers/{bookId}.jpg").
 * The caller must resolve to absolute path when needed for display.
 */
async function saveCoverToAppData(bookId: string, coverBlob: Blob): Promise<string> {
  const platform = getPlatformService();
  await ensureAppSubDir("covers");

  const ext = coverBlob.type.includes("png") ? "png" : "jpg";
  const relativePath = `covers/${bookId}.${ext}`;
  const absPath = await resolveAppPath(relativePath);
  const arrayBuffer = await coverBlob.arrayBuffer();
  await platform.writeFile(absPath, new Uint8Array(arrayBuffer));

  return relativePath;
}

/**
 * Copy book file into appDataDir/books/ so it persists across app restarts.
 * Returns a RELATIVE path (e.g. "books/{bookId}.epub") — never store absolute paths!
 *
 * On iOS, file-picker paths are temporary and lose access after restart.
 * Also, appDataDir absolute path changes between reinstalls.
 *
 * Strategy (following readest):
 *   1. Try Tauri native `copyFile` first — fastest, avoids JS memory issues.
 *   2. If that fails (e.g. iOS security-scoped resource), fallback to readFile → writeFile.
 */
async function copyBookToAppData(
  bookId: string,
  ext: string,
  srcPath: string,
): Promise<{ relativePath: string; fileBytes: Uint8Array }> {
  const platform = getPlatformService();
  await ensureAppSubDir("books");

  const relativePath = `books/${bookId}.${ext}`;
  const absPath = await resolveAppPath(relativePath);

  let fileBytes: Uint8Array;
  try {
    const { copyFile } = await import("@tauri-apps/plugin-fs");
    console.log("[copyBookToAppData] Trying native copyFile:", srcPath, "→", absPath);
    await copyFile(srcPath, absPath);
    console.log("[copyBookToAppData] Native copy succeeded");
    fileBytes = await platform.readFile(absPath);
  } catch (err) {
    console.warn("[copyBookToAppData] Native copyFile failed:", err, "— falling back");
    fileBytes = await platform.readFile(srcPath);
    await platform.writeFile(absPath, fileBytes);
    console.log("[copyBookToAppData] Fallback succeeded, wrote", fileBytes.length, "bytes");
  }

  return { relativePath, fileBytes };
}

/** Generate PDF cover by rendering the first page to canvas */
async function generatePdfCover(fileBytes: Uint8Array): Promise<Blob | null> {
  try {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

    const pdfDoc = await pdfjsLib.getDocument({
      data: new Uint8Array(fileBytes),
      useWorkerFetch: false,
      isEvalSupported: false,
    }).promise;
    const page = await pdfDoc.getPage(1);

    const viewport = page.getViewport({ scale: 1 });
    const targetWidth = 400;
    const scale = targetWidth / viewport.width;
    const scaledViewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(scaledViewport.width);
    canvas.height = Math.floor(scaledViewport.height);

    await page.render({ canvas, viewport: scaledViewport }).promise;

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85);
    });
    pdfDoc.destroy();
    return blob;
  } catch (err) {
    console.warn("Failed to generate PDF cover:", err);
    return null;
  }
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  books: [],
  filter: {
    search: "",
    tags: [],
    sortField: "lastOpenedAt",
    sortOrder: "desc",
  },
  viewMode: "grid",
  isImporting: false,
  isLoaded: false,
  allTags: [],
  activeTag: "",

  loadBooks: async () => {
    const computeTags = (books: Book[]) => {
      const tagSet = new Set<string>();
      for (const b of books) for (const t of b.tags) tagSet.add(t);
      return [...tagSet].sort();
    };

    // 1) Fast path: restore from FS cache
    try {
      const cached = await loadFromFS<Book[]>("library-books");
      if (cached && cached.length > 0) {
        set({ books: cached, isLoaded: true, allTags: computeTags(cached) });
      }
    } catch {
      // cache miss
    }

    // Restore saved tags
    try {
      const savedTags = await loadFromFS<string[]>("library-tags");
      if (savedTags && savedTags.length > 0) {
        set((state) => {
          const merged = new Set([...state.allTags, ...savedTags]);
          return { allTags: [...merged].sort() };
        });
      }
    } catch { /* no saved tags */ }

    // 2) Full path: load from SQLite (source of truth)
    try {
      await db.initDatabase();
      const books = await db.getBooks();
      const allTags = computeTags(books);
      const savedTags = get().allTags;
      const merged = new Set([...allTags, ...savedTags]);
      set({ books, isLoaded: true, allTags: [...merged].sort() });
      debouncedSave("library-books", books);
    } catch (err) {
      console.error("Failed to load books from database:", err);
      set({ isLoaded: true });
    }
  },

  setBooks: (books) => set({ books }),

  addBook: async (book) => {
    set((state) => ({ books: [...state.books, book] }));
    try {
      await db.initDatabase();
      await db.insertBook(book);
    } catch (err) {
      console.error("Failed to insert book into database:", err);
    }
    debouncedSave("library-books", get().books);
  },

  removeBook: async (bookId) => {
    const bookToRemove = get().books.find((b) => b.id === bookId);
    set((state) => ({ books: state.books.filter((b) => b.id !== bookId) }));
    try {
      await db.initDatabase();
      await db.deleteBook(bookId);
    } catch (err) {
      console.error("Failed to delete book from database:", err);
    }
    // Clean up the copied book file from appDataDir
    if (bookToRemove?.filePath) {
      try {
        const { remove } = await import("@tauri-apps/plugin-fs");
        const absPath = await resolveAppPath(bookToRemove.filePath);
        await remove(absPath);
      } catch { /* file may not exist */ }
    }
    debouncedSave("library-books", get().books);
  },

  updateBook: (bookId, updates) => {
    set((state) => ({
      books: state.books.map((b) => (b.id === bookId ? { ...b, ...updates } : b)),
    }));
    db.updateBook(bookId, updates).catch((err) =>
      console.error("Failed to update book in database:", err),
    );
    debouncedSave("library-books", get().books);
  },

  setFilter: (filter) => set((state) => ({ filter: { ...state.filter, ...filter } })),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSortField: (field) => set((state) => ({ filter: { ...state.filter, sortField: field } })),
  setSortOrder: (order) => set((state) => ({ filter: { ...state.filter, sortOrder: order } })),

  importBooks: async (filePaths) => {
    set({ isImporting: true });
    try {
      const { DocumentLoader } = await import("@/lib/reader/document-loader");

      for (const filePath of filePaths) {
        try {
          const ext = filePath.split(".").pop()?.toLowerCase();
          const formatMap: Record<string, Book["format"]> = {
            epub: "epub", pdf: "pdf", mobi: "mobi", azw: "azw", azw3: "azw3",
            cbz: "cbz", cbr: "cbz", fb2: "fb2", fbz: "fbz",
          };
          const format: Book["format"] = formatMap[ext || ""] || "epub";
          let title = filePath.split("/").pop()?.replace(/\.\w+$/i, "") || "Untitled";
          let author = "";
          let coverUrl: string | undefined;
          const bookId = crypto.randomUUID();

          // Copy file into app sandbox first — this must happen while
          // the temporary file-picker permission is still active
          const { relativePath, fileBytes } = await copyBookToAppData(bookId, ext || "epub", filePath);

          const fileName = filePath.split("/").pop() || "book";
          const blob = new Blob([fileBytes]);
          const file = new File([blob], fileName, { type: blob.type || "application/octet-stream" });

          try {
            const loader = new DocumentLoader(file);
            const { book: bookDoc } = await loader.open();

            const meta = bookDoc.metadata;
            if (meta) {
              const rawTitle = typeof meta.title === "string"
                ? meta.title
                : meta.title ? Object.values(meta.title)[0] : "";
              if (rawTitle) title = rawTitle;

              const rawAuthor = typeof meta.author === "string"
                ? meta.author
                : meta.author?.name || "";
              if (rawAuthor) author = rawAuthor;
            }

            try {
              const coverBlob = await bookDoc.getCover();
              if (coverBlob) {
                coverUrl = await saveCoverToAppData(bookId, coverBlob);
              }
            } catch (err) {
              console.warn("[importBooks] getCover failed:", err);
            }
          } catch (err) {
            console.warn("[importBooks] DocumentLoader failed, falling back:", err);
            if (format === "pdf") {
              try {
                const coverBlob = await generatePdfCover(fileBytes);
                if (coverBlob) {
                  coverUrl = await saveCoverToAppData(bookId, coverBlob);
                }
              } catch {
                // Cover generation failed
              }
            }
          }

          const book: Book = {
            id: bookId,
            filePath: relativePath,
            format,
            meta: { title, author, coverUrl },
            progress: 0,
            isVectorized: false,
            vectorizeProgress: 0,
            tags: [],
            addedAt: Date.now(),
            updatedAt: Date.now(),
            lastOpenedAt: Date.now(),
          };
          await get().addBook(book);
        } catch (err) {
          console.error(`Failed to import ${filePath}:`, err);
        }
      }
    } finally {
      set({ isImporting: false });
    }
  },

  // ── Tag management ──

  setActiveTag: (tag) => set({ activeTag: tag }),

  addTag: (tag) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    set((state) => {
      if (state.allTags.includes(trimmed)) return state;
      const allTags = [...state.allTags, trimmed].sort();
      debouncedSave("library-tags", allTags);
      return { allTags };
    });
  },

  removeTag: (tag) => {
    set((state) => {
      const allTags = state.allTags.filter((t) => t !== tag);
      const books = state.books.map((b) =>
        b.tags.includes(tag) ? { ...b, tags: b.tags.filter((t) => t !== tag) } : b,
      );
      debouncedSave("library-tags", allTags);
      debouncedSave("library-books", books);
      return { allTags, books, activeTag: state.activeTag === tag ? "" : state.activeTag };
    });
    const books = get().books;
    for (const b of books) {
      db.updateBook(b.id, { tags: b.tags }).catch(() => {});
    }
  },

  renameTag: (oldName, newName) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    set((state) => {
      const allTags = state.allTags.map((t) => (t === oldName ? trimmed : t)).sort();
      const books = state.books.map((b) =>
        b.tags.includes(oldName)
          ? { ...b, tags: b.tags.map((t) => (t === oldName ? trimmed : t)) }
          : b,
      );
      debouncedSave("library-tags", allTags);
      debouncedSave("library-books", books);
      return { allTags, books, activeTag: state.activeTag === oldName ? trimmed : state.activeTag };
    });
    for (const b of get().books) {
      if (b.tags.includes(trimmed)) {
        db.updateBook(b.id, { tags: b.tags }).catch(() => {});
      }
    }
  },

  addTagToBook: (bookId, tag) => {
    set((state) => {
      const books = state.books.map((b) =>
        b.id === bookId && !b.tags.includes(tag) ? { ...b, tags: [...b.tags, tag] } : b,
      );
      const allTags = state.allTags.includes(tag) ? state.allTags : [...state.allTags, tag].sort();
      debouncedSave("library-books", books);
      debouncedSave("library-tags", allTags);
      return { books, allTags };
    });
    const book = get().books.find((b) => b.id === bookId);
    if (book) db.updateBook(bookId, { tags: book.tags }).catch(() => {});
  },

  removeTagFromBook: (bookId, tag) => {
    set((state) => {
      const books = state.books.map((b) =>
        b.id === bookId ? { ...b, tags: b.tags.filter((t) => t !== tag) } : b,
      );
      debouncedSave("library-books", books);
      return { books };
    });
    const book = get().books.find((b) => b.id === bookId);
    if (book) db.updateBook(bookId, { tags: book.tags }).catch(() => {});
  },
}));
