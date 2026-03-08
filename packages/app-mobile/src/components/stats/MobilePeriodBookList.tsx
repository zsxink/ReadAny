/**
 * MobilePeriodBookList — compact book list for mobile
 */
import { useTranslation } from "react-i18next";
import type { PeriodBookStats } from "@readany/core/stats";

interface MobilePeriodBookListProps {
  books: PeriodBookStats[];
}

export function MobilePeriodBookList({ books }: MobilePeriodBookListProps) {
  const { t } = useTranslation();

  if (books.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-muted-foreground">
        {t("stats.noBooksInPeriod")}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {books.map((book) => (
        <div key={book.bookId} className="flex items-center gap-2.5 rounded-lg p-1.5">
          {/* Cover */}
          <div className="h-10 w-7 flex-shrink-0 overflow-hidden rounded bg-neutral-100">
            {book.coverUrl ? (
              <img src={book.coverUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[8px] text-neutral-300">
                {book.title.charAt(0)}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1">
              <p className="truncate text-xs font-medium">{book.title}</p>
              <span className="flex-shrink-0 text-[10px] text-muted-foreground">{formatTime(book.totalTime)}</span>
            </div>
            {/* Progress bar */}
            <div className="mt-1 flex items-center gap-1.5">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${Math.min(book.progress * 100, 100)}%` }}
                />
              </div>
              <span className="text-[9px] text-muted-foreground">{Math.round(book.progress * 100)}%</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatTime(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}
