import {
  BarChart3Icon,
  BookOpenIcon,
  ChevronRightIcon,
  ClockIcon,
  CloudIcon,
  CpuIcon,
  DatabaseIcon,
  FlameIcon,
  HelpCircleIcon,
  InfoIcon,
  LanguagesIcon,
  PaletteIcon,
  PuzzleIcon,
  TrendingUpIcon,
  TypeIcon,
  Volume2Icon,
} from "@/components/ui/Icon";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useReadingSessionStore } from "@/stores";
import {
  mergeCurrentSessionIntoDailyStats,
  mergeCurrentSessionIntoOverallStats,
} from "@/lib/stats/live-reading-stats";
import {
  type ThemeColors,
  fontSize,
  fontWeight,
  radius,
  useColors,
  withOpacity,
} from "@/styles/theme";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { readingStatsService } from "@readany/core/stats";
import { eventBus } from "@readany/core/utils/event-bus";
import Constants from "expo-constants";
import type { DailyStats, OverallStats } from "@readany/core/stats";
/**
 * ProfileScreen — matching Tauri mobile ProfilePage exactly.
 * Features: reading stats cards, heatmap, settings menu (general/skills/about),
 * complete menu items including Skills and VectorModel.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Nav = NativeStackNavigationProp<RootStackParamList>;

function formatTime(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

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

/** Compact heatmap — last 16 weeks, matching Tauri MobileHeatmap */
function MiniHeatmap({ dailyStats }: { dailyStats: DailyStats[] }) {
  const themeColors = useColors();
  const s = makeStyles(themeColors);
  const { t } = useTranslation();
  const WEEKS = 16;
  const DAYS_PER_WEEK = 7;
  const GAP = 2;
  const [containerWidth, setContainerWidth] = useState(0);
  const [selectedCell, setSelectedCell] = useState<{
    date: string;
    time: number;
    x: number;
    y: number;
  } | null>(null);

  // Calculate cell size based on container width
  // containerWidth = WEEKS * CELL + (WEEKS - 1) * GAP
  const CELL = containerWidth > 0 ? Math.floor((containerWidth - (WEEKS - 1) * GAP) / WEEKS) : 8;
  const gridWidth = WEEKS * CELL + (WEEKS - 1) * GAP;
  const gridHeight = DAYS_PER_WEEK * CELL + (DAYS_PER_WEEK - 1) * GAP;

  const cells = useMemo(() => {
    const statsMap = new Map<string, number>();
    for (const d of dailyStats) statsMap.set(d.date, d.totalTime);

    const today = new Date();
    const result: { col: number; row: number; intensity: number; date: string; time: number }[] =
      [];
    const maxTime = Math.max(1, ...dailyStats.map((d) => d.totalTime));

    for (let w = WEEKS - 1; w >= 0; w--) {
      for (let d = 0; d < DAYS_PER_WEEK; d++) {
        const date = new Date(today);
        date.setDate(today.getDate() - (w * 7 + (6 - d)));
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        const time = statsMap.get(key) || 0;
        result.push({
          col: WEEKS - 1 - w,
          row: d,
          intensity: time > 0 ? Math.min(1, time / maxTime) : 0,
          date: key,
          time,
        });
      }
    }
    return result;
  }, [dailyStats]);

  const getColor = (intensity: number) => {
    if (intensity <= 0) return themeColors.muted;
    if (intensity < 0.25) return withOpacity(themeColors.primary, 0.3);
    if (intensity < 0.5) return withOpacity(themeColors.primary, 0.5);
    if (intensity < 0.75) return withOpacity(themeColors.primary, 0.7);
    return withOpacity(themeColors.primary, 0.9);
  };

  const formatDisplayDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const formatTime = (minutes: number) => {
    if (minutes < 60) return `${Math.round(minutes)}${t("common.minutes", "分钟")}`;
    return `${(minutes / 60).toFixed(1)}${t("common.hours", "小时")}`;
  };

  const handleCellPress = (cell: { date: string; time: number }, col: number, row: number) => {
    const x = col * (CELL + GAP) + CELL / 2;
    const y = row * (CELL + GAP) + CELL / 2;
    if (selectedCell?.date === cell.date) {
      setSelectedCell(null);
    } else {
      setSelectedCell({ ...cell, x, y });
      setTimeout(() => setSelectedCell(null), 1000);
    }
  };

  // Calculate tooltip position with boundary detection
  const getTooltipStyle = () => {
    if (!selectedCell || containerWidth === 0) return null;
    const TOOLTIP_WIDTH = 80;
    const TOOLTIP_HEIGHT = 24;

    let left = selectedCell.x - TOOLTIP_WIDTH / 2;
    let top = selectedCell.y - TOOLTIP_HEIGHT - 8;

    // Boundary detection
    if (left < 4) left = 4;
    if (left + TOOLTIP_WIDTH > containerWidth - 4) left = containerWidth - TOOLTIP_WIDTH - 4;
    if (top < 4) top = selectedCell.y + CELL + 4; // Show below if no space above

    return { left, top };
  };

  const tooltipStyle = getTooltipStyle();

  return (
    <View
      style={s.heatmapContainer}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
    >
      {containerWidth > 0 && (
        <View style={[s.heatmapGrid, { width: gridWidth, height: gridHeight }]}>
          {cells.map((cell, i) => (
            <TouchableOpacity
              key={i}
              style={{
                position: "absolute",
                left: cell.col * (CELL + GAP),
                top: cell.row * (CELL + GAP),
                width: CELL,
                height: CELL,
                borderRadius: Math.max(2, CELL * 0.25),
                backgroundColor: getColor(cell.intensity),
              }}
              onPress={() => handleCellPress(cell, cell.col, cell.row)}
              activeOpacity={0.7}
            />
          ))}
        </View>
      )}

      {/* Selected cell tooltip */}
      {selectedCell && tooltipStyle && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            ...tooltipStyle,
            backgroundColor: themeColors.card,
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 4,
            borderWidth: 0.5,
            borderColor: themeColors.border,
            minWidth: 80,
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
              color: themeColors.cardForeground,
              fontWeight: "500",
              textAlign: "center",
            }}
          >
            {formatDisplayDate(selectedCell.date)}{" "}
            {selectedCell.time > 0 ? formatTime(selectedCell.time) : t("stats.noReading", "无阅读")}
          </Text>
        </View>
      )}

      <View style={s.heatmapLegend}>
        <Text style={s.heatmapLegendText}>{t("common.less", "少")}</Text>
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <View key={v} style={[s.heatmapLegendCell, { backgroundColor: getColor(v) }]} />
        ))}
        <Text style={s.heatmapLegendText}>{t("common.more", "多")}</Text>
      </View>
    </View>
  );
}

export function ProfileScreen() {
  const colors = useColors();
  const s = makeStyles(colors);
  const { t, i18n } = useTranslation();
  const nav = useNavigation<Nav>();
  const [overall, setOverall] = useState<OverallStats | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const saveCurrentSession = useReadingSessionStore((s) => s.saveCurrentSession);
  const currentSession = useReadingSessionStore((s) => s.currentSession);

  const loadStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      await saveCurrentSession();

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 365);

      const [daily, overallStats] = await Promise.all([
        readingStatsService.getDailyStats(startDate, endDate),
        readingStatsService.getOverallStats(),
      ]);
      setDailyStats(daily);
      setOverall(overallStats);
    } catch (err) {
      console.error("[ProfileScreen] Failed to load stats:", err);
    } finally {
      setStatsLoading(false);
    }
  }, [saveCurrentSession]);

  useFocusEffect(
    useCallback(() => {
      void loadStats();
    }, [loadStats]),
  );

  useEffect(() => {
    return eventBus.on("sync:completed", () => {
      void loadStats();
    });
  }, [loadStats]);

  const liveDailyStats = useMemo(
    () => mergeCurrentSessionIntoDailyStats(dailyStats, currentSession),
    [dailyStats, currentSession],
  );
  const liveOverall = useMemo(
    () => mergeCurrentSessionIntoOverallStats(overall, dailyStats, currentSession),
    [overall, dailyStats, currentSession],
  );

  // Settings menu — matching Tauri ProfilePage exactly
  const menuSections = useMemo(
    () => [
      {
        title: t("settings.general", "通用"),
        items: [
          {
            icon: PaletteIcon,
            label: t("settings.appearance", "外观"),
            route: "AppearanceSettings" as const,
          },
          {
            icon: TypeIcon,
            label: t("fonts.title", "字体"),
            route: "FontSettings" as const,
          },
          { icon: CloudIcon, label: t("settings.sync", "同步"), route: "SyncSettings" as const },
        ],
      },
      {
        title: t("settings.skills", "能力"),
        items: [
          {
            icon: DatabaseIcon,
            label: t("settings.ai_title", "AI 模型"),
            route: "AISettings" as const,
          },
          { icon: Volume2Icon, label: t("tts.title", "语音朗读"), route: "TTSSettings" as const },
          {
            icon: LanguagesIcon,
            label: t("settings.translationTab", "翻译"),
            route: "TranslationSettings" as const,
          },
          { icon: PuzzleIcon, label: t("skills.title", "技能"), route: "Skills" as const },
          {
            icon: CpuIcon,
            label: t("settings.vm_title", "向量模型"),
            route: "VectorModelSettings" as const,
          },
        ],
      },
      {
        title: t("settings.other", "更多"),
        items: [
          {
            icon: HelpCircleIcon,
            label: t("about.supportCenter", "帮助中心"),
            url: `https://codedogqby.github.io/ReadAny/${i18n.language === "zh" ? "zh/" : ""}support/`,
          },
          { icon: InfoIcon, label: t("settings.about", "关于"), route: "About" as const },
        ],
      },
    ],
    [t],
  );

  const booksRead = liveOverall?.totalBooks ?? 0;
  const totalTime = liveOverall ? formatTime(liveOverall.totalReadingTime) : "0m";
  const streak = liveOverall?.currentStreak ?? 0;
  const avgDaily = liveOverall ? formatTime(liveOverall.avgDailyTime) : "0m";

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={["top"]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>{t("profile.title", "我的")}</Text>
      </View>

      <ScrollView style={s.scrollView} showsVerticalScrollIndicator={false}>
        {/* Stats cards */}
        <View style={s.statsSection}>
          {statsLoading ? (
            <View style={s.statsLoading}>
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            </View>
          ) : (
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
          )}
        </View>

        {/* Compact heatmap */}
        <View style={s.heatmapSection}>
          <View style={s.heatmapHeader}>
            <Text style={s.heatmapTitle}>{t("profile.readingActivity", "阅读活动")}</Text>
            <TouchableOpacity style={s.heatmapDetailBtn} onPress={() => nav.navigate("Stats")}>
              <BarChart3Icon size={14} color={colors.primary} />
              <Text style={s.heatmapDetailText}>{t("profile.viewDetails", "查看详情")}</Text>
            </TouchableOpacity>
          </View>
          <MiniHeatmap dailyStats={liveDailyStats} />
        </View>

        {/* Settings menu */}
        {menuSections.map((section) => (
          <View key={section.title} style={s.menuSection}>
            <Text style={s.menuSectionTitle}>{section.title}</Text>
            <View style={s.menuCard}>
              {section.items.map((item, idx) => {
                const Icon = item.icon;
                const itemKey = "route" in item ? item.route : item.url;
                const handlePress = () => {
                  if ("url" in item && item.url) {
                    Linking.openURL(item.url);
                  } else if ("route" in item) {
                    nav.navigate(item.route as any);
                  }
                };
                return (
                  <TouchableOpacity
                    key={itemKey}
                    style={[s.menuItem, idx < section.items.length - 1 && s.menuItemBorder]}
                    onPress={handlePress}
                    activeOpacity={0.7}
                  >
                    <Icon size={20} color={colors.mutedForeground} />
                    <Text style={s.menuItemLabel}>{item.label}</Text>
                    <ChevronRightIcon size={16} color={colors.mutedForeground} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        {/* Version */}
        <Text style={s.version}>{t("profile.version", { version: Constants.expoConfig?.version ?? "1.0.0" })}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 12,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: fontSize["2xl"],
      fontWeight: fontWeight.bold,
      color: colors.foreground,
    },
    scrollView: { flex: 1 },
    // Stats
    statsSection: { paddingHorizontal: 16, paddingTop: 16 },
    statsLoading: { alignItems: "center", justifyContent: "center", paddingVertical: 32 },
    statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
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
    // Heatmap
    heatmapSection: {
      marginHorizontal: 16,
      marginTop: 16,
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 0.5,
      borderColor: colors.border,
      padding: 16,
    },
    heatmapHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    heatmapTitle: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
    },
    heatmapDetailBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
    heatmapDetailText: { fontSize: fontSize.xs, color: colors.primary },
    heatmapContainer: { width: "100%" },
    heatmapGrid: { alignSelf: "center" },
    heatmapLegend: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 4,
      marginTop: 8,
    },
    heatmapLegendText: { fontSize: 9, color: colors.mutedForeground },
    heatmapLegendCell: { width: 8, height: 8, borderRadius: 2 },
    // Menu
    menuSection: { paddingHorizontal: 16, marginTop: 16 },
    menuSectionTitle: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 8,
    },
    menuCard: {
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 0.5,
      borderColor: colors.border,
      overflow: "hidden",
    },
    menuItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    menuItemBorder: { borderBottomWidth: 0.5, borderBottomColor: colors.border },
    menuItemLabel: { flex: 1, fontSize: fontSize.md, color: colors.foreground },
    version: {
      textAlign: "center",
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      marginTop: 32,
      marginBottom: 24,
    },
  });
