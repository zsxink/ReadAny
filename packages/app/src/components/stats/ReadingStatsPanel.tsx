/**
 * ReadingStatsPanel.tsx — Main orchestrator for the Statistics page.
 *
 * Responsibilities:
 *   1. State management (dimension, anchor date, report loading)
 *   2. Layout composition — delegates every visual block to sub-components
 *   3. Period navigation controls
 *
 * All formatters → stats-utils.ts
 * All i18n copy  → stats-copy.ts
 * All UI atoms   → StatsShared.tsx
 * All sections   → StatsSections.tsx
 */
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppStore } from "@/stores/app-store";
import { useReadingSessionStore } from "@/stores/reading-session-store";
import {
  getWeekStartDate,
  readingReportsService,
  type StatsDimension,
  type StatsReport,
} from "@readany/core/stats";
import { cn } from "@readany/core/utils";
import { eventBus } from "@readany/core/utils/event-bus";
import {
  BookOpenText,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flame,
  Layers3,
  LibraryBig,
  ScanSearch,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { getStatsCopy } from "./stats-copy";
import {
  buildHeroNarrative,
  DIMENSIONS,
  formatMinutes,
  formatPeriodLabel,
  localizeInsight,
  shiftAnchorDate,
  toDateInputValue,
  toMonthInputValue,
  type MetricTileData,
} from "./stats-utils";
import { EmptyState, MetricTile, SectionHeader, StatsCard } from "./StatsShared";
import {
  ChartSurface,
  DaySummaryPanel,
  InsightsSection,
  JourneySummaryPanel,
  MonthCalendarSection,
  RhythmProfileSection,
  TopBooksSection,
  YearlySnapshotsSection,
} from "./StatsSections";
import { formatDateLabel } from "./stats-utils";

/* ─── Hero metric builder (kept here because it uses lucide icons) ─── */

function buildHeroMetrics(
  report: StatsReport,
  copy: ReturnType<typeof getStatsCopy>,
  isZh: boolean,
): MetricTileData[] {
  const metrics: MetricTileData[] = [];

  if (report.dimension === "lifetime") {
    metrics.push({
      id: "days-together",
      label: copy.daysTogether,
      value: `${report.context.daysSinceJoined.toLocaleString()} ${copy.daysSuffix}`,
      sublabel: `${copy.startedOn} ${formatDateLabel(report.context.joinedSince, isZh)}`,
      icon: <CalendarDays className="h-4 w-4" />,
    });
  } else {
    metrics.push({
      id: "reading-time",
      label: copy.readingTime,
      value: formatMinutes(report.summary.totalReadingTime, isZh),
      sublabel: copy.dimensionTitles[report.dimension],
      icon: <Clock3 className="h-4 w-4" />,
    });
  }

  metrics.push(
    {
      id: "active-days",
      label: copy.activeDays,
      value: `${report.summary.activeDays.toLocaleString()} ${copy.daysSuffix}`,
      sublabel: copy.avgActiveDay,
      icon: <TrendingUp className="h-4 w-4" />,
    },
    {
      id: "sessions",
      label: copy.sessions,
      value: `${report.summary.totalSessions.toLocaleString()} ${copy.sessionsSuffix}`,
      sublabel: formatMinutes(report.summary.avgSessionTime, isZh),
      icon: <Layers3 className="h-4 w-4" />,
    },
    {
      id: "books",
      label: copy.books,
      value: report.summary.booksTouched.toLocaleString(),
      sublabel: `${report.summary.totalPagesRead.toLocaleString()} ${copy.pagesReadSuffix}`,
      icon: <LibraryBig className="h-4 w-4" />,
    },
    {
      id: "streak",
      label: copy.streak,
      value: `${
        report.dimension === "lifetime"
          ? report.summary.longestStreak.toLocaleString()
          : report.summary.currentStreak.toLocaleString()
      } ${copy.daysSuffix}`,
      sublabel: `${copy.longestSession} ${formatMinutes(report.summary.longestSessionTime, isZh)}`,
      icon: <Flame className="h-4 w-4" />,
    },
    {
      id: "avg-day",
      label: copy.avgActiveDay,
      value: formatMinutes(report.summary.avgActiveDayTime, isZh),
      sublabel: copy.readingTime,
      icon: <BookOpenText className="h-4 w-4" />,
    },
  );

  return metrics;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Main Component
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function ReadingStatsPanel() {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const copy = useMemo(() => getStatsCopy(t), [t, i18n.language]);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const saveCurrentSession = useReadingSessionStore((s) => s.saveCurrentSession);
  const currentSession = useReadingSessionStore((s) => s.currentSession);

  /* ── State ── */
  const [dimension, setDimension] = useState<StatsDimension>("month");
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [report, setReport] = useState<StatsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ── Data loading ── */
  const loadReport = useCallback(async () => {
    if (activeTabId !== "stats") return;
    setLoading(true);
    setError(null);
    try {
      let nextReport: StatsReport;
      if (dimension === "day") {
        nextReport = await readingReportsService.getDayReport(anchorDate, currentSession);
      } else if (dimension === "week") {
        nextReport = await readingReportsService.getWeekReport(anchorDate, currentSession);
      } else if (dimension === "month") {
        nextReport = await readingReportsService.getMonthReport(anchorDate, currentSession);
      } else if (dimension === "year") {
        nextReport = await readingReportsService.getYearReport(anchorDate, currentSession);
      } else {
        nextReport = await readingReportsService.getLifetimeReport(currentSession);
      }
      setReport(nextReport);
    } catch (statsError) {
      console.error("[ReadingStatsPanel] Failed to load report", statsError);
      setError(copy.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [activeTabId, anchorDate, currentSession, dimension, copy.loadFailed]);

  useEffect(() => {
    if (activeTabId === "stats") {
      void saveCurrentSession().finally(() => void loadReport());
    }
  }, [activeTabId, saveCurrentSession, loadReport]);

  useEffect(() => {
    return eventBus.on("sync:completed", () => {
      if (activeTabId !== "stats") return;
      void loadReport();
    });
  }, [activeTabId, loadReport]);

  /* ── Derived data ── */
  const heroMetrics = useMemo(
    () => (report ? buildHeroMetrics(report, copy, isZh) : []),
    [report, copy, isZh],
  );
  const headlineMetric = heroMetrics[0] ?? null;
  const supportMetrics = heroMetrics.slice(1);

  const periodLabel = useMemo(
    () => (report ? formatPeriodLabel(report, isZh, copy) : ""),
    [report, isZh, copy],
  );
  const heroNarrative = useMemo(
    () => (report ? buildHeroNarrative(report, copy, isZh) : ""),
    [report, copy, isZh],
  );

  const primaryChart = report?.charts[0] ?? null;
  const monthlyReport = report?.dimension === "month" ? report : null;
  const yearOrLifetimeReport =
    report?.dimension === "year" || report?.dimension === "lifetime" ? report : null;
  const primaryChartTitle =
    primaryChart?.type === "heatmap" ? copy.readingHeatmap : copy.primaryChart;
  const primaryChartDesc =
    primaryChart?.type === "heatmap" ? copy.readingHeatmapDesc : copy.primaryChartDesc;

  const localizedInsights = useMemo(
    () => (report ? report.insights.map((item) => localizeInsight(item, report, copy, isZh)) : []),
    [report, copy, isZh],
  );
  const localizedMilestones = useMemo(
    () =>
      report?.dimension === "lifetime"
        ? report.milestones.map((item) => localizeInsight(item, report, copy, isZh))
        : [],
    [report, copy, isZh],
  );

  /* ── Period picker handlers ── */
  const onPickPeriod = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    if (!value) return;

    if (dimension === "day" || dimension === "week") {
      setAnchorDate(
        getWeekStartDate(value) && dimension === "week"
          ? getWeekStartDate(value)
          : new Date(value),
      );
      if (dimension === "day") setAnchorDate(new Date(value));
      return;
    }

    if (dimension === "month") {
      const [year, month] = value.split("-").map(Number);
      setAnchorDate(new Date(year, (month || 1) - 1, 1));
      return;
    }

    if (dimension === "year") {
      const nextYear = Number(value);
      if (!Number.isNaN(nextYear)) setAnchorDate(new Date(nextYear, 0, 1));
    }
  };

  const resetToCurrentPeriod = () => setAnchorDate(new Date());

  const currentPickerValue =
    dimension === "month"
      ? toMonthInputValue(anchorDate)
      : dimension === "year"
        ? String(anchorDate.getFullYear())
        : toDateInputValue(anchorDate);

  /* ━━━━━━━━━━ Render ━━━━━━━━━━ */

  return (
    <TooltipProvider delayDuration={120}>
      <div className="h-full min-w-0 overflow-y-auto overflow-x-hidden bg-background">
        <div className="mx-auto flex w-full min-w-0 max-w-[1800px] flex-col gap-6 px-5 py-6 sm:px-8 sm:py-8 lg:gap-8">

          {/* ════════ Header ════════ */}
          <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-1.5">
              <h1 className="text-[28px] font-bold tracking-tight text-foreground sm:text-[34px]">
                {copy.pageTitle}
              </h1>
              <p className="max-w-xl text-[15px] leading-relaxed text-muted-foreground/55">
                {copy.pageSubtitle}
              </p>
            </div>

            {/* Dimension tabs */}
            <nav className="inline-flex w-full max-w-full rounded-xl border border-border/30 bg-muted/25 p-1 lg:w-auto">
              {DIMENSIONS.map((dim) => (
                <button
                  key={dim}
                  className={cn(
                    "min-w-0 flex-1 rounded-[10px] px-4 py-2 text-[13px] font-medium transition-all duration-150 lg:flex-none lg:px-5",
                    dimension === dim
                      ? "bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                      : "text-muted-foreground/55 hover:text-foreground/70",
                  )}
                  onClick={() => setDimension(dim)}
                >
                  {copy.dimensions[dim]}
                </button>
              ))}
            </nav>
          </header>

          {/* ════════ Loading ════════ */}
          {loading ? (
            <div className="flex min-h-[50vh] items-center justify-center">
              <div className="flex flex-col items-center gap-4">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-border/40 border-t-foreground/60" />
                <span className="text-[13px] text-muted-foreground/40">{copy.loading}</span>
              </div>
            </div>
          ) : error || !report ? (
            /* ════════ Error / Empty ════════ */
            <StatsCard className="min-h-[50vh]">
              <EmptyState
                title={error ?? copy.noDataTitle}
                description={copy.noDataDesc}
                icon={<ScanSearch className="h-7 w-7 text-muted-foreground/45" />}
              />
            </StatsCard>
          ) : (
            <>
              {/* ════════ Hero Section ════════ */}
              <section className="relative overflow-hidden rounded-2xl border border-border/30 bg-gradient-to-br from-card via-card to-primary/[0.02]">
                {/* Decorative glow */}
                <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/[0.04] blur-3xl" />

                <div className="relative space-y-8 px-6 py-6 sm:px-8 sm:py-8">
                  {/* Period navigation */}
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="space-y-0.5">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/45">
                        {copy.dimensionTitles[dimension]}
                      </div>
                      <div className="text-lg font-semibold text-foreground/85 sm:text-xl">
                        {periodLabel}
                      </div>
                    </div>

                    {dimension !== "lifetime" && (
                      <div className="flex flex-wrap items-center gap-2.5">
                        {/* Arrow buttons */}
                        <div className="inline-flex items-center gap-0.5 rounded-xl border border-border/30 bg-background/50 p-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 rounded-[10px] text-muted-foreground/50 hover:bg-muted/30 hover:text-foreground"
                            onClick={() =>
                              setAnchorDate((p) => shiftAnchorDate(p, dimension, -1))
                            }
                            disabled={!report.navigation.canGoPrev}
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 rounded-[10px] text-muted-foreground/50 hover:bg-muted/30 hover:text-foreground"
                            onClick={() =>
                              setAnchorDate((p) => shiftAnchorDate(p, dimension, 1))
                            }
                            disabled={!report.navigation.canGoNext}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>

                        {/* Date/month/year picker */}
                        {dimension === "year" ? (
                          <input
                            type="number"
                            min="2000"
                            max={String(new Date().getFullYear())}
                            value={currentPickerValue}
                            onChange={onPickPeriod}
                            className="h-9 w-24 rounded-xl border border-border/30 bg-background/50 px-3 text-sm tabular-nums text-foreground outline-none transition-colors focus:border-primary/25 focus:ring-1 focus:ring-primary/15"
                          />
                        ) : (
                          <input
                            type={dimension === "month" ? "month" : "date"}
                            value={currentPickerValue}
                            onChange={onPickPeriod}
                            className="h-9 rounded-xl border border-border/30 bg-background/50 px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/25 focus:ring-1 focus:ring-primary/15"
                          />
                        )}

                        {/* "Today / This week" shortcut */}
                        <Button
                          variant="soft"
                          size="sm"
                          className="rounded-xl border border-border/30 bg-background/50 px-3.5 text-[13px] text-muted-foreground/60 hover:bg-muted/30 hover:text-foreground"
                          onClick={resetToCurrentPeriod}
                        >
                          {dimension === "day"
                            ? copy.today
                            : dimension === "week"
                              ? copy.thisWeek
                              : dimension === "month"
                                ? copy.thisMonth
                                : copy.thisYear}
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Hero metrics grid */}
                  <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                    {/* Headline number */}
                    <div className="min-w-0 space-y-3">
                      {headlineMetric && (
                        <div className="space-y-2">
                          <div className="text-[48px] font-bold leading-none tracking-tighter text-foreground sm:text-[56px] xl:text-[64px]">
                            {headlineMetric.value}
                          </div>
                          <div className="flex items-center gap-2 text-[14px] text-muted-foreground/55">
                            <span className="text-primary/35">{headlineMetric.icon}</span>
                            {headlineMetric.label}
                            {headlineMetric.sublabel && (
                              <>
                                <span className="text-border/60">·</span>
                                <span>{headlineMetric.sublabel}</span>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                      <p className="max-w-lg text-[14px] leading-relaxed text-muted-foreground/45">
                        {heroNarrative}
                      </p>
                    </div>

                    {/* Supporting metrics — 3 cols on large screens for density */}
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-3">
                      {supportMetrics.map((metric) => (
                        <MetricTile key={metric.id} metric={metric} />
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              {/* ════════ Content Grid ════════ */}
              <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,1fr)] xl:gap-8">

                {/* ─── Main column ─── */}
                <div className="min-w-0 space-y-6">
                  {/* Day summary */}
                  {report.dimension === "day" && (
                    <StatsCard>
                      <SectionHeader title={copy.daySummary} description={copy.daySummaryDesc} />
                      <DaySummaryPanel
                        dayFact={report.dayFact}
                        topBook={report.topBooks[0]}
                        copy={copy}
                        isZh={isZh}
                      />
                    </StatsCard>
                  )}

                  {/* Primary chart */}
                  {primaryChart && (
                    <StatsCard>
                      <SectionHeader title={primaryChartTitle} description={primaryChartDesc} />
                      <ChartSurface chart={primaryChart} copy={copy} isZh={isZh} />
                    </StatsCard>
                  )}

                  {/* Monthly calendar */}
                  {monthlyReport?.readingCalendar && (
                    <StatsCard>
                      <SectionHeader
                        title={copy.readingCalendar}
                        description={copy.readingCalendarDesc}
                      />
                      <MonthCalendarSection
                        calendar={monthlyReport.readingCalendar}
                        isZh={isZh}
                      />
                    </StatsCard>
                  )}

                  {/* Rhythm profile */}
                  {yearOrLifetimeReport &&
                    (yearOrLifetimeReport.timeOfDayChart ||
                      yearOrLifetimeReport.categoryDistribution) && (
                      <StatsCard>
                        <SectionHeader
                          title={copy.rhythmProfile}
                          description={copy.rhythmProfileDesc}
                        />
                        <RhythmProfileSection
                          timeOfDayChart={yearOrLifetimeReport.timeOfDayChart}
                          categoryChart={yearOrLifetimeReport.categoryDistribution}
                          copy={copy}
                          isZh={isZh}
                        />
                      </StatsCard>
                    )}

                  {/* Yearly snapshots */}
                  {report.dimension === "lifetime" && report.yearlySnapshots.length > 0 && (
                    <StatsCard>
                      <SectionHeader title={copy.annualShelf} description={copy.annualShelfDesc} />
                      <YearlySnapshotsSection
                        snapshots={report.yearlySnapshots}
                        copy={copy}
                        isZh={isZh}
                      />
                    </StatsCard>
                  )}

                  {/* Journey summary */}
                  {report.dimension === "lifetime" && (
                    <StatsCard>
                      <SectionHeader title={copy.journey} description={copy.journeySubtitle} />
                      <JourneySummaryPanel report={report} copy={copy} isZh={isZh} />
                    </StatsCard>
                  )}
                </div>

                {/* ─── Sidebar ─── */}
                <aside className="min-w-0 space-y-6">
                  {/* Top books — featured variant */}
                  <StatsCard variant="featured">
                    <SectionHeader title={copy.topBooks} description={copy.topBooksDesc} />
                    <TopBooksSection books={report.topBooks} copy={copy} isZh={isZh} />
                  </StatsCard>

                  {/* Insights */}
                  <StatsCard>
                    <SectionHeader title={copy.insights} description={copy.insightsDesc} />
                    <InsightsSection insights={localizedInsights} copy={copy} />
                  </StatsCard>

                  {/* Milestones (lifetime) */}
                  {report.dimension === "lifetime" && localizedMilestones.length > 0 && (
                    <StatsCard>
                      <SectionHeader title={copy.milestones} description={copy.milestonesDesc} />
                      <InsightsSection insights={localizedMilestones} copy={copy} />
                    </StatsCard>
                  )}
                </aside>
              </div>
            </>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
