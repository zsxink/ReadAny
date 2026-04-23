import { useAppStore } from "@/stores/app-store";
import { useLibraryStore } from "@/stores/library-store";
import { getBook } from "@readany/core/db/database";
import { getPlatformService } from "@readany/core/services";
import { setBookSyncStatus } from "@readany/core/db/database";
import { downloadBookFile } from "@readany/core/sync";
import { createSyncBackend } from "@readany/core/sync/sync-backend-factory";
import { useSyncStore } from "@readany/core/stores/sync-store";
import type { Book } from "@readany/core/types";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { useMissingBookPromptStore } from "@/stores/missing-book-prompt-store";

interface OpenDesktopBookOptions {
  book: Book;
  t: TFunction;
  initialCfi?: string;
}

const pendingDownloads = new Set<string>();
const BOOK_IMPORT_FILTERS = [
  {
    name: "Books",
    extensions: ["epub", "pdf", "mobi", "azw", "azw3", "cbz", "fb2", "fbz", "txt"],
  },
];

function isLikelyRelativeDesktopPath(path: string): boolean {
  if (!path) return false;
  return !/^(\/|file:\/\/|asset:\/\/|https?:\/\/|[A-Za-z]:[\\/])/i.test(path);
}

function openReaderTab(book: Book, initialCfi?: string) {
  const { addTab, setActiveTab } = useAppStore.getState();
  const tabId = `reader-${book.id}`;
  addTab({
    id: tabId,
    type: "reader",
    title: book.meta.title,
    bookId: book.id,
    initialCfi,
  });
  setActiveTab(tabId);
}

export async function openDesktopBook({
  book,
  t,
  initialCfi,
}: OpenDesktopBookOptions): Promise<boolean> {
  const { books, setBooks, loadBooks, importBooks } = useLibraryStore.getState();

  if (pendingDownloads.has(book.id) || book.syncStatus === "downloading") {
    return false;
  }

  if (book.syncStatus === "remote") {
    const syncStore = useSyncStore.getState();
    if (!syncStore.config) {
      toast.error(t("settings.syncNotConfigured"));
      return false;
    }

    const platform = getPlatformService();
    const secretKey =
      syncStore.config.type === "webdav" ? "sync_webdav_password" : "sync_s3_secret_key";
    const password = await platform.kvGetItem(secretKey);
    if (!password) {
      toast.error(t("library.passwordNotFound", "未找到同步密码，请重新配置"));
      return false;
    }

    pendingDownloads.add(book.id);
    setBooks(
      books.map((item) => (item.id === book.id ? { ...item, syncStatus: "downloading" } : item)),
    );
    await setBookSyncStatus(book.id, "downloading");

    try {
      const backend = createSyncBackend(syncStore.config, password);
      const success = await downloadBookFile(backend, book.id, book.filePath);
      await loadBooks();

      if (!success) {
        toast.error(t("library.downloadFailed", "下载失败，请重试"));
        return false;
      }
    } catch (error) {
      console.error("[openDesktopBook] Failed to download remote book:", error);
      await setBookSyncStatus(book.id, "remote");
      await loadBooks();
      toast.error(t("library.downloadFailed", "下载失败，请重试"));
      return false;
    } finally {
      pendingDownloads.delete(book.id);
    }
  }

  if (book.filePath) {
    const platform = getPlatformService();
    const targetPath = isLikelyRelativeDesktopPath(book.filePath)
      ? await platform.joinPath(await platform.getAppDataDir(), book.filePath)
      : book.filePath;

    const fileExists = await platform.exists(targetPath).catch(() => false);
    if (!fileExists) {
      const shouldReimport = await useMissingBookPromptStore.getState().showPrompt({
        title: t("reader.reimportPromptTitle", "本地文件已移除"),
        description: t(
          "reader.reimportDialogDescriptionDesktop",
          "重新选择这本书的文件后，就能继续阅读，并接回原来的笔记和阅读记录。",
        ),
        confirmLabel: t("reader.reimportSelectFile", "重新选择文件"),
        cancelLabel: t("common.cancel", "取消"),
      });
      if (!shouldReimport) {
        return false;
      }

      const picked = await platform.pickFile({
        multiple: false,
        filters: BOOK_IMPORT_FILTERS,
      });
      const selectedPath = Array.isArray(picked) ? picked[0] : picked;
      if (!selectedPath) {
        return false;
      }

      const summary = await importBooks([selectedPath]);
      const restoredBook =
        summary.imported.find((item) => item.id === book.id) ??
        summary.skippedDuplicates.find((item) => item.existingBook.id === book.id)?.existingBook ??
        null;

      if (!restoredBook) {
        toast.error(
          t(
            "reader.reimportDifferentBook",
            "导入的不是同一本书，没法接上原来的笔记和统计。",
          ),
        );
        return false;
      }

      const latestBook =
        useLibraryStore.getState().books.find((item) => item.id === book.id) ??
        (await getBook(book.id, { includeDeleted: true }).catch(() => null)) ??
        restoredBook;

      openReaderTab(latestBook, initialCfi);
      return true;
    }
  }

  openReaderTab(book, initialCfi);
  return true;
}
