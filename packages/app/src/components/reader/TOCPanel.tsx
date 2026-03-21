import { useAnnotationStore } from "@/stores/annotation-store";
import { useReaderStore } from "@/stores/reader-store";
import type { Bookmark } from "@readany/core/types";
import {
  BookOpen,
  Bookmark as BookmarkIcon,
  ChevronDown,
  ChevronRight,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TOCItem } from "./FoliateViewer";

type PanelTab = "toc" | "bookmarks";

interface TOCPanelProps {
  tocItems: TOCItem[];
  onGoToChapter: (index: number) => void;
  onGoToCfi?: (cfi: string) => void;
  onClose: () => void;
  tabId: string;
  bookId: string;
}

interface TOCItemRowProps {
  item: TOCItem;
  currentChapterIndex: number;
  onGoToChapter: (index: number) => void;
  idx: number;
}

function TOCItemRow({ item, currentChapterIndex, onGoToChapter, idx }: TOCItemRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = item.subitems && item.subitems.length > 0;
  const isCurrent = (item.index ?? idx) === currentChapterIndex;

  return (
    <div>
      <button
        type="button"
        data-active={isCurrent || undefined}
        className={`group flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-[13px] leading-snug transition-all ${
          isCurrent
            ? "bg-primary/8 font-medium text-primary shadow-sm ring-1 ring-primary/15"
            : "text-foreground/70 hover:bg-muted/80 hover:text-foreground"
        }`}
        style={{ paddingLeft: `${item.level * 20 + 10}px` }}
        onClick={() => onGoToChapter(item.index ?? idx)}
      >
        {hasChildren && (
          <span
            className="mr-0.5 shrink-0 cursor-pointer rounded-md p-0.5 transition-colors hover:bg-muted-foreground/10"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </span>
        )}
        {isCurrent && !hasChildren && (
          <span className="mr-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
        )}
        <span className="truncate">{item.title}</span>
      </button>

      {hasChildren &&
        expanded &&
        item.subitems?.map((child, childIdx) => (
          <TOCItemRow
            key={child.id}
            item={child}
            currentChapterIndex={currentChapterIndex}
            onGoToChapter={onGoToChapter}
            idx={childIdx}
          />
        ))}
    </div>
  );
}

function BookmarkItem({
  bookmark,
  onClick,
  onDelete,
}: {
  bookmark: Bookmark;
  onClick: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const dateStr = new Date(bookmark.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <button
      type="button"
      className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] leading-snug transition-all text-foreground/70 hover:bg-muted/80 hover:text-foreground"
      onClick={onClick}
    >
      <BookmarkIcon className="h-3.5 w-3.5 shrink-0 text-primary fill-primary" />
      <div className="flex-1 min-w-0">
        <span className="block truncate">{bookmark.chapterTitle || t("common.unnamed")}</span>
        {bookmark.label && (
          <span className="block truncate text-xs text-muted-foreground/70 mt-0.5">
            {bookmark.label}
          </span>
        )}
        <span className="block text-xs text-muted-foreground/50 mt-0.5">{dateStr}</span>
      </div>
      <span
        className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title={t("bookmarks.remove")}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

export function TOCPanel({
  tocItems,
  onGoToChapter,
  onGoToCfi,
  onClose,
  tabId,
  bookId,
}: TOCPanelProps) {
  const { t } = useTranslation();
  const tab = useReaderStore((s) => s.tabs[tabId]);
  const currentChapterIndex = tab?.chapterIndex ?? 0;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<PanelTab>("toc");

  const bookmarks = useAnnotationStore((s) => s.bookmarks);
  const removeBookmark = useAnnotationStore((s) => s.removeBookmark);
  const bookBookmarks = bookmarks.filter((b) => b.bookId === bookId);

  // Scroll to current chapter on open
  useEffect(() => {
    if (activeTab !== "toc") return;
    const el = scrollRef.current;
    if (!el) return;
    const active = el.querySelector("[data-active='true']");
    active?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentChapterIndex, activeTab]);

  const handleGoTo = useCallback(
    (index: number) => {
      onGoToChapter(index);
    },
    [onGoToChapter],
  );

  return (
    <div className="flex h-full w-72 flex-col overflow-hidden rounded-r-xl bg-background/95 shadow-2xl backdrop-blur-sm border border-l-0 border-border/50">
      {/* Header with close button */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/50 px-4 rounded-tr-xl">
        {/* Tab switcher */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium transition-colors ${
              activeTab === "toc"
                ? "text-primary bg-primary/8"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
            onClick={() => setActiveTab("toc")}
          >
            <BookOpen className="h-3.5 w-3.5" />
            {t("reader.toc")}
          </button>
          <button
            type="button"
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium transition-colors ${
              activeTab === "bookmarks"
                ? "text-primary bg-primary/8"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
            onClick={() => setActiveTab("bookmarks")}
          >
            <BookmarkIcon className="h-3.5 w-3.5" />
            {t("bookmarks.title")}
            {bookBookmarks.length > 0 && (
              <span className="text-xs text-muted-foreground">({bookBookmarks.length})</span>
            )}
          </button>
        </div>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      {activeTab === "toc" ? (
        tocItems.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-xs text-muted-foreground">{t("reader.noToc")}</p>
          </div>
        ) : (
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
            {tocItems.map((item, idx) => (
              <TOCItemRow
                key={item.id}
                item={item}
                currentChapterIndex={currentChapterIndex}
                onGoToChapter={handleGoTo}
                idx={idx}
              />
            ))}
          </div>
        )
      ) : bookBookmarks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6">
          <BookmarkIcon className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-xs text-muted-foreground">{t("bookmarks.empty")}</p>
          <p className="text-xs text-muted-foreground/60 text-center">{t("bookmarks.emptyHint")}</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
          {bookBookmarks.map((bm) => (
            <BookmarkItem
              key={bm.id}
              bookmark={bm}
              onClick={() => onGoToCfi?.(bm.cfi)}
              onDelete={() => removeBookmark(bm.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
