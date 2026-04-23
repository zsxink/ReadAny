import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore } from "@/stores/library-store";
import { getBook } from "@readany/core/db/database";
import { getPlatformService } from "@readany/core/services";
import type { Book } from "@readany/core/types";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Alert } from "react-native";
import type { TFunction } from "i18next";
import { useMissingBookPromptStore } from "@/stores/missing-book-prompt-store";

type MobileNavigation = NativeStackNavigationProp<RootStackParamList>;

const BOOK_IMPORT_FILTERS = [
  {
    name: "Books",
    extensions: ["epub", "pdf", "mobi", "azw", "azw3", "cbz", "fb2", "fbz", "txt"],
  },
];

function isLikelyRelativeAppPath(path: string): boolean {
  if (!path) return false;
  return !/^(\/|file:\/\/|content:\/\/|ph:\/\/|asset:\/\/|https?:\/\/)/i.test(path);
}

async function resolveBookForOpen(bookId: string): Promise<Book | null> {
  const liveBook = useLibraryStore.getState().books.find((item) => item.id === bookId);
  if (liveBook) return liveBook;
  return getBook(bookId, { includeDeleted: true }).catch(() => null);
}

async function hasAccessibleLocalFile(book: Book): Promise<boolean> {
  if (!book.filePath) return false;
  if (book.syncStatus === "remote") return true;

  const platform = getPlatformService();
  const targetPath = isLikelyRelativeAppPath(book.filePath)
    ? await platform.joinPath(await platform.getAppDataDir(), book.filePath)
    : book.filePath;

  try {
    return await platform.exists(targetPath);
  } catch {
    return false;
  }
}

export async function openMobileBook({
  bookId,
  navigation,
  t,
  cfi,
  highlight,
}: {
  bookId: string;
  navigation: MobileNavigation;
  t: TFunction;
  cfi?: string;
  highlight?: boolean;
}): Promise<boolean> {
  const book = await resolveBookForOpen(bookId);
  if (!book) {
    Alert.alert(
      t("reader.bookNotFound", "书籍未找到"),
      t("reader.reimportMissingPrompt", "这本书的本地文件已经不在了，要不要现在重新导入？"),
      [{ text: t("common.ok", "确定") }],
    );
    return false;
  }

  if (book.syncStatus === "remote") {
    navigation.navigate("Reader", { bookId, cfi, highlight });
    return true;
  }

  if (await hasAccessibleLocalFile(book)) {
    navigation.navigate("Reader", { bookId, cfi, highlight });
    return true;
  }

  const shouldReimport = await useMissingBookPromptStore.getState().showPrompt({
    title: t("reader.reimportPromptTitle", "本地文件已移除"),
    description: t(
      "reader.reimportDialogDescription",
      "重新选择这本书的文件后，就能继续阅读，并接回原来的笔记和阅读记录。",
    ),
    confirmLabel: t("reader.reimportSelectFile", "重新选择文件"),
    cancelLabel: t("common.cancel", "取消"),
  });

  if (!shouldReimport) {
    return false;
  }

  try {
    const platform = getPlatformService();
    const picked = await platform.pickFile({
      multiple: false,
      filters: BOOK_IMPORT_FILTERS,
    });
    const selectedUri = Array.isArray(picked) ? picked[0] : picked;
    if (!selectedUri) return false;

    const summary = await useLibraryStore.getState().importBooks([{ uri: selectedUri }]);
    const restoredBook =
      summary.imported.find((item) => item.id === bookId) ??
      summary.skippedDuplicates.find((item) => item.existingBook.id === bookId)?.existingBook ??
      null;

    if (!restoredBook) {
      Alert.alert(
        t("reader.reimport", "重新导入"),
        t(
          "reader.reimportDifferentBook",
          "导入的不是同一本书，没法接上原来的笔记和统计。",
        ),
      );
      return false;
    }

    navigation.navigate("Reader", { bookId, cfi, highlight });
    return true;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : t("reader.reimportFailed", "重新导入失败，请稍后再试。");
    Alert.alert(t("reader.reimport", "重新导入"), message);
  }

  return false;
}
