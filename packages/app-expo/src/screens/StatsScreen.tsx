import {
  BookOpenIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  FlameIcon,
  TrendingUpIcon,
} from "@/components/ui/Icon";
import { useReadingSessionStore } from "@/stores";
import {
  type ThemeColors,
  fontSize,
  fontWeight,
  radius,
  useColors,
  withOpacity,
} from "@/styles/theme";
import { useNavigation } from "@react-navigation/native";
import { getPlatformService } from "@readany/core/services";
import { readingStatsService } from "@readany/core/stats";
import type { DailyStats, OverallStats, PeriodBookStats, TrendPoint } from "@readany/core/stats";
/**
 * StatsScreen — Full reading stats page matching Tauri mobile MobileStatsPage.
 * Features: stats cards, heatmap/bar chart toggle, trend chart, period book list,
 * longest streak card.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, {
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";

const SCREEN_WIDTH = Dimensions.get("window").width;

function formatTime(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

function formatDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${Number.parseInt(m)}/${Number.parseInt(d)}`;
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekEnd(weekStart: Date): Date {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

// ────────────────── StatCard ──────────────────

function StatCard({
  icon,
  title,
  value,
  unit,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  unit?: string;
}) {
  const colors = useColors();
  const s = makeStyles(colors);
  return (
    <View style={s.statCard}>
      <View style={s.statCardHeader}>
        <Text style={s.statCardTitle}>{title}</Text>
        {icon}
      </View>
      <View style={s.statCardBody}>
        <Text style={s.statCardValue}>{value}</Text>
        {unit && <Text style={s.statCardUnit}>{unit}</Text>}
      </View>
    </View>
  );
}

// ────────────────── Heatmap (26 weeks matching Tauri) ──────────────────

function FullHeatmap({ dailyStats }: { dailyStats: DailyStats[] }) {
  const colors = useColors();
  const { t, i18n } = useTranslation();
  const [selectedDay, setSelectedDay] = useState<{
    date: string;
    time: number;
    weekIdx: number;
    dayIdx: number;
  } | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const CELL = 10;
  const GAP = 2;
  const UNIT = CELL + GAP;
  const WEEKS = 26;
  const TOOLTIP_WIDTH = 80;
  const TOOLTIP_HEIGHT = 24;

  const { weeks, monthLabels } = useMemo(() => {
    const statsMap = new Map<string, number>();
    for (const d of dailyStats) statsMap.set(d.date, d.totalTime);

    const today = new Date();
    const todayDay = today.getDay();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - (WEEKS * 7 + todayDay - 1));

    const weeksArr: Array<Array<{ date: string; time: number; dayOfWeek: number }>> = [];
    const mLabels: Array<{ label: string; col: number }> = [];
    let currentWeek: Array<{ date: string; time: number; dayOfWeek: number }> = [];
    let lastMonth = -1;
    let weekIdx = 0;
    const cursor = new Date(startDate);

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
        mLabels.push({
          label: new Intl.DateTimeFormat(i18n.language, { month: "short" }).format(
            new Date(2024, month, 1),
          ),
          col: weekIdx,
        });
        lastMonth = month;
      }

      currentWeek.push({ date: dateStr, time: statsMap.get(dateStr) || 0, dayOfWeek: dow });
      cursor.setDate(cursor.getDate() + 1);
    }
    if (currentWeek.length > 0) weeksArr.push(currentWeek);

    return { weeks: weeksArr, monthLabels: mLabels };
  }, [dailyStats, i18n.language]);

  // Fixed threshold color mapping matching Tauri's getHeatColor
  const getColor = (minutes: number) => {
    if (minutes <= 0) return colors.muted;
    if (minutes < 15) return withOpacity(colors.emerald, 0.3);
    if (minutes < 30) return withOpacity(colors.emerald, 0.5);
    if (minutes < 60) return withOpacity(colors.emerald, 0.7);
    return withOpacity(colors.emerald, 0.9);
  };

  const formatDisplayDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const handleCellPress = (
    day: { date: string; time: number },
    weekIdx: number,
    dayIdx: number,
  ) => {
    if (selectedDay?.date === day.date) {
      setSelectedDay(null);
    } else {
      setSelectedDay({ ...day, weekIdx, dayIdx });
      setTimeout(() => setSelectedDay(null), 1000);
    }
  };

  // Calculate tooltip position with boundary detection
  const getTooltipStyle = () => {
    if (!selectedDay || containerWidth === 0) return null;
    const { weekIdx, dayIdx } = selectedDay;

    const firstWeekPadding = weeks[0]?.[0]?.dayOfWeek || 0;
    const paddingOffset = weekIdx === 0 ? firstWeekPadding * UNIT : 0;

    const cellX = weekIdx * UNIT + CELL / 2;
    const cellY = paddingOffset + dayIdx * UNIT + CELL / 2;

    let left = cellX - TOOLTIP_WIDTH / 2;
    let top = cellY - TOOLTIP_HEIGHT - 8;

    // Boundary detection
    if (left < 4) left = 4;
    if (left + TOOLTIP_WIDTH > containerWidth - 4) left = containerWidth - TOOLTIP_WIDTH - 4;
    if (top < 4) top = cellY + CELL + 4; // Show below if no space above

    return { left, top };
  };

  const tooltipStyle = getTooltipStyle();

  return (
    <View
      style={{ position: "relative" }}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
    >
      {/* Month labels */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row", height: 14, marginBottom: 2 }}>
          {monthLabels.map((m, i) => {
            const nextCol = i + 1 < monthLabels.length ? monthLabels[i + 1].col : weeks.length;
            const span = nextCol - m.col;
            return (
              <View
                key={`${m.label}-${m.col}`}
                style={{ width: span * UNIT, minWidth: span * UNIT }}
              >
                {span >= 2 && (
                  <Text style={{ fontSize: 9, color: colors.mutedForeground }}>{m.label}</Text>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
      {/* Week columns */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row", gap: GAP }}>
          {weeks.map((week, wi) => (
            <View key={wi} style={{ flexDirection: "column", gap: GAP }}>
              {/* Pad first week for alignment */}
              {wi === 0 &&
                week[0] &&
                week[0].dayOfWeek > 0 &&
                Array.from({ length: week[0].dayOfWeek }).map((_, i) => (
                  <View key={`pad-${i}`} style={{ width: CELL, height: CELL }} />
                ))}
              {week.map((day, di) => (
                <TouchableOpacity
                  key={day.date}
                  style={{
                    width: CELL,
                    height: CELL,
                    borderRadius: 2,
                    backgroundColor: getColor(day.time),
                  }}
                  onPress={() => handleCellPress(day, wi, di)}
                  activeOpacity={0.7}
                />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Selected day tooltip - positioned outside ScrollView for boundary detection */}
      {selectedDay && tooltipStyle && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            ...tooltipStyle,
            backgroundColor: colors.card,
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 4,
            borderWidth: 0.5,
            borderColor: colors.border,
            minWidth: TOOLTIP_WIDTH,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.15,
            shadowRadius: 2,
            elevation: 3,
          }}
        >
          <Text
            style={{
              fontSize: 12,
              color: colors.cardForeground,
              fontWeight: "500",
              textAlign: "center",
            }}
          >
            {formatDisplayDate(selectedDay.date)}{" "}
            {selectedDay.time > 0 ? formatTime(selectedDay.time) : t("stats.noReading", "无阅读")}
          </Text>
        </View>
      )}
    </View>
  );
}

// ────────────────── Bar Chart ──────────────────

function BarChart({
  data,
  labels,
}: {
  data: { label: string; value: number }[];
  labels?: string[];
}) {
  const colors = useColors();
  const s = makeStyles(colors);
  const { t } = useTranslation();
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const maxVal = Math.max(1, ...data.map((d) => d.value));
  const BAR_HEIGHT = 140;
  const Y_AXIS_WIDTH = 32;

  const yTicks = [0, maxVal * 0.5, maxVal].map((v) => ({
    value: v,
    label: v < 60 ? `${Math.round(v)}m` : `${(v / 60).toFixed(1)}h`,
  }));

  if (data.length === 0) {
    return (
      <View style={s.barChartEmpty}>
        <Text style={s.barChartEmptyText}>{t("stats.noData", "暂无数据")}</Text>
      </View>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={() => setSelectedIdx(null)}
      style={[s.barChartWrap, { flexDirection: "row" }]}
    >
      {/* Y axis */}
      <View
        style={{
          width: Y_AXIS_WIDTH,
          height: BAR_HEIGHT + 20,
          justifyContent: "space-between",
          paddingRight: 4,
        }}
      >
        {yTicks.map((tick, i) => (
          <Text key={i} style={{ fontSize: 8, color: colors.mutedForeground, textAlign: "right" }}>
            {tick.label}
          </Text>
        ))}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.barChartContent}
      >
        {data.map((item, idx) => (
          <TouchableOpacity
            key={`${item.label}-${idx}`}
            style={s.barCol}
            onPress={() => setSelectedIdx(selectedIdx === idx ? null : idx)}
            activeOpacity={0.7}
          >
            <View style={[s.barTrack, { height: BAR_HEIGHT }]}>
              <View
                style={[
                  s.barFill,
                  {
                    height: Math.max(2, (item.value / maxVal) * BAR_HEIGHT),
                    backgroundColor: item.value > 0 ? colors.emerald : colors.muted,
                  },
                ]}
              />
            </View>
            <Text style={s.barLabel}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Tooltip overlay - positioned outside the bar */}
      {selectedIdx !== null && data[selectedIdx] && data[selectedIdx].value > 0 && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: Y_AXIS_WIDTH + 8 + selectedIdx * 28 + 14,
            top: BAR_HEIGHT - (data[selectedIdx].value / maxVal) * BAR_HEIGHT - 24,
            backgroundColor: colors.card,
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 4,
            borderWidth: 0.5,
            borderColor: colors.border,
            minWidth: 50,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.15,
            shadowRadius: 2,
            elevation: 3,
          }}
        >
          <Text
            style={{
              fontSize: 12,
              color: colors.cardForeground,
              fontWeight: "500",
              textAlign: "center",
            }}
          >
            {formatTime(data[selectedIdx].value)}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ────────────────── Simple Trend Chart (area-like with bars) ──────────────────

function TrendChart({ data }: { data: TrendPoint[] }) {
  const { t } = useTranslation();
  const colors = useColors();
  const s = makeStyles(colors);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const CHART_HEIGHT = 120;
  const MARGIN_LEFT = 36;
  const MARGIN_BOTTOM = 24;
  const MARGIN_TOP = 8;

  if (data.length === 0) {
    return (
      <View style={s.barChartEmpty}>
        <Text style={s.barChartEmptyText}>{t("stats.noData", "暂无数据")}</Text>
      </View>
    );
  }

  const maxVal = Math.max(1, ...data.map((d) => d.dailyTime));
  const innerWidth = containerWidth > 0 ? containerWidth - MARGIN_LEFT - 8 : 0;
  const innerHeight = CHART_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;

  const xScale = (idx: number) => {
    if (data.length <= 1) return MARGIN_LEFT + innerWidth / 2;
    return MARGIN_LEFT + (idx / (data.length - 1)) * innerWidth;
  };

  const yScale = (val: number) => {
    return MARGIN_TOP + innerHeight - (val / maxVal) * innerHeight;
  };

  const yTicks = [0, maxVal * 0.5, maxVal].map((v) => ({
    value: v,
    y: yScale(v),
  }));

  const linePath = data
    .map((d, i) => {
      const x = xScale(i);
      const y = yScale(d.dailyTime);
      return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    })
    .join(" ");

  const areaPath =
    `M ${MARGIN_LEFT} ${MARGIN_TOP + innerHeight} ` +
    linePath.replace("M", "L") +
    ` L ${xScale(data.length - 1)} ${MARGIN_TOP + innerHeight} Z`;

  const xTickInterval = Math.max(1, Math.ceil(data.length / 6));
  const xTicks = data.filter((_, i) => i === 0 || i === data.length - 1 || i % xTickInterval === 0);

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={() => setSelectedIdx(null)}
      style={{ height: CHART_HEIGHT + 40 }}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
    >
      {containerWidth > 0 && (
        <>
          <Svg width={containerWidth} height={CHART_HEIGHT + 40}>
            <Defs>
              <LinearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.emerald} stopOpacity={0.3} />
                <Stop offset="1" stopColor={colors.emerald} stopOpacity={0.02} />
              </LinearGradient>
            </Defs>

            <G>
              {yTicks.map((tick) => (
                <G key={tick.value}>
                  <Line
                    x1={MARGIN_LEFT}
                    y1={tick.y}
                    x2={containerWidth - 8}
                    y2={tick.y}
                    stroke={colors.border}
                    strokeWidth={1}
                  />
                  <SvgText
                    x={MARGIN_LEFT - 4}
                    y={tick.y}
                    fontSize={9}
                    fill={colors.mutedForeground}
                    textAnchor="end"
                    alignmentBaseline="middle"
                  >
                    {tick.value < 60
                      ? `${Math.round(tick.value)}m`
                      : `${(tick.value / 60).toFixed(1)}h`}
                  </SvgText>
                </G>
              ))}

              <Path d={areaPath} fill="url(#trendGradient)" />
              <Path d={linePath} fill="none" stroke={colors.emerald} strokeWidth={2} />

              <Line
                x1={MARGIN_LEFT}
                y1={MARGIN_TOP + innerHeight}
                x2={containerWidth - 8}
                y2={MARGIN_TOP + innerHeight}
                stroke={colors.border}
                strokeWidth={1}
              />

              {xTicks.map((d) => {
                const idx = data.findIndex((dd) => dd.date === d.date);
                return (
                  <SvgText
                    key={d.date}
                    x={xScale(idx)}
                    y={CHART_HEIGHT + 14}
                    fontSize={9}
                    fill={colors.mutedForeground}
                    textAnchor="middle"
                  >
                    {formatDate(d.date)}
                  </SvgText>
                );
              })}

              {data.map((d, i) => (
                <Rect
                  key={d.date}
                  x={xScale(i) - 12}
                  y={0}
                  width={24}
                  height={CHART_HEIGHT}
                  fill="transparent"
                />
              ))}
            </G>
          </Svg>

          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
            {data.map((d, i) => (
              <TouchableOpacity
                key={d.date}
                style={{
                  position: "absolute",
                  left: xScale(i) - 12,
                  top: 0,
                  width: 24,
                  height: CHART_HEIGHT,
                }}
                onPress={() => setSelectedIdx(selectedIdx === i ? null : i)}
                activeOpacity={0.7}
              />
            ))}
          </View>

          {selectedIdx !== null && data[selectedIdx] && (
            <View
              style={{
                position: "absolute",
                left: Math.min(Math.max(xScale(selectedIdx) - 40, 4), containerWidth - 84),
                top: Math.max(yScale(data[selectedIdx].dailyTime) - 36, 4),
                backgroundColor: colors.card,
                borderRadius: 6,
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderWidth: 0.5,
                borderColor: colors.border,
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.15,
                shadowRadius: 2,
                elevation: 3,
              }}
              pointerEvents="none"
            >
              <Text style={{ fontSize: 12, color: colors.cardForeground, fontWeight: "500" }}>
                {formatDate(data[selectedIdx].date)} {formatTime(data[selectedIdx].dailyTime)}
              </Text>
            </View>
          )}
        </>
      )}
    </TouchableOpacity>
  );
}

// ────────────────── Period Book List ──────────────────

function PeriodBookList({
  books,
  resolvedCovers,
}: {
  books: PeriodBookStats[];
  resolvedCovers: Map<string, string>;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const s = makeStyles(colors);

  if (books.length === 0) {
    return (
      <Text style={s.periodBooksEmpty}>{t("stats.noBooksInPeriod", "本期间暂无阅读书籍")}</Text>
    );
  }

  return (
    <View style={{ gap: 6 }}>
      {books.map((book) => {
        const coverUrl = resolvedCovers.get(book.bookId) || book.coverUrl;
        return (
          <View key={book.bookId} style={s.bookRow}>
            {/* Cover */}
            {coverUrl ? (
              <Image source={{ uri: coverUrl }} style={s.bookCover} resizeMode="cover" />
            ) : (
              <View style={s.bookCoverPlaceholder}>
                <Text style={s.bookCoverLetter}>{book.title.charAt(0)}</Text>
              </View>
            )}
            {/* Info */}
            <View style={s.bookInfo}>
              <View style={s.bookTitleRow}>
                <Text style={s.bookTitle} numberOfLines={1}>
                  {book.title}
                </Text>
                <Text style={s.bookTime}>{formatTime(book.totalTime)}</Text>
              </View>
              {book.author && <Text style={s.bookAuthor}>{book.author}</Text>}
              {/* Progress bar */}
              <View style={s.progressRow}>
                <View style={s.progressTrack}>
                  <View
                    style={[s.progressFill, { width: `${Math.min(book.progress * 100, 100)}%` }]}
                  />
                </View>
                <Text style={s.progressPercent}>{Math.round(book.progress * 100)}%</Text>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ────────────────── Types ──────────────────

type ChartView = "heatmap" | "bar";
type ChartMode = "week" | "month";

// ────────────────── StatsScreen ──────────────────

export default function StatsScreen() {
  const colors = useColors();
  const s = makeStyles(colors);
  const { t, i18n } = useTranslation();
  const nav = useNavigation();
  const saveCurrentSession = useReadingSessionStore((s) => s.saveCurrentSession);

  const [loading, setLoading] = useState(true);
  const [overallStats, setOverallStats] = useState<OverallStats | null>(null);
  const [heatmapData, setHeatmapData] = useState<DailyStats[]>([]);
  const [trendData, setTrendData] = useState<TrendPoint[]>([]);

  // Chart toggle state
  const [chartView, setChartView] = useState<ChartView>("heatmap");
  const [chartMode, setChartMode] = useState<ChartMode>("week");
  const [chartDate, setChartDate] = useState<Date>(() => getWeekStart(new Date()));
  const [chartData, setChartData] = useState<DailyStats[]>([]);
  const [periodBooks, setPeriodBooks] = useState<PeriodBookStats[]>([]);
  const [resolvedCovers, setResolvedCovers] = useState<Map<string, string>>(new Map());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await saveCurrentSession();
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 365);

      const [daily, overall, trend] = await Promise.all([
        readingStatsService.getDailyStats(startDate, endDate),
        readingStatsService.getOverallStats(),
        readingStatsService.getRecentTrend(30),
      ]);
      setHeatmapData(daily);
      setOverallStats(overall);
      setTrendData(trend);
    } catch (err) {
      console.error("Failed to load stats:", err);
    } finally {
      setLoading(false);
    }
  }, [saveCurrentSession]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Resolve cover URLs from relative paths to absolute paths
  useEffect(() => {
    const resolveCovers = async () => {
      if (periodBooks.length === 0) return;
      const newMap = new Map<string, string>();
      try {
        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();

        for (const book of periodBooks) {
          if (!book.coverUrl) continue;

          if (
            book.coverUrl.startsWith("http") ||
            book.coverUrl.startsWith("blob") ||
            book.coverUrl.startsWith("file")
          ) {
            newMap.set(book.bookId, book.coverUrl);
            continue;
          }

          try {
            const absPath = await platform.joinPath(appData, book.coverUrl);
            newMap.set(book.bookId, absPath);
          } catch {
            // If resolution fails, skip this cover
          }
        }

        setResolvedCovers(newMap);
      } catch (err) {
        console.error("Failed to resolve cover URLs:", err);
      }
    };

    resolveCovers();
  }, [periodBooks]);

  // Load chart data when mode/date changes
  useEffect(() => {
    if (loading) return;
    const loadChart = async () => {
      try {
        let periodStart: Date;
        let periodEnd: Date;
        let data: DailyStats[];

        if (chartMode === "week") {
          periodStart = chartDate;
          periodEnd = getWeekEnd(chartDate);
          data = await readingStatsService.getWeeklyStats(chartDate);
        } else {
          const year = chartDate.getFullYear();
          const month = chartDate.getMonth();
          periodStart = new Date(year, month, 1);
          periodEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
          data = await readingStatsService.getMonthlyStats(year, month);
        }

        const books = await readingStatsService.getBookStatsForPeriod(periodStart, periodEnd);
        setChartData(data);
        setPeriodBooks(books);
      } catch {
        // ignore
      }
    };
    loadChart();
  }, [chartMode, chartDate, loading]);

  const navigatePeriod = useCallback(
    (direction: -1 | 1) => {
      setChartDate((prev) => {
        const d = new Date(prev);
        if (chartMode === "week") {
          d.setDate(d.getDate() + direction * 7);
        } else {
          d.setMonth(d.getMonth() + direction);
        }
        return d;
      });
    },
    [chartMode],
  );

  const switchChartMode = useCallback((mode: ChartMode) => {
    setChartMode(mode);
    if (mode === "week") {
      setChartDate(getWeekStart(new Date()));
    } else {
      const now = new Date();
      setChartDate(new Date(now.getFullYear(), now.getMonth(), 1));
    }
  }, []);

  const periodLabel = useMemo(() => {
    if (chartMode === "week") {
      const end = getWeekEnd(chartDate);
      const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
      return `${fmt(chartDate)} – ${fmt(end)}`;
    }
    return new Intl.DateTimeFormat(i18n.language, { year: "numeric", month: "long" }).format(
      chartDate,
    );
  }, [chartDate, chartMode, i18n.language]);

  const barChartData = useMemo(() => {
    const weekdayFormatter = new Intl.DateTimeFormat(i18n.language, { weekday: "short" });
    const dayNames = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(2024, 0, 1 + i); // 2024-01-01 is Monday
      return weekdayFormatter.format(date);
    });
    if (chartMode === "week") {
      return chartData.map((d, i) => ({
        label: dayNames[i] || d.date.slice(5),
        value: d.totalTime,
      }));
    }
    return chartData.map((d) => ({
      label: String(new Date(d.date).getDate()),
      value: d.totalTime,
    }));
  }, [chartData, chartMode, i18n.language]);

  const booksRead = overallStats?.totalBooks ?? 0;
  const totalTime = overallStats ? formatTime(overallStats.totalReadingTime) : "0m";
  const streak = overallStats?.currentStreak ?? 0;
  const avgDaily = overallStats ? formatTime(overallStats.avgDailyTime) : "0m";

  if (loading) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={["top"]}>
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={colors.mutedForeground} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={["top"]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => nav.goBack()}>
          <ChevronLeftIcon size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{t("stats.title", "阅读统计")}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
        {/* Stats cards */}
        <View style={s.statsGrid}>
          <StatCard
            icon={<BookOpenIcon size={16} color={colors.mutedForeground} />}
            title={t("profile.booksRead", "已读")}
            value={String(booksRead)}
            unit={t("profile.booksUnit", "本")}
          />
          <StatCard
            icon={<ClockIcon size={16} color={colors.mutedForeground} />}
            title={t("profile.totalTime", "总时长")}
            value={totalTime}
          />
          <StatCard
            icon={<FlameIcon size={16} color={colors.mutedForeground} />}
            title={t("profile.streak", "连续")}
            value={String(streak)}
            unit={t("profile.daysUnit", "天")}
          />
          <StatCard
            icon={<TrendingUpIcon size={16} color={colors.mutedForeground} />}
            title={t("profile.avgDaily", "日均")}
            value={avgDaily}
          />
        </View>

        {/* Heatmap / Bar Chart card — with toggle */}
        <View style={s.section}>
          <View style={s.sectionCard}>
            <View style={s.chartHeaderRow}>
              <Text style={s.chartHeaderLabel}>{t("profile.readingActivity", "阅读活动")}</Text>
              <View style={s.toggleRow}>
                <TouchableOpacity
                  style={[s.toggleBtn, chartView === "heatmap" && s.toggleBtnActive]}
                  onPress={() => setChartView("heatmap")}
                >
                  <Text style={[s.toggleBtnText, chartView === "heatmap" && s.toggleBtnTextActive]}>
                    {t("stats.viewHeatmap", "热力图")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.toggleBtn, chartView === "bar" && s.toggleBtnActive]}
                  onPress={() => setChartView("bar")}
                >
                  <Text style={[s.toggleBtnText, chartView === "bar" && s.toggleBtnTextActive]}>
                    {t("stats.viewBarChart", "柱状图")}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Bar chart controls */}
            {chartView === "bar" && (
              <View style={s.barControlsRow}>
                <View style={s.toggleRow}>
                  <TouchableOpacity
                    style={[s.toggleBtn, chartMode === "week" && s.toggleBtnActive]}
                    onPress={() => switchChartMode("week")}
                  >
                    <Text style={[s.toggleBtnText, chartMode === "week" && s.toggleBtnTextActive]}>
                      {t("stats.periodWeek", "周")}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.toggleBtn, chartMode === "month" && s.toggleBtnActive]}
                    onPress={() => switchChartMode("month")}
                  >
                    <Text style={[s.toggleBtnText, chartMode === "month" && s.toggleBtnTextActive]}>
                      {t("stats.periodMonth", "月")}
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={s.periodNav}>
                  <TouchableOpacity onPress={() => navigatePeriod(-1)} style={s.periodNavBtn}>
                    <ChevronLeftIcon size={14} color={colors.mutedForeground} />
                  </TouchableOpacity>
                  <Text style={s.periodLabel}>{periodLabel}</Text>
                  <TouchableOpacity onPress={() => navigatePeriod(1)} style={s.periodNavBtn}>
                    <ChevronRightIcon size={14} color={colors.mutedForeground} />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Chart content */}
            {chartView === "heatmap" ? (
              <>
                <FullHeatmap dailyStats={heatmapData} />
                <View style={s.heatmapLegend}>
                  <Text style={s.legendText}>{t("common.less", "少")}</Text>
                  {[
                    colors.muted,
                    withOpacity(colors.emerald, 0.3),
                    withOpacity(colors.emerald, 0.5),
                    withOpacity(colors.emerald, 0.7),
                    withOpacity(colors.emerald, 0.9),
                  ].map((c, i) => (
                    <View key={i} style={[s.legendCell, { backgroundColor: c }]} />
                  ))}
                  <Text style={s.legendText}>{t("common.more", "多")}</Text>
                </View>
              </>
            ) : (
              <BarChart data={barChartData} />
            )}
          </View>
        </View>

        {/* Trend Chart */}
        <View style={s.section}>
          <View style={s.sectionCard}>
            <Text style={s.sectionCardTitle}>{t("stats.trendTitle", "30天阅读趋势")}</Text>
            <TrendChart data={trendData} />
          </View>
        </View>

        {/* Period Book List */}
        <View style={s.section}>
          <View style={s.sectionCard}>
            <Text style={s.sectionCardTitle}>{t("stats.periodBooks", "期间阅读书籍")}</Text>
            <PeriodBookList books={periodBooks} resolvedCovers={resolvedCovers} />
          </View>
        </View>

        {/* Longest streak */}
        {overallStats && overallStats.longestStreak > 0 && (
          <View style={s.section}>
            <View style={s.streakCard}>
              <View style={s.streakIconWrap}>
                <FlameIcon size={16} color={colors.amber} />
              </View>
              <View style={s.streakInfo}>
                <Text style={s.streakLabel}>
                  {t("stats.longestStreak", { days: overallStats.longestStreak })}
                </Text>
                <Text style={s.streakDesc}>
                  {t("stats.longestStreakDesc", "历史最长连续阅读记录")}
                </Text>
              </View>
            </View>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    scrollContent: { padding: 16 },

    // Stats grid
    statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 12 },
    statCard: {
      width: "47%",
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 0.5,
      borderColor: colors.border,
      padding: 14,
    },
    statCardHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 6,
    },
    statCardTitle: { fontSize: fontSize.xs, color: colors.mutedForeground },
    statCardBody: { flexDirection: "row", alignItems: "baseline", gap: 4 },
    statCardValue: {
      fontSize: fontSize["2xl"],
      fontWeight: fontWeight.bold,
      color: colors.foreground,
    },
    statCardUnit: { fontSize: fontSize.sm, color: colors.mutedForeground },

    // Section
    section: { marginBottom: 12 },
    sectionCard: {
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 0.5,
      borderColor: colors.border,
      padding: 14,
    },
    sectionCardTitle: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
      marginBottom: 12,
    },

    // Chart header with toggle
    chartHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    chartHeaderLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
    },
    toggleRow: {
      flexDirection: "row",
      borderRadius: radius.md,
      borderWidth: 0.5,
      borderColor: colors.border,
      backgroundColor: colors.muted,
      padding: 2,
    },
    toggleBtn: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
    toggleBtnActive: { backgroundColor: colors.background },
    toggleBtnText: { fontSize: 12, fontWeight: fontWeight.medium, color: colors.mutedForeground },
    toggleBtnTextActive: { color: colors.foreground },

    // Bar controls
    barControlsRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    periodNav: { flexDirection: "row", alignItems: "center", gap: 2 },
    periodNavBtn: { padding: 4, borderRadius: radius.sm },
    periodLabel: {
      fontSize: 12,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
      minWidth: 80,
      textAlign: "center",
    },

    // Heatmap legend
    heatmapLegend: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 4,
      marginTop: 10,
    },
    legendText: { fontSize: 9, color: colors.mutedForeground },
    legendCell: { width: 10, height: 10, borderRadius: 2 },

    // Bar chart
    barChartWrap: { height: 180 },
    barChartContent: { alignItems: "flex-end", gap: 4, paddingBottom: 4 },
    barCol: { alignItems: "center", width: 28 },
    barTrack: { justifyContent: "flex-end", width: 16 },
    barFill: { width: 16, borderRadius: 4 },
    barLabel: { fontSize: 8, color: colors.mutedForeground, marginTop: 4 },
    barChartEmpty: { height: 120, alignItems: "center", justifyContent: "center" },
    barChartEmptyText: { fontSize: fontSize.xs, color: colors.mutedForeground },
    tooltip: {
      position: "absolute",
      backgroundColor: colors.card,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      borderWidth: 0.5,
      borderColor: colors.border,
    },
    tooltipText: { fontSize: 9, color: colors.cardForeground, fontWeight: "500" },

    // Trend chart
    trendContent: { alignItems: "flex-end", gap: 1 },
    trendCol: { alignItems: "center", width: 10 },
    trendTrack: { justifyContent: "flex-end", width: 6 },
    trendBar: { width: 6, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
    trendLabel: { fontSize: 7, color: colors.mutedForeground, marginTop: 2 },

    // Period books
    periodBooksEmpty: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      textAlign: "center",
      paddingVertical: 16,
    },
    bookRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 6,
      paddingHorizontal: 6,
      borderRadius: radius.lg,
    },
    bookCoverPlaceholder: {
      width: 28,
      height: 40,
      borderRadius: radius.sm,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    bookCover: {
      width: 28,
      height: 40,
      borderRadius: radius.sm,
      backgroundColor: colors.muted,
    },
    bookCoverLetter: { fontSize: 12, color: colors.mutedForeground },
    bookInfo: { flex: 1, gap: 4 },
    bookTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 4,
    },
    bookTitle: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
      flex: 1,
    },
    bookAuthor: {
      fontSize: 11,
      color: colors.mutedForeground,
    },
    bookTime: { fontSize: 12, color: colors.mutedForeground },
    progressRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    progressTrack: {
      flex: 1,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.muted,
      overflow: "hidden",
    },
    progressFill: { height: "100%", borderRadius: 2, backgroundColor: colors.emerald },
    progressPercent: { fontSize: 11, color: colors.mutedForeground },

    // Streak
    streakCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 0.5,
      borderColor: colors.border,
      padding: 12,
    },
    streakIconWrap: {
      width: 32,
      height: 32,
      borderRadius: radius.lg,
      backgroundColor: withOpacity(colors.amber, 0.1),
      alignItems: "center",
      justifyContent: "center",
    },
    streakInfo: { gap: 2 },
    streakLabel: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    streakDesc: { fontSize: 12, color: colors.mutedForeground },
  });
