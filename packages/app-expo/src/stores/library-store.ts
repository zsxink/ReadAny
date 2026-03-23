import { extractBookMetadata } from "@/lib/book/metadata-extractor";
import * as db from "@readany/core/db/database";
import { getPlatformService } from "@readany/core/services";
/**
 * Expo Library Store — book collection CRUD, import, filtering, tags
 * Adapted from app-mobile library-store. Uses core DB + FS persistence.
 */
import type { Book, LibraryFilter, SortField, SortOrder } from "@readany/core/types";
import { generateId } from "@readany/core/utils";
import { create } from "zustand";
import { debouncedSave, loadFromFS } from "./persist";

// Hermes (React Native) only supports UTF-8 in TextDecoder.
// Use text-encoding polyfill for GBK/GB18030/Shift-JIS etc.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { TextDecoder: PolyfillTextDecoder } = require("text-encoding") as {
  TextDecoder: typeof TextDecoder;
};

export type LibraryViewMode = "grid" | "list";

export interface LibraryState {
  books: Book[];
  filter: LibraryFilter;
  viewMode: LibraryViewMode;
  isImporting: boolean;
  isLoaded: boolean;
  allTags: string[];
  activeTag: string;

  loadBooks: (deletedTags?: string[]) => Promise<void>;
  setBooks: (books: Book[]) => void;
  addBook: (book: Book) => Promise<void>;
  removeBook: (bookId: string) => Promise<void>;
  updateBook: (bookId: string, updates: Partial<Book>) => void;
  setFilter: (filter: Partial<LibraryFilter>) => void;
  setViewMode: (mode: LibraryViewMode) => void;
  setSortField: (field: SortField) => void;
  setSortOrder: (order: SortOrder) => void;
  importBooks: (files: Array<{ uri: string; name?: string }>) => Promise<void>;
  setActiveTag: (tag: string) => void;
  addTag: (tag: string) => void;
  removeTag: (tag: string) => void;
  renameTag: (oldName: string, newName: string) => void;
  addTagToBook: (bookId: string, tag: string) => void;
  removeTagFromBook: (bookId: string, tag: string) => void;
}

async function resolveAppPath(relativePath: string): Promise<string> {
  const platform = getPlatformService();
  const appData = await platform.getAppDataDir();
  return platform.joinPath(appData, relativePath);
}

async function ensureAppSubDir(subDir: string): Promise<void> {
  const platform = getPlatformService();
  const absDir = await resolveAppPath(subDir);
  try {
    await platform.mkdir(absDir);
  } catch {
    /* may exist */
  }
}

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
 * Ensure raw bytes are UTF-8 encoded. Hermes (React Native) only supports
 * UTF-8 in TextDecoder — GBK/GB18030/Shift-JIS etc. are NOT supported.
 * If the bytes are not UTF-8, use PolyfillTextDecoder to convert to UTF-8.
 */
function ensureUtf8Bytes(bytes: Uint8Array): Uint8Array {
  // Check BOM markers
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes; // UTF-8 with BOM
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    // UTF-16LE → decode via polyfill, re-encode as UTF-8
    const text = new PolyfillTextDecoder("utf-16le").decode(bytes);
    return new TextEncoder().encode(text);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    // UTF-16BE → decode via polyfill, re-encode as UTF-8
    const text = new PolyfillTextDecoder("utf-16be").decode(bytes);
    return new TextEncoder().encode(text);
  }

  // Try strict UTF-8 validation on a sample
  const sampleSize = Math.min(bytes.length, 64 * 1024);
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, sampleSize));
    // Also check a mid-section for large files
    if (bytes.length > sampleSize * 2) {
      const midStart = Math.floor(bytes.length / 2);
      const midEnd = Math.min(midStart + 8192, bytes.length);
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(midStart, midEnd));
    }
    return bytes; // Valid UTF-8
  } catch {
    // Not valid UTF-8 — detect which encoding it is
  }

  // Check if high bytes suggest GBK/GB18030 or Shift-JIS
  const sample = bytes.subarray(0, Math.min(1024, bytes.length));
  let highBytes = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i]! >= 0x80) highBytes++;
  }
  const highRatio = sample.length > 0 ? highBytes / sample.length : 0;

  // Check for Shift-JIS patterns
  let isShiftJIS = false;
  if (highRatio > 0.1) {
    for (let i = 0; i < sample.length - 1; i++) {
      const b1 = sample[i]!;
      const b2 = sample[i + 1]!;
      if (
        ((b1 >= 0x81 && b1 <= 0x9f) || (b1 >= 0xe0 && b1 <= 0xfc)) &&
        ((b2 >= 0x40 && b2 <= 0x7e) || (b2 >= 0x80 && b2 <= 0xfc))
      ) {
        isShiftJIS = true;
        break;
      }
    }
  }

  const encoding = isShiftJIS ? "shift_jis" : highRatio > 0.1 ? "gb18030" : "gbk";
  console.log(`[ensureUtf8Bytes] Detected non-UTF-8 encoding: ${encoding}, converting to UTF-8`);

  try {
    const text = new PolyfillTextDecoder(encoding).decode(bytes);
    return new TextEncoder().encode(text);
  } catch (err) {
    console.warn("[ensureUtf8Bytes] Polyfill decode failed, returning raw bytes:", err);
    return bytes;
  }
}

async function copyBookToAppData(
  bookId: string,
  ext: string,
  srcPath: string,
): Promise<{ relativePath: string; fileBytes: Uint8Array }> {
  const platform = getPlatformService();
  await ensureAppSubDir("books");
  const relativePath = `books/${bookId}.${ext}`;
  const absPath = await resolveAppPath(relativePath);

  const fileBytes = await platform.readFile(srcPath);
  await platform.writeFile(absPath, fileBytes);
  return { relativePath, fileBytes };
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

  loadBooks: async (deletedTags?: string[]) => {
    const computeTags = (books: Book[]) => {
      const tagSet = new Set<string>();
      for (const b of books) for (const t of b.tags) tagSet.add(t);
      return [...tagSet].sort();
    };

    try {
      const cached = await loadFromFS<Book[]>("library-books");
      if (cached && cached.length > 0) {
        set({ books: cached, isLoaded: true, allTags: computeTags(cached) });
      }
    } catch {
      /* cache miss */
    }

    try {
      await db.initDatabase();
      const books = await db.getBooks();
      const dbTags = computeTags(books);

      // Load saved tags from FS (may include empty tags not assigned to any book)
      let savedTags: string[] = [];
      try {
        const loaded = await loadFromFS<string[]>("library-tags");
        if (loaded) savedTags = loaded;
      } catch {
        /* no saved tags */
      }

      // Remove deleted tags from savedTags
      const deletedSet = new Set(deletedTags || []);
      savedTags = savedTags.filter((t) => !deletedSet.has(t));

      // Merge: dbTags (from books) + empty tags from FS (not in dbTags and not deleted)
      const dbTagSet = new Set(dbTags);
      const emptyTags = savedTags.filter((t) => !dbTagSet.has(t) && !deletedSet.has(t));
      const allTags = [...dbTags, ...emptyTags].sort();

      set({ books, isLoaded: true, allTags });
      debouncedSave("library-books", books);
      debouncedSave("library-tags", allTags);
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
      // Delete associated chat threads
      await db.deleteThreadsByBookId(bookId);
    } catch (err) {
      console.error("Failed to delete book from database:", err);
    }
    if (bookToRemove?.filePath) {
      try {
        const platform = getPlatformService();
        const absPath = await resolveAppPath(bookToRemove.filePath);
        await platform.deleteFile(absPath);
      } catch {
        /* file may not exist */
      }
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

  importBooks: async (files) => {
    set({ isImporting: true });
    try {
      for (const fileInfo of files) {
        try {
          const filePath = fileInfo.uri;
          // Use the original file name from DocumentPicker (not the cache UUID)
          const originalName = fileInfo.name
            ? decodeURIComponent(fileInfo.name)
            : decodeURIComponent(filePath.split("/").pop() || "book");
          const ext = originalName.split(".").pop()?.toLowerCase();
          const formatMap: Record<string, Book["format"]> = {
            epub: "epub",
            pdf: "pdf",
            mobi: "mobi",
            azw: "azw",
            azw3: "azw3",
            cbz: "cbz",
            cbr: "cbz",
            fb2: "fb2",
            fbz: "fbz",
            txt: "txt",
          };
          const format: Book["format"] = formatMap[ext || ""] || "epub";
          const fileName = originalName;
          const bookId = generateId();

          console.log(
            `[importBooks] Importing: name=${fileName}, format=${format}, uri=${filePath}`,
          );

          // For TXT files: convert to EPUB bytes directly, skip Blob/File (slow in RN)
          if (ext === "txt") {
            try {
              const { TxtToEpubConverter } = await import("@readany/core/utils/txt-to-epub");
              const platform = getPlatformService();

              // Read TXT file as bytes
              const rawBytes = await platform.readFile(filePath);

              // Hermes only supports UTF-8 in TextDecoder. Convert GBK/GB18030
              // etc. to UTF-8 using iconv-lite before passing to the converter.
              const bytes = ensureUtf8Bytes(rawBytes);

              // React Native Blob/File constructor doesn't support ArrayBuffer/Uint8Array.
              // Create a File-like shim that provides the methods TxtToEpubConverter needs.
              const txtFile = {
                name: fileName,
                size: bytes.byteLength,
                type: "text/plain",
                arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
                slice: (start?: number, end?: number) => {
                  const sliced = bytes.slice(start ?? 0, end ?? bytes.byteLength);
                  return {
                    arrayBuffer: () => Promise.resolve(sliced.buffer.slice(sliced.byteOffset, sliced.byteOffset + sliced.byteLength)),
                    size: sliced.byteLength,
                  };
                },
                stream: () => new ReadableStream({
                  start(controller) {
                    controller.enqueue(bytes);
                    controller.close();
                  },
                }),
              } as unknown as File;

              // Use convertToBytes: pure-JS ZIP builder, no Blob bridge
              const converter = new TxtToEpubConverter();
              const result = await converter.convertToBytes({ file: txtFile });

              // Write EPUB bytes directly to final app data location
              await ensureAppSubDir("books");
              const relativePath = `books/${bookId}.epub`;
              const absPath = await resolveAppPath(relativePath);
              await platform.writeFile(absPath, result.epubBytes);

              // TXT-converted EPUBs have no cover, and title is already known from converter.
              // Skip metadata extraction entirely — saves a full EPUB re-parse.
              const title = result.bookTitle || fileName.replace(/\.\w+$/i, "") || "Untitled";
              const book: Book = {
                id: bookId,
                filePath: relativePath,
                format: "epub",
                meta: { title, author: "" },
                progress: 0,
                isVectorized: false,
                vectorizeProgress: 0,
                tags: [],
                addedAt: Date.now(),
                updatedAt: Date.now(),
                lastOpenedAt: Date.now(),
              };
              await get().addBook(book);
              console.log(`[importBooks] TXT imported as EPUB: ${title}`);
              continue;
            } catch (convErr) {
              console.error(`[importBooks] TXT conversion failed:`, convErr);
              throw convErr;
            }
          }

          const { relativePath, fileBytes } = await copyBookToAppData(
            bookId,
            ext || "epub",
            filePath,
          );
          console.log(
            `[importBooks] File copied. Bytes length: ${fileBytes.length}, relativePath: ${relativePath}`,
          );

          // Extract metadata (title, author, cover) from book content
          let title = fileName.replace(/\.\w+$/i, "") || "Untitled";
          let author = "";
          let coverUrl: string | undefined;

          try {
            console.log(`[importBooks] Extracting metadata for format=${format}...`);
            const meta = await extractBookMetadata(fileBytes, format, fileName);
            console.log(
              `[importBooks] Metadata result: title="${meta.title}", author="${meta.author}", hasCover=${!!meta.coverBytes}, coverSize=${meta.coverBytes?.length ?? 0}`,
            );
            if (meta.title) title = meta.title;
            if (meta.author) author = meta.author;

            // Save cover image to app data
            if (meta.coverBytes && meta.coverBytes.length > 0) {
              try {
                const mimeType = meta.coverMimeType || "image/jpeg";
                const coverExt = mimeType.includes("png") ? "png" : "jpg";
                await ensureAppSubDir("covers");
                const coverRelPath = `covers/${bookId}.${coverExt}`;
                const coverAbsPath = await resolveAppPath(coverRelPath);
                console.log(`[importBooks] Saving cover to: ${coverAbsPath}`);
                const platform = getPlatformService();
                await platform.writeFile(coverAbsPath, meta.coverBytes);
                coverUrl = coverRelPath;
                console.log(`[importBooks] Cover saved. coverUrl=${coverUrl}`);
              } catch (coverErr) {
                console.warn(`[importBooks] Failed to save cover for ${fileName}:`, coverErr);
              }
            }
          } catch (metaErr) {
            console.warn(`[importBooks] Metadata extraction failed for ${fileName}:`, metaErr);
          }

          console.log(
            `[importBooks] Final book: title="${title}", author="${author}", coverUrl="${coverUrl}"`,
          );
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
          console.error(`Failed to import ${fileInfo.uri}:`, err);
        }
      }
    } finally {
      set({ isImporting: false });
    }
  },

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
