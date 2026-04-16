export {
  ReadingStatsService,
  readingStatsService,
} from "./reading-stats";
export {
  buildDailyReadingFacts,
  createBookIndex,
} from "./fact-builder";
export {
  buildDayReport,
  buildLifetimeReport,
  buildMonthReport,
  buildStatsSummary,
  buildTopBooksFromFacts,
  buildWeekReport,
  buildYearReport,
} from "./report-builder";
export {
  mergeCurrentSessionIntoDailyFacts,
} from "./live-facts";
export {
  mergeCurrentSessionIntoDailyStats,
  mergeCurrentSessionIntoOverallStats,
} from "./live-reading-stats";
export {
  ReadingReportsService,
  readingReportsService,
} from "./reports-service";
export {
  buildStatsViewModel,
} from "./view-model-builder";
export {
  buildLifetimePeriodRef,
  buildPeriodRef,
  fromLocalDateKey,
  getMonthEndDate,
  getMonthKey,
  getMonthStartDate,
  getWeekEndDate,
  getWeekKey,
  getWeekStartDate,
  getYearEndDate,
  getYearKey,
  getYearStartDate,
  toLocalDate,
  toLocalDateKey,
} from "./period-utils";
export type {
  DailyStats,
  BookStats,
  OverallStats,
  PeriodBookStats,
  TrendPoint,
} from "./reading-stats";
export type {
  BaseStatsReport,
  StatsCalendarBlock,
  StatsCalendarCell,
  StatsCalendarCover,
  DailyBookBreakdown,
  DailyReadingFact,
  DayReport,
  LifetimeContext,
  LifetimeReport,
  MonthReport,
  StatsChartBlock,
  StatsChartDatum,
  StatsChartType,
  StatsDimension,
  StatsInsight,
  StatsInsightTone,
  StatsMetricCard,
  StatsMetricComparison,
  StatsNavigation,
  StatsPeriodRef,
  StatsReport,
  StatsSectionBlock,
  StatsShareCardModel,
  StatsSummary,
  StatsYearSnapshot,
  StatsViewModel,
  TopBookEntry,
  WeekReport,
  YearReport,
} from "./schema";
