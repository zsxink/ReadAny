/**
 * MobileBookCard — Touch-optimized book card with cover, progress, tags, long-press menu
 */
import type { Book } from "@readany/core/types";
import { Database, Hash, Loader2, Trash2 } from "lucide-react";
import { memo, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface MobileBookCardProps {
  book: Book;
  onOpen: (book: Book) => void;
  onDelete: (bookId: string) => void;
  onManageTags: (book: Book) => void;
  onVectorize?: (book: Book) => void;
  isVectorizing?: boolean;
  vectorProgress?: { status: string; processedChunks: number; totalChunks: number } | null;
}

export const MobileBookCard = memo(function MobileBookCard({
  book,
  onOpen,
  onDelete,
  onManageTags,
  onVectorize,
  isVectorizing,
  vectorProgress,
}: MobileBookCardProps) {
  const { t } = useTranslation();
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchMoved = useRef(false);

  const progressPct = Math.round(book.progress * 100);
  const hasCover = book.meta.coverUrl && !imageError;

  const vecPct = vectorProgress
    ? vectorProgress.totalChunks > 0
      ? Math.round((vectorProgress.processedChunks / vectorProgress.totalChunks) * 100)
      : 0
    : 0;

  const handleTouchStart = useCallback(() => {
    touchMoved.current = false;
    longPressTimer.current = setTimeout(() => {
      setShowActions(true);
    }, 500);
  }, []);

  const handleTouchMove = useCallback(() => {
    touchMoved.current = true;
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (!touchMoved.current && !showActions) {
      onOpen(book);
    }
  }, [book, onOpen, showActions]);

  return (
    <>
      <div
        className="relative flex flex-col"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onContextMenu={(e) => { e.preventDefault(); setShowActions(true); }}
      >
        {/* Cover — 28:41 aspect ratio */}
        <div className="book-cover-shadow relative flex aspect-[28/41] w-full items-end justify-center overflow-hidden rounded">
          {/* Cover image */}
          {book.meta.coverUrl && (
            <img
              src={book.meta.coverUrl}
              alt={book.meta.title}
              className={`absolute inset-0 h-full w-full rounded object-cover transition-opacity duration-300 ${
                imageLoaded && !imageError ? "opacity-100" : "opacity-0"
              }`}
              loading="lazy"
              onLoad={() => { setImageLoaded(true); setImageError(false); }}
              onError={() => { setImageLoaded(false); setImageError(true); }}
            />
          )}

          {/* Book spine overlay */}
          {imageLoaded && !imageError && (
            <div className="book-spine absolute inset-0 rounded" />
          )}

          {/* Fallback cover */}
          {!hasCover && (
            <div className="absolute inset-0 flex flex-col items-center rounded bg-gradient-to-b from-stone-100 to-stone-200 p-3">
              <div className="flex flex-1 items-center justify-center">
                <span className="line-clamp-3 text-center font-serif text-sm font-medium leading-snug text-stone-500">
                  {book.meta.title}
                </span>
              </div>
              <div className="h-px w-8 bg-stone-300/60" />
              {book.meta.author && (
                <div className="flex h-1/4 items-center justify-center">
                  <span className="line-clamp-1 text-center font-serif text-[10px] text-stone-400">
                    {book.meta.author}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Progress bar */}
          {progressPct > 0 && progressPct < 100 && (
            <div className="absolute bottom-0 left-0 right-0 z-10 h-0.5 bg-black/10">
              <div
                className="h-full bg-primary/80 transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}

          {/* Vectorization progress overlay */}
          {isVectorizing && (
            <div className="absolute inset-0 z-15 flex flex-col items-center justify-center rounded bg-black/50 backdrop-blur-sm">
              <Loader2 className="h-5 w-5 animate-spin text-white" />
              <span className="mt-1 text-[10px] font-medium text-white">
                {vectorProgress?.status === "chunking"
                  ? t("home.vec_chunking")
                  : vectorProgress?.status === "embedding"
                    ? `${vecPct}%`
                    : vectorProgress?.status === "indexing"
                      ? t("home.vec_indexing")
                      : t("home.vec_processing")}
              </span>
            </div>
          )}

          {/* Vectorized badge */}
          {book.isVectorized && !isVectorizing && (
            <div className="absolute left-0.5 top-0.5 z-10 flex items-center gap-0.5 rounded bg-green-600/80 px-1 py-0.5 backdrop-blur-sm">
              <Database className="h-2 w-2 text-white" />
              <span className="text-[8px] font-medium text-white">{t("home.vec_indexed")}</span>
            </div>
          )}
        </div>

        {/* Info below cover */}
        <div className="flex w-full flex-col pt-1.5">
          <h4 className="truncate text-[11px] font-semibold leading-tight text-foreground">
            {book.meta.title}
          </h4>

          {/* Tag badges */}
          {book.tags.length > 0 ? (
            <div className="mt-0.5 flex flex-wrap gap-0.5">
              {book.tags.slice(0, 2).map((tag) => (
                <span key={tag} className="inline-flex items-center rounded-full bg-neutral-100 px-1.5 py-px text-[8px] text-neutral-500">
                  {tag}
                </span>
              ))}
              {book.tags.length > 2 && (
                <span className="text-[8px] text-neutral-400">+{book.tags.length - 2}</span>
              )}
            </div>
          ) : (
            <div className="mt-0.5">
              <span className="inline-flex items-center rounded-full bg-neutral-50 px-1.5 py-px text-[8px] text-neutral-400">
                {t("sidebar.uncategorized")}
              </span>
            </div>
          )}

          {/* Status row */}
          <div className="mt-0.5 flex items-center justify-between" style={{ minHeight: "12px" }}>
            {progressPct > 0 && progressPct < 100 ? (
              <span className="text-[9px] tabular-nums text-muted-foreground">{progressPct}%</span>
            ) : progressPct >= 100 ? (
              <span className="text-[9px] font-medium text-green-600">{t("home.complete")}</span>
            ) : (
              <span className="inline-block rounded-full bg-primary/8 px-1 py-px text-[8px] font-medium text-primary">
                {t("home.new")}
              </span>
            )}
            <span className="text-[8px] uppercase tracking-wide text-muted-foreground/60">
              {book.format || "epub"}
            </span>
          </div>
        </div>
      </div>

      {/* Action Sheet (long-press menu) */}
      {showActions && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/40"
            onClick={() => setShowActions(false)}
          />
          <div className="fixed inset-x-0 bottom-0 z-50 animate-in slide-in-from-bottom rounded-t-2xl bg-background pb-[calc(1rem+var(--safe-area-bottom))]">
            {/* Handle bar */}
            <div className="flex justify-center py-3">
              <div className="h-1 w-10 rounded-full bg-muted" />
            </div>

            {/* Book info header */}
            <div className="px-5 pb-3">
              <h3 className="truncate text-sm font-semibold">{book.meta.title}</h3>
              {book.meta.author && (
                <p className="mt-0.5 text-xs text-muted-foreground">{book.meta.author}</p>
              )}
            </div>

            <div className="border-t px-2 pt-2">
              {/* Manage tags */}
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm active:bg-muted transition-colors"
                onClick={() => { setShowActions(false); onManageTags(book); }}
              >
                <Hash className="h-5 w-5 text-muted-foreground" />
                <span>{t("home.manageTags")}</span>
              </button>

              {/* Vectorize */}
              {onVectorize && (
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm active:bg-muted transition-colors"
                  onClick={() => { setShowActions(false); onVectorize(book); }}
                >
                  <Database className="h-5 w-5 text-muted-foreground" />
                  <span>
                    {book.isVectorized ? t("home.vec_reindex") : t("home.vec_vectorize")}
                  </span>
                </button>
              )}

              {/* Delete */}
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-destructive active:bg-destructive/10 transition-colors"
                onClick={() => { setShowActions(false); onDelete(book.id); }}
              >
                <Trash2 className="h-5 w-5" />
                <span>{t("common.remove")}</span>
              </button>
            </div>

            {/* Cancel */}
            <div className="mt-1 border-t px-2 pt-2">
              <button
                type="button"
                className="flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-medium active:bg-muted transition-colors"
                onClick={() => setShowActions(false)}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
});
