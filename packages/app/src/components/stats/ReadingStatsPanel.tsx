import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { readingStatsService } from "@/lib/stats/reading-stats";
import type { DailyStats, OverallStats, PeriodBookStats, TrendPoint } from "@/lib/stats/reading-stats";
import { BookOpen, ChevronLeft, ChevronRight, Clock, Flame, TrendingUp } from "lucide-react";
/**
 * ReadingStatsPanel — displays reading statistics with charts, heatmap and book list
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/app-store";
import { useReadingSessionStore } from "@/stores/reading-session-store";
import { BarChart } from "./BarChart";
import { TrendChart } from "./TrendChart";
import { PeriodBookList } from "./PeriodBookList";

type ChartMode = "week" | "month";
type ChartView = "heatmap" | "bar";

/** Get the Monday of the week containing `date` */
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = 1
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Get the Sunday of the week starting on `weekStart` */
function getWeekEnd(weekStart: Date): Date {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Get first day of month */
function getMonthStart(year: number, month: number): Date {
  return new Date(year, month, 1);
}

/** Get last day of month */
function getMonthEnd(year: number, month: number): Date {
  return new Date(year, month + 1, 0, 23, 59, 59, 999);
}

export function ReadingStatsPanel() {
  const { t, i18n } = useTranslation();
  const activeTabId = useAppStore((s) => s.activeTabId);
  const saveCurrentSession = useReadingSessionStore((s) => s.saveCurrentSession);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [overall, setOverall] = useState<OverallStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Chart state
  const [chartView, setChartView] = useState<ChartView>("heatmap");
  const [chartMode, setChartMode] = useState<ChartMode>("week");
  const [chartDate, setChartDate] = useState<Date>(() => getWeekStart(new Date()));
  const [chartData, setChartData] = useState<DailyStats[]>([]);
  const [periodBooks, setPeriodBooks] = useState<PeriodBookStats[]>([]);
  const [trendData, setTrendData] = useState<TrendPoint[]>([]);

  const lang = i18n.language;

  useEffect(() => {
    if (activeTabId === "stats") {
      saveCurrentSession().then(() => loadStats());
    }
  }, [activeTabId]);

  // Load chart data when mode or date changes
  useEffect(() => {
    if (activeTabId === "stats" && !loading) {
      loadChartData();
    }
  }, [chartMode, chartDate, activeTabId]);

  const loadStats = async () => {
    setLoading(true);
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 365);

      const [daily, overallStats, trend] = await Promise.all([
        readingStatsService.getDailyStats(startDate, endDate),
        readingStatsService.getOverallStats(),
        readingStatsService.getRecentTrend(30),
      ]);

      setDailyStats(daily);
      setOverall(overallStats);
      setTrendData(trend);
    } catch {
      // Stats may fail if DB isn't initialized
    }
    setLoading(false);
    // Load chart data after base stats are ready
    loadChartData();
  };

  const loadChartData = async () => {
    try {
      let barData: DailyStats[];
      let periodStart: Date;
      let periodEnd: Date;

      if (chartMode === "week") {
        barData = await readingStatsService.getWeeklyStats(chartDate);
        periodStart = chartDate;
        periodEnd = getWeekEnd(chartDate);
      } else {
        const year = chartDate.getFullYear();
        const month = chartDate.getMonth();
        barData = await readingStatsService.getMonthlyStats(year, month);
        periodStart = getMonthStart(year, month);
        periodEnd = getMonthEnd(year, month);
      }

      setChartData(barData);

      const books = await readingStatsService.getBookStatsForPeriod(periodStart, periodEnd);
      setPeriodBooks(books);
    } catch {
      // ignore
    }
  };

  // Chart date navigation
  const navigatePeriod = (direction: -1 | 1) => {
    setChartDate((prev) => {
      const d = new Date(prev);
      if (chartMode === "week") {
        d.setDate(d.getDate() + direction * 7);
      } else {
        d.setMonth(d.getMonth() + direction);
      }
      return d;
    });
  };

  const switchChartMode = (mode: ChartMode) => {
    setChartMode(mode);
    if (mode === "week") {
      setChartDate(getWeekStart(new Date()));
    } else {
      const now = new Date();
      setChartDate(new Date(now.getFullYear(), now.getMonth(), 1));
    }
  };

  // Format the current period label
  const periodLabel = useMemo(() => {
    if (chartMode === "week") {
      const end = getWeekEnd(chartDate);
      const fmt = (d: Date) =>
        d.toLocaleDateString(lang === "zh" ? "zh-CN" : "en", { month: "short", day: "numeric" });
      return `${fmt(chartDate)} – ${fmt(end)}`;
    }
    return chartDate.toLocaleDateString(lang === "zh" ? "zh-CN" : "en", {
      year: "numeric",
      month: "long",
    });
  }, [chartDate, chartMode, lang]);

  // Transform DailyStats → BarChart data
  const barChartData = useMemo(() => {
    if (chartMode === "week") {
      const dayNames =
        lang === "zh"
          ? ["一", "二", "三", "四", "五", "六", "日"]
          : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      return chartData.map((d, i) => ({
        label: dayNames[i] || d.date.slice(5),
        value: d.totalTime,
      }));
    }
    // Month mode: show day numbers
    return chartData.map((d) => ({
      label: String(new Date(d.date).getDate()),
      value: d.totalTime,
    }));
  }, [chartData, chartMode, lang]);

  // Transform TrendPoint → TrendChart data
  const trendChartData = useMemo(
    () => trendData.map((p) => ({ date: p.date, value: p.dailyTime })),
    [trendData],
  );

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
      </div>
    );
  }

  return (
    <div className="h-full space-y-6 overflow-auto p-6">
      {/* Page Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-neutral-900">{t("stats.title")}</h1>
        <p className="text-sm text-neutral-500">{t("stats.subtitle")}</p>
      </div>

      {/* Stat Cards Grid */}
      {overall && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<BookOpen className="h-4 w-4" />}
            title={t("stats.booksRead")}
            value={String(overall.totalBooks)}
            description={t("stats.booksReadDesc")}
          />
          <StatCard
            icon={<Clock className="h-4 w-4" />}
            title={t("stats.totalTime")}
            value={formatTime(overall.totalReadingTime)}
            description={t("stats.totalTimeDesc")}
          />
          <StatCard
            icon={<Flame className="h-4 w-4" />}
            title={t("stats.currentStreak")}
            value={`${overall.currentStreak}d`}
            description={t("stats.currentStreakDesc")}
          />
          <StatCard
            icon={<TrendingUp className="h-4 w-4" />}
            title={t("stats.avgDaily")}
            value={formatTime(overall.avgDailyTime)}
            description={t("stats.avgDailyDesc")}
          />
        </div>
      )}

      {/* Heatmap / Bar Chart Section (switchable) */}
      <div className="rounded-xl border border-neutral-150 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-neutral-900">{t("stats.heatmapTitle")}</h3>
            {chartView === "heatmap" && (
              <p className="text-xs text-neutral-500">{t("stats.heatmapDesc")}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Heatmap / Bar toggle */}
            <div className="flex rounded-lg border border-neutral-200 bg-neutral-50 p-0.5">
              <button
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  chartView === "heatmap"
                    ? "bg-white text-neutral-900 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-700"
                }`}
                onClick={() => setChartView("heatmap")}
              >
                {t("stats.viewHeatmap")}
              </button>
              <button
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  chartView === "bar"
                    ? "bg-white text-neutral-900 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-700"
                }`}
                onClick={() => setChartView("bar")}
              >
                {t("stats.viewBarChart")}
              </button>
            </div>

            {/* Week/Month toggle + date navigation (only for bar view) */}
            {chartView === "bar" && (
              <>
                <div className="flex rounded-lg border border-neutral-200 bg-neutral-50 p-0.5">
                  <button
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      chartMode === "week"
                        ? "bg-white text-neutral-900 shadow-sm"
                        : "text-neutral-500 hover:text-neutral-700"
                    }`}
                    onClick={() => switchChartMode("week")}
                  >
                    {t("stats.periodWeek")}
                  </button>
                  <button
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      chartMode === "month"
                        ? "bg-white text-neutral-900 shadow-sm"
                        : "text-neutral-500 hover:text-neutral-700"
                    }`}
                    onClick={() => switchChartMode("month")}
                  >
                    {t("stats.periodMonth")}
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
                    onClick={() => navigatePeriod(-1)}
                    title={t("stats.prevPeriod")}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="min-w-[120px] text-center text-xs font-medium text-neutral-600">
                    {periodLabel}
                  </span>
                  <button
                    className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
                    onClick={() => navigatePeriod(1)}
                    title={t("stats.nextPeriod")}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Chart content */}
        {chartView === "heatmap" ? (
          <>
            <HeatmapChart dailyStats={dailyStats} lang={lang} />
            <HeatmapLegend />
          </>
        ) : (
          <BarChart data={barChartData} height={200} emptyMessage={t("stats.noData")} />
        )}
      </div>

      {/* Trend Chart Section */}
      <div className="rounded-xl border border-neutral-150 p-5">
        <div className="mb-4 space-y-1">
          <h3 className="text-base font-semibold text-neutral-900">{t("stats.trendTitle")}</h3>
          <p className="text-xs text-neutral-500">{t("stats.trendDesc")}</p>
        </div>
        <TrendChart data={trendChartData} height={160} emptyMessage={t("stats.noData")} />
      </div>

      {/* Period Book List */}
      <div className="rounded-xl border border-neutral-150 p-5">
        <div className="mb-4 space-y-1">
          <h3 className="text-base font-semibold text-neutral-900">{t("stats.periodBooks")}</h3>
        </div>
        <PeriodBookList books={periodBooks} />
      </div>

      {/* Longest Streak */}
      {overall && overall.longestStreak > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-neutral-150 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50">
            <Flame className="h-5 w-5 text-orange-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-neutral-900">
              {t("stats.longestStreak", { days: overall.longestStreak })}
            </p>
            <p className="text-xs text-neutral-500">{t("stats.longestStreakDesc")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Heatmap Chart ── */

function HeatmapChart({ dailyStats, lang }: { dailyStats: DailyStats[]; lang: string }) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [cellSize, setCellSize] = useState(12);
  const gap = 2;
  const labelWidth = 28;

  const updateSize = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const availableWidth = el.clientWidth - labelWidth;
    const computed = Math.floor((availableWidth + gap) / 53 - gap);
    setCellSize(Math.max(6, Math.min(computed, 16)));
  }, []);

  useEffect(() => {
    updateSize();
    const observer = new ResizeObserver(updateSize);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [updateSize]);

  const unit = cellSize + gap;

  const { weeks, monthLabels } = useMemo(() => {
    const statsMap = new Map<string, number>();
    for (const s of dailyStats) {
      statsMap.set(s.date, s.totalTime);
    }

    const today = new Date();
    const todayDay = today.getDay();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - (52 * 7 + todayDay));

    const weeksArr: Array<Array<{ date: string; time: number; dayOfWeek: number }>> = [];
    const mLabels: Array<{ label: string; col: number }> = [];
    let currentWeek: Array<{ date: string; time: number; dayOfWeek: number }> = [];
    let lastMonth = -1;

    const cursor = new Date(startDate);
    let weekIdx = 0;

    while (cursor <= today) {
      const dateStr = cursor.toISOString().split("T")[0];
      const dow = cursor.getDay();
      const month = cursor.getMonth();

      if (dow === 0 && currentWeek.length > 0) {
        weeksArr.push(currentWeek);
        currentWeek = [];
        weekIdx++;
      }

      if (month !== lastMonth) {
        const monthName = cursor.toLocaleDateString(lang === "zh" ? "zh-CN" : "en", { month: "short" });
        mLabels.push({ label: monthName, col: weekIdx });
        lastMonth = month;
      }

      currentWeek.push({
        date: dateStr,
        time: statsMap.get(dateStr) || 0,
        dayOfWeek: dow,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    if (currentWeek.length > 0) weeksArr.push(currentWeek);

    return { weeks: weeksArr, monthLabels: mLabels };
  }, [dailyStats, lang]);

  const dayLabels = useMemo(() => {
    const days = lang === "zh"
      ? ["日", "一", "二", "三", "四", "五", "六"]
      : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return [
      { idx: 1, label: days[1] },
      { idx: 3, label: days[3] },
      { idx: 5, label: days[5] },
    ];
  }, [lang]);

  return (
    <TooltipProvider delayDuration={100}>
      <div ref={containerRef} className="w-full">
        {/* Month labels */}
        <div className="flex" style={{ paddingLeft: `${labelWidth}px` }}>
          {monthLabels.map((m, i) => {
            const nextCol = i + 1 < monthLabels.length ? monthLabels[i + 1].col : weeks.length;
            const span = nextCol - m.col;
            return (
              <div
                key={`${m.label}-${m.col}`}
                className="text-xs text-neutral-400"
                style={{ width: `${span * unit}px`, minWidth: `${span * unit}px` }}
              >
                {span >= 2 ? m.label : ""}
              </div>
            );
          })}
        </div>

        <div className="flex gap-0">
          {/* Day of week labels */}
          <div className="flex flex-col justify-between pr-1.5" style={{ width: `${labelWidth}px`, height: `${7 * unit - gap}px` }}>
            {[0, 1, 2, 3, 4, 5, 6].map((d) => {
              const label = dayLabels.find((l) => l.idx === d);
              return (
                <div key={d} className="flex items-center" style={{ height: `${cellSize}px` }}>
                  <span className="text-[10px] text-neutral-400">{label?.label || ""}</span>
                </div>
              );
            })}
          </div>

          {/* Heatmap grid */}
          <div className="flex" style={{ gap: `${gap}px` }}>
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col" style={{ gap: `${gap}px` }}>
                {week[0] && week[0].dayOfWeek > 0 && wi === 0 &&
                  Array.from({ length: week[0].dayOfWeek }).map((_, i) => (
                    <div key={`empty-${i}`} style={{ height: `${cellSize}px`, width: `${cellSize}px` }} />
                  ))}
                {week.map((day) => (
                  <Tooltip key={day.date}>
                    <TooltipTrigger asChild>
                      <div
                        className={`rounded-[2px] transition-colors ${getHeatColor(day.time)}`}
                        style={{ height: `${cellSize}px`, width: `${cellSize}px` }}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="bg-neutral-800 text-white">
                      <p className="text-xs font-medium">
                        {day.time > 0
                          ? t("stats.heatmapTooltip", { time: Math.round(day.time), date: day.date })
                          : t("stats.heatmapNoReading", { date: day.date })}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function HeatmapLegend() {
  const { t } = useTranslation();
  return (
    <div className="mt-3 flex items-center justify-end gap-1.5 text-xs text-neutral-400">
      <span>{t("stats.less")}</span>
      <div className="h-[12px] w-[12px] rounded-[2px] bg-neutral-100" />
      <div className="h-[12px] w-[12px] rounded-[2px] bg-emerald-200" />
      <div className="h-[12px] w-[12px] rounded-[2px] bg-emerald-400" />
      <div className="h-[12px] w-[12px] rounded-[2px] bg-emerald-500" />
      <div className="h-[12px] w-[12px] rounded-[2px] bg-emerald-700" />
      <span>{t("stats.more")}</span>
    </div>
  );
}

function getHeatColor(minutes: number): string {
  if (minutes <= 0) return "bg-neutral-100";
  if (minutes < 15) return "bg-emerald-200";
  if (minutes < 30) return "bg-emerald-400";
  if (minutes < 60) return "bg-emerald-500";
  return "bg-emerald-700";
}

/* ── Stat Card ── */

function StatCard({
  icon,
  title,
  value,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  description?: string;
}) {
  return (
    <div className="rounded-xl bg-muted p-4 shadow-around">
      <div className="flex items-center justify-between pb-2">
        <h3 className="text-sm font-medium text-neutral-500">{title}</h3>
        <div className="text-neutral-400">{icon}</div>
      </div>
      <div className="space-y-1">
        <div className="text-2xl font-bold text-neutral-900">{value}</div>
        {description && <p className="text-xs text-neutral-400">{description}</p>}
      </div>
    </div>
  );
}

function formatTime(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
