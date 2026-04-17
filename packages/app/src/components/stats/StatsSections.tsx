/**
 * StatsSections.tsx — All content section components for the Stats page.
 *
 * Each section is a self-contained visual block. They receive pre-computed data
 * from the parent orchestrator — no business logic or data fetching here.
 */
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useResolvedSrc } from "@/hooks/use-resolved-src";
import type {
  DailyReadingFact,
  MonthReport,
  StatsCalendarCell,
  StatsChartBlock,
  StatsInsight,
  StatsReport,
  TopBookEntry,
} from "@readany/core/stats";
import { cn } from "@readany/core/utils";
import { Clock3, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarChart } from "./BarChart";
import { HeatmapChart } from "./HeatmapChart";
import type { StatsCopy } from "./stats-copy";
import { getStatsCopy } from "./stats-copy";
import {
  formatChartMinutes,
  formatClock,
  formatCompactMinutes,
  formatDateLabel,
  formatMinutes,
  getPeakChartDatum,
  intensityClass,
  localizeSemanticLabel,
  toDateInputValue,
} from "./stats-utils";
import { CoverThumb, EmptyState } from "./StatsShared";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Chart Surface
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function ChartSurface({
  chart,
  copy,
  isZh,
}: {
  chart: StatsChartBlock;
  copy: StatsCopy;
  isZh: boolean;
}) {
  if (chart.type === "heatmap") {
    const peak = getPeakChartDatum(chart);
    return (
      <div className="space-y-5">
        <HeatmapChart
          data={chart.data}
          emptyMessage={copy.noDataDesc}
          isZh={isZh}
          lowLabel={copy.heatmapLegendLow}
          highLabel={copy.heatmapLegendHigh}
          activeDaysLabel={copy.activeDaysSummary}
        />
        {peak && <PeakBadge copy={copy} peak={peak} isZh={isZh} />}
      </div>
    );
  }

  /* Single data point — show as big number instead of a one-bar chart */
  if (chart.data.length <= 1) {
    const point = chart.data[0];
    if (!point) {
      return (
        <div className="flex min-h-[200px] items-center justify-center text-sm text-muted-foreground/40">
          {copy.noDataDesc}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/40">
            {copy.singlePointLabel}
          </div>
          <div className="text-4xl font-bold tabular-nums tracking-tighter text-foreground">
            {formatMinutes(point.value, isZh)}
          </div>
          <div className="text-[13px] text-muted-foreground/50">{point.label}</div>
        </div>
        <p className="max-w-lg text-[13px] leading-relaxed text-muted-foreground/40">
          {copy.singlePointDesc}
        </p>
      </div>
    );
  }

  /* Standard bar chart */
  const peak = getPeakChartDatum(chart);
  return (
    <div className="space-y-5">
      <div className="-mx-1 overflow-hidden rounded-xl bg-gradient-to-b from-primary/[0.03] to-transparent px-1 pt-2 pb-1">
        <BarChart
          data={chart.data.map((item) => ({ label: item.label, value: item.value }))}
          height={240}
          emptyMessage={copy.noDataDesc}
          formatValue={(value) => formatChartMinutes(value, isZh)}
        />
      </div>
      {peak && <PeakBadge copy={copy} peak={peak} isZh={isZh} />}
    </div>
  );
}

function PeakBadge({
  copy,
  peak,
  isZh,
}: {
  copy: StatsCopy;
  peak: StatsChartBlock["data"][number];
  isZh: boolean;
}) {
  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-lg bg-primary/[0.05] px-3 py-1.5 text-[13px] font-medium text-foreground/75">
      <TrendingUp className="h-3.5 w-3.5 text-primary/40" />
      {copy.chartPeakLabel(peak.label, formatMinutes(peak.value, isZh))}
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Day Summary
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function DaySummaryPanel({
  dayFact,
  topBook,
  copy,
  isZh,
}: {
  dayFact: DailyReadingFact | null;
  topBook?: TopBookEntry;
  copy: StatsCopy;
  isZh: boolean;
}) {
  if (!dayFact) {
    return (
      <EmptyState
        title={copy.noDataTitle}
        description={copy.noDataDesc}
        icon={<Clock3 className="h-7 w-7 text-muted-foreground/50" />}
      />
    );
  }

  const facts = [
    { label: copy.firstSession, value: formatClock(dayFact.firstSessionAt, isZh) },
    { label: copy.lastSession, value: formatClock(dayFact.lastSessionAt, isZh) },
    {
      label: copy.peakHour,
      value: dayFact.peakHour !== undefined ? `${String(dayFact.peakHour).padStart(2, "0")}:00` : "—",
    },
    { label: copy.longestRead, value: formatMinutes(dayFact.longestSessionTime, isZh) },
  ];

  return (
    <div className="space-y-5">
      {/* Fact chips */}
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {facts.map((item) => (
          <div key={item.label} className="rounded-xl bg-muted/[0.12] px-3.5 py-2.5">
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/40">
              {item.label}
            </div>
            <div className="mt-1.5 text-lg font-bold tabular-nums text-foreground/85">
              {item.value}
            </div>
          </div>
        ))}
      </div>

      {/* Top focus highlight */}
      <div className="rounded-xl border-l-2 border-l-primary/15 bg-primary/[0.02] px-5 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/40">
              {copy.topFocus}
            </div>
            <div className="text-lg font-bold text-foreground/85">
              {topBook?.title ?? copy.noDayTopBook}
            </div>
            <div className="text-[13px] text-muted-foreground/45">
              {topBook ? formatMinutes(topBook.totalTime, isZh) : copy.noTimeline}
            </div>
          </div>
          {dayFact.date === toDateInputValue(new Date()) && (
            <div className="inline-flex items-center gap-1.5 self-start rounded-lg bg-primary/[0.06] px-3 py-1.5 text-[12px] font-medium text-primary/60">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/50" />
              {copy.activeNow}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Top Books
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const TOP_BOOKS_COLLAPSED = 3;

export function TopBooksSection({
  books,
  copy,
  isZh,
}: {
  books: TopBookEntry[];
  copy: StatsCopy;
  isZh: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (books.length === 0) {
    return (
      <p className="py-8 text-center text-[13px] text-muted-foreground/45">{copy.noTopBooks}</p>
    );
  }

  const canExpand = books.length > TOP_BOOKS_COLLAPSED;
  const visibleBooks = expanded ? books : books.slice(0, TOP_BOOKS_COLLAPSED);

  return (
    <div className="space-y-1.5">
      {visibleBooks.map((book, index) => (
        <TopBookItem
          key={book.bookId}
          book={book}
          index={index}
          isFirst={index === 0}
          copy={copy}
          isZh={isZh}
        />
      ))}

      {/* Expand / Collapse toggle */}
      {canExpand && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-1 rounded-lg py-2 text-[12px] font-medium text-muted-foreground/50 transition-colors hover:bg-muted/[0.1] hover:text-muted-foreground/70"
        >
          {expanded ? (
            <>
              {isZh ? "收起" : "Show less"}
              <ChevronUp className="h-3.5 w-3.5" />
            </>
          ) : (
            <>
              {isZh
                ? `查看全部 ${books.length} 本`
                : `Show all ${books.length} books`}
              <ChevronDown className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      )}
    </div>
  );
}

function TopBookItem({
  book,
  index,
  isFirst,
  copy,
  isZh,
}: {
  book: TopBookEntry;
  index: number;
  isFirst: boolean;
  copy: StatsCopy;
  isZh: boolean;
}) {
  return (
    <article
      className={cn(
        "group flex min-w-0 items-start gap-3.5 rounded-xl px-3 py-3 transition-colors",
        isFirst
          ? "bg-primary/[0.03] ring-1 ring-inset ring-primary/[0.06]"
          : "hover:bg-muted/[0.12]",
      )}
    >
      {/* Rank number */}
      <div
        className={cn(
          "mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-[11px] font-bold tabular-nums",
          isFirst
            ? "bg-primary/8 text-primary/60"
            : "bg-muted/25 text-muted-foreground/35",
        )}
      >
        {index + 1}
      </div>

      {/* Book cover — matches library style */}
      <div className={cn(
        "book-cover-shadow relative flex-shrink-0 overflow-hidden rounded",
        isFirst ? "w-16" : "w-11",
      )}>
        <div className="aspect-[28/41] w-full">
          <BookCover title={book.title} coverUrl={book.coverUrl} />
        </div>
        <div className="book-spine absolute inset-0 rounded" />
      </div>

      {/* Info — left-aligned */}
      <div className="min-w-0 flex-1 pt-0.5">
        {isFirst && (
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary/40">
            {copy.topBookLead}
          </div>
        )}
        <div
          className={cn(
            "truncate font-semibold text-foreground/80 transition-colors group-hover:text-foreground",
            isFirst ? "text-[14px]" : "text-[13px]",
          )}
        >
          {book.title}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground/40">
          {book.author || copy.unknownAuthor}
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
          <span
            className={cn(
              "font-bold tabular-nums text-foreground/75",
              isFirst ? "text-lg" : "text-[14px]",
            )}
          >
            {formatCompactMinutes(book.totalTime, isZh)}
          </span>
          <span className="text-[10px] text-muted-foreground/35">
            {book.pagesRead > 0 && <>{book.pagesRead.toLocaleString()} {copy.pagesReadSuffix} · </>}
            {book.sessionsCount.toLocaleString()} {copy.sessionsSuffix}
          </span>
        </div>
      </div>
    </article>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Insights
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function InsightsSection({
  insights,
  copy,
}: {
  insights: StatsInsight[];
  copy: StatsCopy;
}) {
  if (insights.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-muted-foreground/45">{copy.noInsights}</p>
    );
  }

  return (
    <div className="space-y-2.5">
      {insights.map((insight) => (
        <div
          key={insight.id}
          className="group rounded-xl border border-border/20 px-4 py-3.5 transition-colors hover:border-border/40"
        >
          <div className="flex items-start gap-3">
            <div className="mt-1.5 flex-shrink-0">
              <div
                className={cn(
                  "h-2 w-2 rounded-full",
                  insight.tone === "celebration" && "bg-primary/60",
                  insight.tone === "warning" && "bg-destructive/45",
                  insight.tone === "positive" && "bg-primary/45",
                  (!insight.tone ||
                    !["celebration", "warning", "positive"].includes(insight.tone)) &&
                    "bg-border/60",
                )}
              />
            </div>
            <div className="min-w-0 space-y-0.5">
              <div className="text-[13px] font-semibold text-foreground/75">{insight.title}</div>
              <div className="text-[13px] leading-relaxed text-muted-foreground/45">
                {insight.body}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Rhythm Profile (Year / Lifetime)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function RhythmProfileSection({
  timeOfDayChart,
  categoryChart,
  copy,
  isZh,
}: {
  timeOfDayChart?: StatsChartBlock;
  categoryChart?: StatsChartBlock;
  copy: StatsCopy;
  isZh: boolean;
}) {
  const hasTwo = Boolean(timeOfDayChart) && Boolean(categoryChart);

  return (
    <div className={cn("grid gap-8", hasTwo && "xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]")}>
      {timeOfDayChart && (
        <div className={cn("space-y-5", hasTwo && "xl:border-r xl:border-border/20 xl:pr-8")}>
          <div className="space-y-1">
            <h3 className="text-[14px] font-semibold text-foreground/85">{copy.timeOfDay}</h3>
            <p className="text-[13px] leading-relaxed text-muted-foreground/45">
              {copy.timeOfDayDesc}
            </p>
          </div>
          <BarChart
            data={timeOfDayChart.data.map((item) => ({
              label: localizeSemanticLabel(item.key, item.label, copy),
              value: item.value,
            }))}
            height={220}
            emptyMessage={copy.noDataDesc}
            formatValue={(value) => formatChartMinutes(value, isZh)}
          />
        </div>
      )}

      {categoryChart && (
        <div className="space-y-5">
          <div className="space-y-1">
            <h3 className="text-[14px] font-semibold text-foreground/85">
              {copy.categoryDistribution}
            </h3>
            <p className="text-[13px] leading-relaxed text-muted-foreground/45">
              {copy.categoryDistributionDesc}
            </p>
          </div>
          <CategoryDistributionList chart={categoryChart} copy={copy} isZh={isZh} />
        </div>
      )}
    </div>
  );
}

function CategoryDistributionList({
  chart,
  copy,
  isZh,
}: {
  chart: StatsChartBlock;
  copy: StatsCopy;
  isZh: boolean;
}) {
  const maxValue = Math.max(...chart.data.map((item) => item.value), 1);

  return (
    <div className="space-y-4">
      {chart.data.map((item, index) => {
        const label = localizeSemanticLabel(item.key, item.label, copy);
        const pct = Math.max(10, (item.value / maxValue) * 100);

        return (
          <div key={`${item.key}-${index}`} className="group space-y-1.5">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0 text-[13px] font-medium text-foreground/75 transition-colors group-hover:text-foreground">
                {label}
              </div>
              <div className="flex-shrink-0 text-[13px] tabular-nums text-muted-foreground/50">
                {formatCompactMinutes(item.value, isZh)}
              </div>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted/25">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary/25 to-primary/55 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Yearly Snapshots (Lifetime) — flat rows, no nested cards
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function YearlySnapshotsSection({
  snapshots,
  copy,
  isZh,
}: {
  snapshots: Extract<StatsReport, { dimension: "lifetime" }>["yearlySnapshots"];
  copy: StatsCopy;
  isZh: boolean;
}) {
  return (
    <div className="divide-y divide-border/20">
      {snapshots.map((snapshot) => (
        <div
          key={snapshot.year}
          className="flex items-center gap-5 py-4 first:pt-0 last:pb-0"
        >
          {/* Year label */}
          <div className="w-12 shrink-0 text-[13px] font-bold tabular-nums text-foreground/70">
            {snapshot.year}
          </div>

          {/* Top book cover — library style */}
          {snapshot.topBook ? (
            <div className="book-cover-shadow relative w-10 shrink-0 overflow-hidden rounded">
              <div className="aspect-[28/41] w-full">
                <BookCover title={snapshot.topBook.title} coverUrl={snapshot.topBook.coverUrl} />
              </div>
              <div className="book-spine absolute inset-0 rounded" />
            </div>
          ) : (
            <div className="w-10 shrink-0" />
          )}

          {/* Stats */}
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold tabular-nums tracking-tight text-foreground/85">
              {formatCompactMinutes(snapshot.totalReadingTime, isZh)}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-muted-foreground/45">
              <span>{snapshot.booksTouched.toLocaleString()} {copy.books}</span>
              <span>{snapshot.activeDays.toLocaleString()} {copy.activeDays}</span>
              {snapshot.topBook && (
                <span className="truncate text-foreground/50">{snapshot.topBook.title}</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Journey Summary (Lifetime) — flat layout, no inner cards
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function JourneySummaryPanel({
  report,
  copy,
  isZh,
}: {
  report: Extract<StatsReport, { dimension: "lifetime" }>;
  copy: StatsCopy;
  isZh: boolean;
}) {
  return (
    <div className="space-y-6">
      {/* Hero number + narrative */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <div className="text-[42px] font-bold tabular-nums leading-none tracking-tighter text-foreground/85">
            {report.context.daysSinceJoined.toLocaleString()} <span className="text-[24px] font-semibold tracking-normal text-muted-foreground/50">{copy.daysSuffix}</span>
          </div>
          <p className="max-w-lg text-[13px] leading-relaxed text-muted-foreground/45">
            {copy.journeyNarrative(report.context.daysSinceJoined)}
          </p>
        </div>
        <div className="shrink-0 text-[12px] text-muted-foreground/40">
          {copy.startedOn} {formatDateLabel(report.context.joinedSince, isZh)}
        </div>
      </div>

      {/* Metric row — simple divider-separated inline stats */}
      <div className="flex flex-wrap gap-x-8 gap-y-3 border-t border-border/20 pt-5">
        {[
          { label: copy.activeReadingDays, value: `${report.context.totalActiveDays.toLocaleString()} ${copy.daysSuffix}` },
          { label: copy.inactiveReadingDays, value: `${report.context.totalInactiveDays.toLocaleString()} ${copy.daysSuffix}` },
        ].map((item) => (
          <div key={item.label}>
            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/35">
              {item.label}
            </div>
            <div className="mt-1 text-[16px] font-bold tabular-nums text-foreground/80">
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Month Calendar
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function MonthCalendarSection({
  calendar,
  isZh,
}: {
  calendar: NonNullable<MonthReport["readingCalendar"]>;
  isZh: boolean;
}) {
  const locale = isZh ? "zh-CN" : "en-US";
  const weekLabels = useMemo(() => {
    const monday = new Date(2024, 0, 1);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
    });
  }, [locale]);

  return (
    <div className="space-y-3">
      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-2">
        {weekLabels.map((label) => (
          <div
            key={label}
            className="px-1 text-center text-[11px] font-medium text-muted-foreground/35"
          >
            {label}
          </div>
        ))}
      </div>

      {/* Week rows */}
      <div className="space-y-2">
        {calendar.weeks.map((week, index) => (
          <div key={`${calendar.monthKey}-${index}`} className="grid grid-cols-7 gap-2">
            {week.map((cell) => (
              <CalendarDayCell key={cell.date} cell={cell} isZh={isZh} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CalendarDayCell({ cell, isZh }: { cell: StatsCalendarCell; isZh: boolean }) {
  const { t } = useTranslation();
  const copy = useMemo(() => getStatsCopy(t), [t]);

  const tooltipText =
    cell.totalTime > 0
      ? `${formatDateLabel(cell.date, isZh)} · ${formatMinutes(cell.totalTime, isZh)} · ${cell.sessionsCount.toLocaleString()} ${copy.sessionsSuffix}`
      : `${formatDateLabel(cell.date, isZh)} · ${t("stats.noReading")}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex min-h-[80px] min-w-0 flex-col justify-between rounded-[14px] border p-2 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_3px_10px_rgba(0,0,0,0.03)] sm:min-h-[92px] sm:rounded-2xl sm:p-2.5",
            intensityClass(cell.intensity, cell.inCurrentMonth),
            cell.isToday && "ring-1.5 ring-primary/20 ring-offset-1 ring-offset-background",
          )}
        >
          {/* Top row: day number + time badge */}
          <div className="flex items-start justify-between gap-0.5">
            <div
              className={cn(
                "text-[13px] font-semibold tabular-nums leading-none",
                cell.inCurrentMonth ? "text-foreground/75" : "text-muted-foreground/25",
                cell.isToday && "text-primary/70",
              )}
            >
              {cell.dayOfMonth}
            </div>
            {cell.totalTime > 0 && (
              <div className="shrink-0 whitespace-nowrap rounded-md bg-background/70 px-1 py-0.5 text-[9px] font-medium tabular-nums leading-none text-foreground/60 shadow-xs backdrop-blur-sm">
                {formatCompactMinutes(cell.totalTime, isZh)}
              </div>
            )}
          </div>

          {/* Book covers — flush to bottom via flex justify-between */}
          {cell.covers.length > 0 ? (
            <div className="flex items-end">
              {cell.covers.slice(0, 3).map((cover, index) => (
                <div
                  key={`${cover.bookId}-${index}`}
                  className={cn("relative", index > 0 && "-ml-2")}
                  style={{ zIndex: 10 - index }}
                >
                  <CoverThumb
                    title={cover.title}
                    coverUrl={cover.coverUrl}
                    className="h-9 w-7 rounded-[4px] border-[1.5px] border-background/80 shadow-sm sm:h-10 sm:w-8"
                    fallbackClassName="text-[8px] font-bold"
                  />
                </div>
              ))}
              {cell.covers.length > 3 && (
                <div
                  className="relative -ml-1 flex h-9 w-7 shrink-0 items-center justify-center rounded-[4px] border-[1.5px] border-background/80 bg-muted/80 text-[10px] font-bold tabular-nums text-muted-foreground/70 shadow-sm backdrop-blur-sm sm:h-10 sm:w-8"
                  style={{ zIndex: 7 }}
                >
                  +{cell.covers.length - 3}
                </div>
              )}
            </div>
          ) : (
            <div />
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="max-w-[220px] rounded-lg border border-border/40 bg-popover px-3 py-2 text-popover-foreground shadow-md"
      >
        <div className="space-y-1">
          <div className="text-[12px] font-medium">{tooltipText}</div>
          {cell.covers.length > 0 && (
            <div className="text-[11px] text-muted-foreground/50">
              {cell.covers.map((cover) => cover.title).join(" · ")}
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  BookCover — library-style cover with spine overlay
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function BookCover({ title, coverUrl }: { title: string; coverUrl?: string }) {
  const resolved = useResolvedSrc(coverUrl);

  return resolved ? (
    <img
      src={resolved}
      alt=""
      className="absolute inset-0 h-full w-full rounded object-cover"
      loading="lazy"
    />
  ) : (
    <div className="absolute inset-0 flex items-center justify-center rounded bg-gradient-to-b from-stone-100 to-stone-200 px-1">
      <span className="line-clamp-2 text-center font-serif text-[10px] font-medium leading-tight text-stone-400">
        {title.trim().slice(0, 6)}
      </span>
    </div>
  );
}
