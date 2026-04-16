import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useResolvedSrc } from "@/hooks/use-resolved-src";
import { useAppStore } from "@/stores/app-store";
import { useReadingSessionStore } from "@/stores/reading-session-store";
import {
  fromLocalDateKey,
  getWeekStartDate,
  readingReportsService,
  type DailyReadingFact,
  type MonthReport,
  type StatsCalendarCell,
  type StatsChartBlock,
  type StatsDimension,
  type StatsInsight,
  type StatsReport,
  type TopBookEntry,
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
import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BarChart } from "./BarChart";
import { HeatmapChart } from "./HeatmapChart";

type MetricTileData = {
  id: string;
  label: string;
  value: string;
  sublabel?: string;
  icon: ReactNode;
};

type StatsCopy = ReturnType<typeof getStatsCopy>;

const DIMENSIONS: StatsDimension[] = ["day", "week", "month", "year", "lifetime"];

function getStatsCopy(t: TFunction) {
  return {
    pageTitle: t("stats.desktop.pageTitle"),
    pageSubtitle: t("stats.desktop.pageSubtitle"),
    dimensions: {
      day: t("stats.desktop.dimensions.day"),
      week: t("stats.desktop.dimensions.week"),
      month: t("stats.desktop.dimensions.month"),
      year: t("stats.desktop.dimensions.year"),
      lifetime: t("stats.desktop.dimensions.lifetime"),
    } satisfies Record<StatsDimension, string>,
    dimensionTitles: {
      day: t("stats.desktop.dimensionTitles.day"),
      week: t("stats.desktop.dimensionTitles.week"),
      month: t("stats.desktop.dimensionTitles.month"),
      year: t("stats.desktop.dimensionTitles.year"),
      lifetime: t("stats.desktop.dimensionTitles.lifetime"),
    } satisfies Record<StatsDimension, string>,
    readingTime: t("stats.desktop.readingTime"),
    activeDays: t("stats.desktop.activeDays"),
    sessions: t("stats.desktop.sessions"),
    books: t("stats.desktop.books"),
    pages: t("stats.desktop.pages"),
    streak: t("stats.desktop.streak"),
    avgActiveDay: t("stats.desktop.avgActiveDay"),
    longestSession: t("stats.desktop.longestSession"),
    daysTogether: t("stats.desktop.daysTogether"),
    periodNavigationHint: t("stats.desktop.periodNavigationHint"),
    today: t("stats.desktop.today"),
    thisWeek: t("stats.desktop.thisWeek"),
    thisMonth: t("stats.desktop.thisMonth"),
    thisYear: t("stats.desktop.thisYear"),
    journey: t("stats.desktop.journey"),
    journeySubtitle: t("stats.desktop.journeySubtitle"),
    readingCalendar: t("stats.desktop.readingCalendar"),
    readingCalendarDesc: t("stats.desktop.readingCalendarDesc"),
    primaryChart: t("stats.desktop.primaryChart"),
    primaryChartDesc: t("stats.desktop.primaryChartDesc"),
    readingHeatmap: t("stats.desktop.readingHeatmap"),
    readingHeatmapDesc: t("stats.desktop.readingHeatmapDesc"),
    singlePointLabel: t("stats.desktop.singlePointLabel"),
    singlePointDesc: t("stats.desktop.singlePointDesc"),
    topBooks: t("stats.desktop.topBooks"),
    topBooksDesc: t("stats.desktop.topBooksDesc"),
    insights: t("stats.desktop.insights"),
    insightsDesc: t("stats.desktop.insightsDesc"),
    rhythmProfile: t("stats.desktop.rhythmProfile"),
    rhythmProfileDesc: t("stats.desktop.rhythmProfileDesc"),
    timeOfDay: t("stats.desktop.timeOfDay"),
    timeOfDayDesc: t("stats.desktop.timeOfDayDesc"),
    categoryDistribution: t("stats.desktop.categoryDistribution"),
    categoryDistributionDesc: t("stats.desktop.categoryDistributionDesc"),
    annualShelf: t("stats.desktop.annualShelf"),
    annualShelfDesc: t("stats.desktop.annualShelfDesc"),
    milestones: t("stats.desktop.milestones"),
    milestonesDesc: t("stats.desktop.milestonesDesc"),
    sharePreview: t("stats.desktop.sharePreview"),
    sharePreviewDesc: t("stats.desktop.sharePreviewDesc"),
    noDataTitle: t("stats.desktop.noDataTitle"),
    noDataDesc: t("stats.desktop.noDataDesc"),
    noTopBooks: t("stats.desktop.noTopBooks"),
    noInsights: t("stats.desktop.noInsights"),
    noTimeline: t("stats.desktop.noTimeline"),
    noDayTopBook: t("stats.desktop.noDayTopBook"),
    daySummary: t("stats.desktop.daySummary"),
    daySummaryDesc: t("stats.desktop.daySummaryDesc"),
    firstSession: t("stats.desktop.firstSession"),
    lastSession: t("stats.desktop.lastSession"),
    peakHour: t("stats.desktop.peakHour"),
    longestRead: t("stats.desktop.longestRead"),
    topFocus: t("stats.desktop.topFocus"),
    activeNow: t("stats.desktop.activeNow"),
    startedOn: t("stats.desktop.startedOn"),
    activeReadingDays: t("stats.desktop.activeReadingDays"),
    inactiveReadingDays: t("stats.desktop.inactiveReadingDays"),
    companionMessage: t("stats.desktop.companionMessage"),
    exportSoon: t("stats.desktop.exportSoon"),
    pagesReadSuffix: t("stats.desktop.pagesReadSuffix"),
    sessionsSuffix: t("stats.desktop.sessionsSuffix"),
    daysSuffix: t("stats.desktop.daysSuffix"),
    weekPrefix: t("stats.desktop.weekPrefix"),
    weekSuffix: t("stats.desktop.weekSuffix"),
    unknownAuthor: t("stats.desktop.unknownAuthor"),
    journeyNarrative: (days: number) => t("stats.desktop.journeyNarrative", { days }),
    insightTitleNoReading: t("stats.desktop.insightTitleNoReading"),
    insightBodyNoReading: t("stats.desktop.insightBodyNoReading"),
    insightTitleStreak: t("stats.desktop.insightTitleStreak"),
    insightBodyStreak: (days: number) => t("stats.desktop.insightBodyStreak", { days }),
    insightTitleFocus: t("stats.desktop.insightTitleFocus"),
    insightBodyFocus: (minutes: number) => t("stats.desktop.insightBodyFocus", { minutes }),
    insightTitleTopBook: t("stats.desktop.insightTitleTopBook"),
    insightBodyTopBook: (title: string) => t("stats.desktop.insightBodyTopBook", { title }),
    milestoneTitleJoined: t("stats.desktop.milestoneTitleJoined"),
    milestoneBodyJoined: (date: string) => t("stats.desktop.milestoneBodyJoined", { date }),
    heroNarrativeDay: (time: string, sessions: number) =>
      t("stats.desktop.heroNarrativeDay", { time, sessions }),
    heroNarrativeWeek: (days: number, longest: string) =>
      t("stats.desktop.heroNarrativeWeek", { days, longest }),
    heroNarrativeMonth: (time: string, books: number) =>
      t("stats.desktop.heroNarrativeMonth", { time, books }),
    heroNarrativeYear: (time: string, activeDays: number) =>
      t("stats.desktop.heroNarrativeYear", { time, activeDays }),
    heroNarrativeLifetime: (date: string) => t("stats.desktop.heroNarrativeLifetime", { date }),
    chartPeakLabel: (label: string, value: string) =>
      t("stats.desktop.chartPeakLabel", { label, value }),
    topBookLead: t("stats.desktop.topBookLead"),
    heatmapLegendLow: t("stats.desktop.heatmapLegendLow"),
    heatmapLegendHigh: t("stats.desktop.heatmapLegendHigh"),
    uncategorized: t("stats.desktop.uncategorized"),
    timeOfDayLabels: {
      lateNight: t("stats.desktop.timeOfDayLabels.lateNight"),
      earlyMorning: t("stats.desktop.timeOfDayLabels.earlyMorning"),
      morning: t("stats.desktop.timeOfDayLabels.morning"),
      afternoon: t("stats.desktop.timeOfDayLabels.afternoon"),
      evening: t("stats.desktop.timeOfDayLabels.evening"),
      night: t("stats.desktop.timeOfDayLabels.night"),
    },
    loadFailed: t("stats.loadFailed"),
    loading: t("stats.loading"),
    daySessions: (count: number) => t("stats.desktop.daySessions", { count }),
    activeDaysSummary: (count: number) => t("stats.desktop.activeDaysSummary", { count }),
  };
}

function formatMinutes(minutes: number, isZh: boolean): string {
  if (minutes <= 0) return isZh ? "0 分钟" : "0m";
  if (minutes < 60) return isZh ? `${Math.round(minutes)} 分钟` : `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (mins <= 0) return isZh ? `${hours} 小时` : `${hours}h`;
  return isZh ? `${hours} 小时 ${mins} 分钟` : `${hours}h ${mins}m`;
}

function formatCompactMinutes(minutes: number, isZh = false): string {
  if (minutes <= 0) return isZh ? "0分" : "0m";
  if (minutes < 60) return isZh ? `${Math.round(minutes)}分` : `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (isZh) {
    return mins > 0 ? `${hours}时${mins}分` : `${hours}时`;
  }
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatChartMinutes(minutes: number, isZh: boolean): string {
  if (minutes <= 0) return isZh ? "0分" : "0m";
  if (minutes < 60) return isZh ? `${Math.round(minutes)}分` : `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return isZh ? (mins > 0 ? `${hours}时${mins}分` : `${hours}时`) : mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
}

function formatClock(timestamp: number | undefined, isZh: boolean): string {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat(isZh ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: !isZh,
  }).format(new Date(timestamp));
}

function formatDateLabel(dateKey: string | undefined, isZh: boolean): string {
  if (!dateKey) return "—";
  const date = fromLocalDateKey(dateKey);
  return new Intl.DateTimeFormat(isZh ? "zh-CN" : "en-US", {
    year: "numeric",
    month: isZh ? "long" : "short",
    day: "numeric",
  }).format(date);
}

function formatPeriodLabel(report: StatsReport, isZh: boolean, copy: StatsCopy): string {
  if (report.dimension === "day") {
    return formatDateLabel(report.period.startDate, isZh);
  }

  if (report.dimension === "week") {
    const start = formatDateLabel(report.period.startDate, isZh);
    const end = formatDateLabel(report.period.endDate, isZh);
    const weekKey = report.period.key.split("W")[1] ?? "";
    return isZh
      ? `${start} - ${end} · ${copy.weekPrefix}${weekKey}${copy.weekSuffix}`
      : `${copy.weekPrefix}${weekKey}${copy.weekSuffix} · ${start} - ${end}`;
  }

  if (report.dimension === "month") {
    const date = fromLocalDateKey(report.period.startDate);
    return new Intl.DateTimeFormat(isZh ? "zh-CN" : "en-US", {
      year: "numeric",
      month: isZh ? "long" : "long",
    }).format(date);
  }

  if (report.dimension === "year") {
    return report.period.key;
  }

  return `${copy.companionMessage} ${(report.context.daysSinceJoined || 0).toLocaleString()} ${copy.daysSuffix}`;
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toMonthInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function shiftAnchorDate(date: Date, dimension: StatsDimension, delta: -1 | 1): Date {
  const next = new Date(date);
  if (dimension === "day") {
    next.setDate(next.getDate() + delta);
    return next;
  }
  if (dimension === "week") {
    next.setDate(next.getDate() + delta * 7);
    return next;
  }
  if (dimension === "month") {
    next.setMonth(next.getMonth() + delta);
    return next;
  }
  if (dimension === "year") {
    next.setFullYear(next.getFullYear() + delta);
  }
  return next;
}

function intensityClass(level: StatsCalendarCell["intensity"], inCurrentMonth: boolean): string {
  if (!inCurrentMonth && level === 0) {
    return "border-border/40 bg-muted/30 text-muted-foreground";
  }

  const palette = [
    "border-border bg-card/80 text-foreground",
    "border-primary/10 bg-primary/5 text-foreground",
    "border-primary/15 bg-primary/10 text-foreground",
    "border-primary/20 bg-primary/15 text-foreground",
    "border-primary/30 bg-primary/20 text-foreground",
  ] as const;

  return cn(palette[level], !inCurrentMonth && "opacity-70");
}

function buildHeroMetrics(report: StatsReport, copy: StatsCopy, isZh: boolean): MetricTileData[] {
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
      sublabel:
        report.dimension === "lifetime"
          ? `${copy.longestSession} ${formatMinutes(report.summary.longestSessionTime, isZh)}`
          : `${copy.longestSession} ${formatMinutes(report.summary.longestSessionTime, isZh)}`,
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

function localizeInsight(
  insight: StatsInsight,
  report: StatsReport,
  copy: StatsCopy,
  isZh: boolean,
): StatsInsight {
  if (insight.id === "no-reading") {
    return { ...insight, title: copy.insightTitleNoReading, body: copy.insightBodyNoReading };
  }
  if (insight.id === "streak") {
    return {
      ...insight,
      title: copy.insightTitleStreak,
      body: copy.insightBodyStreak(report.summary.currentStreak),
    };
  }
  if (insight.id === "focus") {
    return {
      ...insight,
      title: copy.insightTitleFocus,
      body: copy.insightBodyFocus(Math.round(report.summary.longestSessionTime)),
    };
  }
  if (insight.id === "top-book") {
    return {
      ...insight,
      title: copy.insightTitleTopBook,
      body: copy.insightBodyTopBook(report.topBooks[0]?.title ?? copy.noDayTopBook),
    };
  }
  if (insight.id === "joined" && report.dimension === "lifetime") {
    return {
      ...insight,
      title: copy.milestoneTitleJoined,
      body: copy.milestoneBodyJoined(formatDateLabel(report.context.joinedSince, isZh)),
    };
  }
  return insight;
}

function buildHeroNarrative(report: StatsReport, copy: StatsCopy, isZh: boolean): string {
  if (report.dimension === "day") {
    return copy.heroNarrativeDay(
      formatMinutes(report.summary.totalReadingTime, isZh),
      report.summary.totalSessions,
    );
  }

  if (report.dimension === "week") {
    return copy.heroNarrativeWeek(
      report.summary.activeDays,
      formatMinutes(report.summary.longestSessionTime, isZh),
    );
  }

  if (report.dimension === "month") {
    return copy.heroNarrativeMonth(
      formatMinutes(report.summary.totalReadingTime, isZh),
      report.summary.booksTouched,
    );
  }

  if (report.dimension === "year") {
    return copy.heroNarrativeYear(
      formatMinutes(report.summary.totalReadingTime, isZh),
      report.summary.activeDays,
    );
  }

  return copy.heroNarrativeLifetime(formatDateLabel(report.context.joinedSince, isZh));
}

function getPeakChartDatum(chart: StatsChartBlock): StatsChartBlock["data"][number] | null {
  if (chart.data.length === 0) return null;
  const strongest = [...chart.data].sort((a, b) => b.value - a.value)[0];
  return strongest && strongest.value > 0 ? strongest : null;
}

function localizeSemanticLabel(key: string, fallback: string, copy: StatsCopy): string {
  if (key === "__uncategorized__") {
    return copy.uncategorized;
  }

  if (key in copy.timeOfDayLabels) {
    return copy.timeOfDayLabels[key as keyof typeof copy.timeOfDayLabels];
  }

  return fallback;
}

export function ReadingStatsPanel() {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const copy = useMemo(() => getStatsCopy(t), [t, i18n.language]);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const saveCurrentSession = useReadingSessionStore((s) => s.saveCurrentSession);
  const currentSession = useReadingSessionStore((s) => s.currentSession);

  const [dimension, setDimension] = useState<StatsDimension>("month");
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [report, setReport] = useState<StatsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      void saveCurrentSession().finally(() => {
        void loadReport();
      });
    }
  }, [activeTabId, saveCurrentSession, loadReport]);

  useEffect(() => {
    return eventBus.on("sync:completed", () => {
      if (activeTabId !== "stats") return;
      void loadReport();
    });
  }, [activeTabId, loadReport]);

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

  const onPickPeriod = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    if (!value) return;

    if (dimension === "day" || dimension === "week") {
      setAnchorDate(getWeekStartDate(value) && dimension === "week" ? getWeekStartDate(value) : new Date(value));
      if (dimension === "day") {
        setAnchorDate(new Date(value));
      }
      return;
    }

    if (dimension === "month") {
      const [year, month] = value.split("-").map(Number);
      setAnchorDate(new Date(year, (month || 1) - 1, 1));
      return;
    }

    if (dimension === "year") {
      const nextYear = Number(value);
      if (!Number.isNaN(nextYear)) {
        setAnchorDate(new Date(nextYear, 0, 1));
      }
    }
  };

  const resetToCurrentPeriod = () => {
    setAnchorDate(new Date());
  };

  const currentPickerValue =
    dimension === "month"
      ? toMonthInputValue(anchorDate)
      : dimension === "year"
        ? String(anchorDate.getFullYear())
        : toDateInputValue(anchorDate);

  return (
    <TooltipProvider delayDuration={120}>
      <div className="h-full min-w-0 overflow-y-auto overflow-x-hidden bg-background px-4 py-4 sm:px-6 sm:py-6">
        <div className="mx-auto flex w-full min-w-0 max-w-[1320px] flex-col gap-6 lg:gap-8">
          <header className="space-y-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[30px]">
                  {copy.pageTitle}
                </h1>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{copy.pageSubtitle}</p>
              </div>

              <div className="inline-flex w-full max-w-full rounded-full border border-border/70 bg-muted/55 p-1 lg:w-auto">
                {DIMENSIONS.map((item) => (
                  <button
                    key={item}
                    className={cn(
                      "min-w-0 flex-1 rounded-full px-3 py-2 text-sm font-medium transition-all lg:flex-none lg:px-4",
                      dimension === item
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setDimension(item)}
                  >
                    {copy.dimensions[item]}
                  </button>
                ))}
              </div>
            </div>
          </header>

          {loading ? (
            <div className="flex min-h-[48vh] items-center justify-center rounded-[32px] border border-border bg-card/80 shadow-around">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-foreground" />
                {copy.loading}
              </div>
            </div>
          ) : error || !report ? (
            <SectionCard className="min-h-[48vh]">
              <EmptyState
                title={error ?? copy.noDataTitle}
                description={copy.noDataDesc}
                icon={<ScanSearch className="h-8 w-8 text-muted-foreground" />}
              />
            </SectionCard>
          ) : (
            <>
              <section className="overflow-hidden rounded-[32px] border border-border/70 bg-card/85 px-5 py-5 shadow-[0_20px_60px_-45px_rgba(122,91,42,0.45)] sm:px-6 sm:py-6">
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="space-y-1">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                        {copy.dimensionTitles[dimension]}
                      </div>
                      <div className="text-lg font-semibold text-foreground sm:text-xl">{periodLabel}</div>
                    </div>

                    {dimension !== "lifetime" && (
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center rounded-full border border-border bg-background/80 p-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                            onClick={() => setAnchorDate((prev) => shiftAnchorDate(prev, dimension, -1))}
                            disabled={!report.navigation.canGoPrev}
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                            onClick={() => setAnchorDate((prev) => shiftAnchorDate(prev, dimension, 1))}
                            disabled={!report.navigation.canGoNext}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>

                        {dimension === "year" ? (
                          <input
                            type="number"
                            min="2000"
                            max={String(new Date().getFullYear())}
                            value={currentPickerValue}
                            onChange={onPickPeriod}
                            className="h-10 w-28 rounded-full border border-input bg-background px-4 text-sm text-foreground outline-none transition-colors focus:border-ring"
                          />
                        ) : (
                          <input
                            type={dimension === "month" ? "month" : "date"}
                            value={currentPickerValue}
                            onChange={onPickPeriod}
                            className="h-10 rounded-full border border-input bg-background px-4 text-sm text-foreground outline-none transition-colors focus:border-ring"
                          />
                        )}

                        <Button
                          variant="soft"
                          size="sm"
                          className="rounded-full border border-border bg-muted px-4 text-foreground hover:bg-muted/80"
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

                  <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
                    <div className="min-w-0 space-y-4">
                      {headlineMetric && (
                        <div className="space-y-2">
                          <div className="text-5xl font-semibold tracking-tight text-foreground sm:text-6xl">
                            {headlineMetric.value}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {headlineMetric.label}
                            {headlineMetric.sublabel ? ` · ${headlineMetric.sublabel}` : ""}
                          </div>
                        </div>
                      )}
                      <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{heroNarrative}</p>
                    </div>

                    <section className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-2">
                      {supportMetrics.map((metric) => (
                        <MetricTile key={metric.id} metric={metric} />
                      ))}
                    </section>
                  </div>
                </div>
              </section>

              <div className="grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1.1fr)_360px]">
                <div className="min-w-0 space-y-8">
                  {report.dimension === "day" && (
                    <SectionCard>
                      <SectionHeader title={copy.daySummary} description={copy.daySummaryDesc} />
                      <DaySummaryPanel
                        dayFact={report.dayFact}
                        topBook={report.topBooks[0]}
                        copy={copy}
                        isZh={isZh}
                      />
                    </SectionCard>
                  )}

                  {primaryChart && (
                    <SectionCard>
                      <SectionHeader title={primaryChartTitle} description={primaryChartDesc} />
                      <ChartSurface chart={primaryChart} copy={copy} isZh={isZh} />
                    </SectionCard>
                  )}

                  {monthlyReport?.readingCalendar && (
                    <SectionCard>
                      <SectionHeader
                        title={copy.readingCalendar}
                        description={copy.readingCalendarDesc}
                      />
                      <MonthCalendarSection calendar={monthlyReport.readingCalendar} isZh={isZh} />
                    </SectionCard>
                  )}

                  {yearOrLifetimeReport &&
                    (yearOrLifetimeReport.timeOfDayChart || yearOrLifetimeReport.categoryDistribution) && (
                      <SectionCard>
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
                      </SectionCard>
                    )}

                  {report.dimension === "lifetime" && report.yearlySnapshots.length > 0 && (
                    <SectionCard>
                      <SectionHeader title={copy.annualShelf} description={copy.annualShelfDesc} />
                      <YearlySnapshotsSection
                        snapshots={report.yearlySnapshots}
                        copy={copy}
                        isZh={isZh}
                      />
                    </SectionCard>
                  )}

                  {report.dimension === "lifetime" && (
                    <SectionCard>
                      <SectionHeader title={copy.journey} description={copy.journeySubtitle} />
                      <JourneySummaryPanel report={report} copy={copy} isZh={isZh} />
                    </SectionCard>
                  )}
                </div>

                <aside className="min-w-0 space-y-8">
                  <SectionCard>
                    <SectionHeader title={copy.topBooks} description={copy.topBooksDesc} />
                    <TopBooksSection books={report.topBooks} copy={copy} isZh={isZh} />
                  </SectionCard>

                  <SectionCard>
                    <SectionHeader title={copy.insights} description={copy.insightsDesc} />
                    <InsightsSection insights={localizedInsights} copy={copy} />
                  </SectionCard>

                  {report.dimension === "lifetime" && localizedMilestones.length > 0 && (
                    <SectionCard>
                      <SectionHeader title={copy.milestones} description={copy.milestonesDesc} />
                      <InsightsSection insights={localizedMilestones} copy={copy} />
                    </SectionCard>
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

function SectionCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-[30px] border border-border/70 bg-card/85 px-5 py-5 shadow-[0_20px_60px_-45px_rgba(122,91,42,0.45)] sm:px-6 sm:py-6",
        className,
      )}
    >
      {children}
    </section>
  );
}

function SectionHeader({
  title,
  description,
  icon,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
        </div>
        {description && <p className="text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}

function MetricTile({ metric }: { metric: MetricTileData }) {
  return (
    <div className="min-w-0 border-b border-border/70 py-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        <span className="text-muted-foreground/80">{metric.icon}</span>
        <span>{metric.label}</span>
      </div>
      <div className="mt-3 space-y-1">
        <div className="truncate text-[28px] font-semibold tracking-tight text-foreground">{metric.value}</div>
        {metric.sublabel && <p className="text-sm text-muted-foreground">{metric.sublabel}</p>}
      </div>
    </div>
  );
}

function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 text-center">
      <div className="rounded-full border border-border bg-muted/70 p-5">{icon}</div>
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <p className="max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function ChartSurface({
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
        {peak && (
          <div className="inline-flex max-w-full rounded-full bg-primary/[0.08] px-4 py-2 text-sm font-medium text-foreground">
            {copy.chartPeakLabel(peak.label, formatMinutes(peak.value, isZh))}
          </div>
        )}
      </div>
    );
  }

  if (chart.data.length <= 1) {
    const point = chart.data[0];

    if (!point) {
      return (
        <div className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
          {copy.noDataDesc}
        </div>
      );
    }

    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end">
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{copy.singlePointLabel}</div>
          <div className="text-4xl font-semibold tracking-tight text-foreground">{formatMinutes(point.value, isZh)}</div>
          <div className="text-sm text-muted-foreground">{point.label}</div>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">{copy.singlePointDesc}</p>
        </div>
        <div className="rounded-[22px] bg-primary/[0.06] px-4 py-4">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{copy.primaryChart}</div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-background/80">
            <div className="h-full w-full rounded-full bg-primary/70" />
          </div>
          <div className="mt-3 text-xs leading-5 text-muted-foreground">{copy.readingTime}</div>
        </div>
      </div>
    );
  }

  const peak = getPeakChartDatum(chart);

  return (
    <div className="space-y-5">
      <div className="rounded-[24px] bg-gradient-to-b from-primary/[0.08] via-transparent to-transparent px-2 py-2">
        <BarChart
          data={chart.data.map((item) => ({ label: item.label, value: item.value }))}
          height={220}
          emptyMessage={copy.noDataDesc}
          formatValue={(value) => formatChartMinutes(value, isZh)}
        />
      </div>
      {peak && (
        <div className="inline-flex max-w-full rounded-full bg-primary/[0.08] px-4 py-2 text-sm font-medium text-foreground">
          {copy.chartPeakLabel(peak.label, formatMinutes(peak.value, isZh))}
        </div>
      )}
    </div>
  );
}

function RhythmProfileSection({
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
  const columns = [timeOfDayChart ? "time" : null, categoryChart ? "category" : null].filter(Boolean)
    .length;

  return (
    <div
      className={cn(
        "grid gap-6",
        columns === 2 ? "xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]" : "grid-cols-1",
      )}
    >
      {timeOfDayChart && (
        <div className={cn("space-y-4", categoryChart && "xl:border-r xl:border-border/60 xl:pr-6")}>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">{copy.timeOfDay}</h3>
            <p className="text-sm leading-6 text-muted-foreground">{copy.timeOfDayDesc}</p>
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
        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">{copy.categoryDistribution}</h3>
            <p className="text-sm leading-6 text-muted-foreground">{copy.categoryDistributionDesc}</p>
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
        const width = `${Math.max(10, (item.value / maxValue) * 100)}%`;

        return (
          <div key={`${item.key}-${index}`} className="space-y-2">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0 text-sm font-medium text-foreground">{label}</div>
              <div className="flex-shrink-0 text-sm text-muted-foreground">
                {formatCompactMinutes(item.value, isZh)}
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted/70">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary/45 to-primary/80"
                style={{ width }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function YearlySnapshotsSection({
  snapshots,
  copy,
  isZh,
}: {
  snapshots: Extract<StatsReport, { dimension: "lifetime" }>["yearlySnapshots"];
  copy: StatsCopy;
  isZh: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {snapshots.map((snapshot) => (
        <article key={snapshot.year} className="border-b border-border/70 pb-4">
          <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{snapshot.year}</div>
          <div className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
            {formatCompactMinutes(snapshot.totalReadingTime, isZh)}
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            {snapshot.booksTouched.toLocaleString()} {copy.books}
          </div>
          <div className="text-sm text-muted-foreground">
            {snapshot.activeDays.toLocaleString()} {copy.activeDays}
          </div>
          {snapshot.topBook && (
            <div className="mt-4 flex items-center gap-3">
              <CoverThumb
                title={snapshot.topBook.title}
                coverUrl={snapshot.topBook.coverUrl}
                className="h-16 w-12 rounded-xl shadow-md"
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{snapshot.topBook.title}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {formatCompactMinutes(snapshot.topBook.totalTime, isZh)}
                </div>
              </div>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function DaySummaryPanel({
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
    return <EmptyState title={copy.noDataTitle} description={copy.noDataDesc} icon={<Clock3 className="h-8 w-8 text-muted-foreground" />} />;
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
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {facts.map((item) => (
          <div
            key={item.label}
            className="border-b border-border/70 px-1 pb-3"
          >
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{item.label}</div>
            <div className="mt-2 text-lg font-semibold text-foreground">{item.value}</div>
          </div>
        ))}
      </div>

      <div className="border-l-2 border-primary/25 pl-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-[0.16em] text-primary/70">{copy.topFocus}</div>
            <div className="text-xl font-semibold text-foreground">
              {topBook?.title ?? copy.noDayTopBook}
            </div>
            <div className="text-sm text-muted-foreground">
              {topBook ? formatMinutes(topBook.totalTime, isZh) : copy.noTimeline}
            </div>
          </div>
          {dayFact.date === toDateInputValue(new Date()) && (
            <div className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              {copy.activeNow}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function JourneySummaryPanel({
  report,
  copy,
  isZh,
}: {
  report: Extract<StatsReport, { dimension: "lifetime" }>;
  copy: StatsCopy;
  isZh: boolean;
}) {
  const metrics = [
    {
      label: copy.daysTogether,
      value: `${report.context.daysSinceJoined.toLocaleString()} ${copy.daysSuffix}`,
    },
    {
      label: copy.activeReadingDays,
      value: `${report.context.totalActiveDays.toLocaleString()} ${copy.daysSuffix}`,
    },
    {
      label: copy.inactiveReadingDays,
      value: `${report.context.totalInactiveDays.toLocaleString()} ${copy.daysSuffix}`,
    },
    {
      label: copy.startedOn,
      value: formatDateLabel(report.context.joinedSince, isZh),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="border-l-2 border-primary/25 pl-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <div className="text-sm uppercase tracking-[0.18em] text-muted-foreground">{copy.journey}</div>
            <div className="text-3xl font-semibold tracking-tight text-foreground">
              {report.context.daysSinceJoined.toLocaleString()} {copy.daysSuffix}
            </div>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              {copy.journeyNarrative(report.context.daysSinceJoined)}
            </p>
          </div>
          <div className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            {copy.startedOn} {formatDateLabel(report.context.joinedSince, isZh)}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((item) => (
          <div
            key={item.label}
            className="border-b border-border/70 px-1 pb-3"
          >
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{item.label}</div>
            <div className="mt-2 text-lg font-semibold text-foreground">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthCalendarSection({
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
      <div className="grid grid-cols-7 gap-2 sm:gap-3">
        {weekLabels.map((label) => (
          <div key={label} className="px-1.5 text-[11px] font-medium text-muted-foreground sm:px-2 sm:text-xs">
            {label}
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {calendar.weeks.map((week, index) => (
          <div key={`${calendar.monthKey}-${index}`} className="grid grid-cols-7 gap-2 sm:gap-3">
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
            "relative min-h-[88px] min-w-0 rounded-[20px] border p-2.5 shadow-sm transition-transform hover:-translate-y-0.5 sm:min-h-[102px] sm:rounded-[22px] sm:p-3",
            intensityClass(cell.intensity, cell.inCurrentMonth),
            cell.isToday && "ring-2 ring-primary/30",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className={cn("text-sm font-semibold text-foreground", !cell.inCurrentMonth && "text-muted-foreground/70")}>
              {cell.dayOfMonth}
            </div>
            {cell.totalTime > 0 && (
              <div className="rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-medium text-foreground shadow-xs">
                {formatCompactMinutes(cell.totalTime, isZh)}
              </div>
            )}
          </div>

          <div className="mt-2 text-[11px] leading-5 text-muted-foreground sm:mt-3">
            {cell.totalTime > 0
              ? copy.daySessions(cell.sessionsCount)
              : "\u00A0"}
          </div>

          {cell.covers.length > 0 && (
            <div className="absolute bottom-3 left-3 flex items-end">
              {cell.covers.slice(0, 3).map((cover, index) => (
                <div
                  key={`${cover.bookId}-${index}`}
                  className={cn(
                    "relative",
                    index > 0 && "-ml-2",
                  )}
                  style={{ zIndex: 5 - index }}
                >
                  <CoverThumb
                    title={cover.title}
                    coverUrl={cover.coverUrl}
                    className="h-8 w-6 rounded-md border border-background/90 shadow-md sm:h-9 sm:w-7"
                    fallbackClassName="text-[9px] font-semibold"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px] rounded-xl border border-border bg-popover px-3 py-2 text-popover-foreground shadow-xl">
        <div className="space-y-1">
          <div className="text-xs font-medium">{tooltipText}</div>
          {cell.covers.length > 0 && (
            <div className="text-[11px] text-muted-foreground">
              {cell.covers.map((cover) => cover.title).join(" · ")}
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function CoverThumb({
  title,
  coverUrl,
  className,
  fallbackClassName,
}: {
  title: string;
  coverUrl?: string;
  className?: string;
  fallbackClassName?: string;
}) {
  const resolved = useResolvedSrc(coverUrl);

  return (
    <div className={cn("overflow-hidden bg-muted/80", className)}>
      {resolved ? (
        <img src={resolved} alt="" className="h-full w-full object-cover" />
      ) : (
        <div
          className={cn(
            "flex h-full w-full items-center justify-center bg-muted text-center text-[10px] font-semibold text-muted-foreground",
            fallbackClassName,
          )}
        >
          {title.trim().slice(0, 1)}
        </div>
      )}
    </div>
  );
}

function TopBooksSection({
  books,
  copy,
  isZh,
}: {
  books: TopBookEntry[];
  copy: StatsCopy;
  isZh: boolean;
}) {
  if (books.length === 0) {
    return <p className="text-sm leading-6 text-muted-foreground">{copy.noTopBooks}</p>;
  }

  return (
    <div className="space-y-3">
      {books.slice(0, 5).map((book, index) => (
        <article
          key={book.bookId}
          className={cn(
            "flex min-w-0 items-center gap-3 py-3",
            index === 0
              ? "rounded-[24px] bg-primary/[0.06] px-4 py-4"
              : "border-b border-border/70",
          )}
        >
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
            {String(index + 1).padStart(2, "0")}
          </div>
          <CoverThumb
            title={book.title}
            coverUrl={book.coverUrl}
            className={cn("rounded-xl shadow-md", index === 0 ? "h-20 w-14" : "h-16 w-12")}
          />

          <div className="min-w-0 flex-1">
            {index === 0 && (
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-primary/75">
                {copy.topBookLead}
              </div>
            )}
            <div className={cn("truncate font-semibold text-foreground", index === 0 ? "text-base" : "text-sm")}>
              {book.title}
            </div>
            <div className="truncate text-xs text-muted-foreground">{book.author || copy.unknownAuthor}</div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className={cn("font-semibold text-foreground", index === 0 ? "text-2xl" : "text-base")}>
                {formatCompactMinutes(book.totalTime, isZh)}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {book.pagesRead.toLocaleString()} {copy.pagesReadSuffix} · {book.sessionsCount.toLocaleString()} {copy.sessionsSuffix}
              </span>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function InsightsSection({ insights, copy }: { insights: StatsInsight[]; copy: StatsCopy }) {
  if (insights.length === 0) {
    return <p className="text-sm leading-6 text-muted-foreground">{copy.noInsights}</p>;
  }

  return (
    <div className="space-y-4">
      {insights.map((insight, index) => (
        <div
          key={insight.id}
          className="grid grid-cols-[16px_minmax(0,1fr)] gap-3 border-b border-border/60 pb-4 last:border-b-0 last:pb-0"
        >
          <div className="flex items-start justify-center pt-1">
            <div
              className={cn(
                "mt-1 h-2.5 w-2.5 rounded-full bg-border",
                insight.tone === "celebration" && "bg-primary",
                insight.tone === "warning" && "bg-destructive/70",
                insight.tone === "positive" && "bg-primary/70",
              )}
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="text-sm font-semibold text-foreground">{insight.title}</div>
            </div>
            <div className="text-sm leading-6 text-muted-foreground">{insight.body}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
