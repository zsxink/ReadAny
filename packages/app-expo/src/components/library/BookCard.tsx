import { ClockIcon, DatabaseIcon, HashIcon, Loader2Icon, Trash2Icon } from "@/components/ui/Icon";
import { type ThemeColors, fontSize, fontWeight, radius, useColors } from "@/styles/theme";
import { getPlatformService } from "@readany/core/services";
/**
 * BookCard — Touch-optimized book card matching Tauri mobile MobileBookCard exactly.
 * Cover (28:41), progress bar, vectorization overlay, tag badges, long-press action sheet.
 */
import type { Book } from "@readany/core/types";
import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const AnimatedLoader = () => {
  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();
  }, [spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Animated.View style={{ transform: [{ rotate: spin }] }}>
      <Loader2Icon size={24} color="#fff" />
    </Animated.View>
  );
};

const SCREEN_PADDING = 16;
const NUM_COLUMNS = 3;
const GRID_GAP = 12;
const screenWidth = Dimensions.get("window").width;
const coverWidth = (screenWidth - SCREEN_PADDING * 2 - GRID_GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;
const coverHeight = coverWidth * (41 / 28);

interface BookCardProps {
  book: Book;
  onOpen: (book: Book) => void;
  onDelete: (bookId: string) => void;
  onManageTags?: (book: Book) => void;
  onVectorize?: (book: Book) => void;
  isVectorizing?: boolean;
  isQueued?: boolean;
  vectorProgress?: { status: string; processedChunks: number; totalChunks: number } | null;
}

export const BookCard = memo(function BookCard({
  book,
  onOpen,
  onDelete,
  onManageTags,
  onVectorize,
  isVectorizing,
  isQueued,
  vectorProgress,
}: BookCardProps) {
  const colors = useColors();
  const s = makeStyles(colors);
  const { t } = useTranslation();
  const [imageError, setImageError] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [resolvedCoverUrl, setResolvedCoverUrl] = useState<string | undefined>(undefined);

  // Resolve relative coverUrl to absolute path
  useEffect(() => {
    const raw = book.meta.coverUrl;
    if (!raw) {
      setResolvedCoverUrl(undefined);
      return;
    }
    if (raw.startsWith("http") || raw.startsWith("blob") || raw.startsWith("file")) {
      setResolvedCoverUrl(raw);
      return;
    }
    (async () => {
      try {
        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();
        const absPath = await platform.joinPath(appData, raw);
        setResolvedCoverUrl(absPath);
      } catch {
        setResolvedCoverUrl(undefined);
      }
    })();
  }, [book.meta.coverUrl]);

  const progressPct = Math.round(book.progress * 100);
  const hasCover = resolvedCoverUrl && !imageError;

  const vecPct = vectorProgress
    ? vectorProgress.totalChunks > 0
      ? Math.round((vectorProgress.processedChunks / vectorProgress.totalChunks) * 100)
      : 0
    : 0;

  return (
    <>
      <TouchableOpacity
        style={s.container}
        onPress={() => onOpen(book)}
        onLongPress={() => setShowActions(true)}
        delayLongPress={500}
        activeOpacity={0.7}
      >
        {/* Cover — 28:41 aspect ratio */}
        <View style={s.coverWrap}>
          {resolvedCoverUrl && !imageError ? (
            <>
              <Image
                source={{ uri: resolvedCoverUrl }}
                style={s.coverImage}
                resizeMode="cover"
                onError={() => setImageError(true)}
              />
              {/* Book spine crease overlay — matches desktop .book-spine */}
              <View style={s.spineOverlay} pointerEvents="none">
                {/* Left edge dark line */}
                <View style={s.spineStrip1} />
                {/* Spine shadow dip */}
                <View style={s.spineStrip2} />
                {/* Highlight reflection */}
                <View style={s.spineStrip3} />
                {/* Transition bright */}
                <View style={s.spineStrip4} />
                {/* Crease dark */}
                <View style={s.spineStrip5} />
                {/* Deep fold */}
                <View style={s.spineStrip6} />
                {/* Subtle bright transition */}
                <View style={s.spineStrip7} />
                {/* Right edge subtle shadow */}
                <View style={s.spineEdgeRight} />
              </View>
              {/* Top highlight */}
              <View style={s.spineTopHighlight} pointerEvents="none" />
              {/* Bottom shadow */}
              <View style={s.spineBottomShadow} pointerEvents="none" />
            </>
          ) : (
            <View style={s.fallbackCover}>
              {/* Simulate gradient: stone-100 top half, stone-200 bottom half */}
              <View style={s.fallbackGradientTop} />
              <View style={s.fallbackGradientBottom} />
              <View style={s.fallbackContentOverlay}>
                <View style={s.fallbackTitleWrap}>
                  <Text style={s.fallbackTitle} numberOfLines={3}>
                    {book.meta.title}
                  </Text>
                </View>
                <View style={s.fallbackDivider} />
                {book.meta.author ? (
                  <View style={s.fallbackAuthorWrap}>
                    <Text style={s.fallbackAuthor} numberOfLines={1}>
                      {book.meta.author}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          )}

          {/* Progress bar */}
          {progressPct > 0 && progressPct < 100 && (
            <View style={s.progressBarBg}>
              <View style={[s.progressBarFill, { width: `${progressPct}%` }]} />
            </View>
          )}

          {/* Vectorization progress overlay */}
          {isVectorizing && (
            <View style={s.vecOverlay}>
              <AnimatedLoader />
              <Text style={s.vecOverlayText}>
                {vectorProgress?.status === "chunking"
                  ? `${vecPct}%`
                  : vectorProgress?.status === "embedding"
                    ? `${vecPct}%`
                    : vectorProgress?.status === "indexing"
                      ? t("home.vec_indexing")
                      : vectorProgress?.status === "completed"
                        ? "✓"
                        : vectorProgress?.status === "error"
                          ? "✗"
                          : t("home.vec_processing")}
              </Text>
            </View>
          )}

          {/* Queued overlay */}
          {isQueued && !isVectorizing && (
            <View style={s.queuedOverlay}>
              <ClockIcon size={20} color="#fff" />
              <Text style={s.queuedOverlayText}>{t("home.vec_queued", "排队中")}</Text>
            </View>
          )}

          {/* Vectorized badge */}
          {book.isVectorized && !isVectorizing && (
            <View style={s.vecBadge}>
              <DatabaseIcon size={8} color="#fff" />
              <Text style={s.vecBadgeText}>{t("home.vec_indexed", "已索引")}</Text>
            </View>
          )}
        </View>

        {/* Info below cover */}
        <View style={s.infoWrap}>
          <Text style={s.bookTitle} numberOfLines={1}>
            {book.meta.title}
          </Text>

          {/* Tag badges */}
          {book.tags.length > 0 ? (
            <View style={s.tagsRow}>
              {book.tags.slice(0, 2).map((tag) => (
                <View key={tag} style={s.tagBadge}>
                  <Text style={s.tagText}>{tag}</Text>
                </View>
              ))}
              {book.tags.length > 2 && <Text style={s.tagOverflow}>+{book.tags.length - 2}</Text>}
            </View>
          ) : (
            <View style={s.tagsRow}>
              <View style={s.tagBadgeUncategorized}>
                <Text style={s.tagTextUncategorized}>{t("sidebar.uncategorized", "未分类")}</Text>
              </View>
            </View>
          )}

          {/* Status row */}
          <View style={s.statusRow}>
            {progressPct > 0 && progressPct < 100 ? (
              <Text style={s.progressText}>{progressPct}%</Text>
            ) : progressPct >= 100 ? (
              <Text style={s.completeText}>{t("home.complete", "已完成")}</Text>
            ) : (
              <View style={s.newBadge}>
                <Text style={s.newText}>{t("home.new", "新")}</Text>
              </View>
            )}
            <Text style={s.formatText}>{book.format || "epub"}</Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* Action Sheet (long-press menu) — matches Tauri exactly */}
      <Modal
        visible={showActions}
        transparent
        animationType="slide"
        onRequestClose={() => setShowActions(false)}
      >
        <Pressable style={s.overlay} onPress={() => setShowActions(false)} />
        <View style={s.actionSheet}>
          {/* Handle bar */}
          <View style={s.actionHandle} />

          {/* Book info header */}
          <View style={s.actionHeader}>
            <Text style={s.actionTitle} numberOfLines={1}>
              {book.meta.title}
            </Text>
            {book.meta.author ? <Text style={s.actionAuthor}>{book.meta.author}</Text> : null}
          </View>
          <View style={s.actionDivider} />

          {/* Manage tags */}
          {onManageTags && (
            <TouchableOpacity
              style={s.actionItem}
              onPress={() => {
                setShowActions(false);
                onManageTags(book);
              }}
            >
              <HashIcon size={20} color={colors.mutedForeground} />
              <Text style={s.actionLabel}>{t("home.manageTags", "管理标签")}</Text>
            </TouchableOpacity>
          )}

          {/* Vectorize */}
          {onVectorize && (
            <TouchableOpacity
              style={s.actionItem}
              onPress={() => {
                setShowActions(false);
                onVectorize(book);
              }}
            >
              <DatabaseIcon size={20} color={colors.mutedForeground} />
              <Text style={s.actionLabel}>
                {book.isVectorized
                  ? t("home.vec_reindex", "重新索引")
                  : t("home.vec_vectorize", "向量化")}
              </Text>
            </TouchableOpacity>
          )}

          {/* Delete */}
          <TouchableOpacity
            style={s.actionItemDestructive}
            onPress={() => {
              setShowActions(false);
              onDelete(book.id);
            }}
          >
            <Trash2Icon size={20} color={colors.destructive} />
            <Text style={s.actionLabelDestructive}>{t("common.remove", "删除")}</Text>
          </TouchableOpacity>

          <View style={s.actionDivider} />
          {/* Cancel */}
          <TouchableOpacity style={s.actionCancel} onPress={() => setShowActions(false)}>
            <Text style={s.actionCancelText}>{t("common.cancel", "取消")}</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
});

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { width: coverWidth },
    coverWrap: {
      width: coverWidth,
      height: coverHeight,
      borderRadius: radius.sm,
      overflow: "hidden",
      position: "relative",
      // Book cover shadow
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 4,
      elevation: 3,
    },
    coverImage: {
      width: "100%",
      height: "100%",
      borderRadius: radius.sm,
    },
    // Book spine crease effect — simulates desktop .book-spine linear-gradient overlay
    spineOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      bottom: 0,
      width: "8%",
      flexDirection: "row",
      zIndex: 2,
    },
    spineStrip1: {
      width: "6%",
      height: "100%",
      backgroundColor: "rgba(0,0,0,0.10)",
    },
    spineStrip2: {
      width: "8%",
      height: "100%",
      backgroundColor: "rgba(20,20,20,0.20)",
    },
    spineStrip3: {
      width: "5%",
      height: "100%",
      backgroundColor: "rgba(240,240,240,0.40)",
    },
    spineStrip4: {
      width: "18%",
      height: "100%",
      backgroundColor: "rgba(215,215,215,0.35)",
    },
    spineStrip5: {
      width: "12%",
      height: "100%",
      backgroundColor: "rgba(150,150,150,0.25)",
    },
    spineStrip6: {
      width: "20%",
      height: "100%",
      backgroundColor: "rgba(100,100,100,0.18)",
    },
    spineStrip7: {
      width: "31%",
      height: "100%",
      backgroundColor: "rgba(175,175,175,0.12)",
    },
    spineEdgeRight: {
      position: "absolute",
      top: 0,
      right: -coverWidth * 0.92,
      bottom: 0,
      width: coverWidth * 0.02,
      backgroundColor: "rgba(30,30,30,0.12)",
    },
    spineTopHighlight: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: "3%",
      backgroundColor: "rgba(240,240,240,0.15)",
      zIndex: 3,
    },
    spineBottomShadow: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      height: "8%",
      backgroundColor: "rgba(15,15,15,0.15)",
      zIndex: 3,
    },
    fallbackCover: {
      flex: 1,
      borderRadius: radius.sm,
      overflow: "hidden",
      position: "relative",
    },
    fallbackGradientTop: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: "50%",
      backgroundColor: colors.stone100,
    },
    fallbackGradientBottom: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      height: "50%",
      backgroundColor: colors.stone200,
    },
    fallbackContentOverlay: {
      flex: 1,
      padding: 10,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1,
    },
    fallbackTitleWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    fallbackTitle: {
      textAlign: "center",
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      fontFamily: "serif",
      color: colors.stone500,
      lineHeight: 18,
    },
    fallbackDivider: {
      width: 32,
      height: 1,
      backgroundColor: `${colors.stone300}99`,
      marginVertical: 6,
    },
    fallbackAuthorWrap: {
      height: "25%",
      alignItems: "center",
      justifyContent: "center",
    },
    fallbackAuthor: {
      textAlign: "center",
      fontSize: 12,
      fontFamily: "serif",
      color: colors.stone400,
    },
    progressBarBg: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      height: 2,
      backgroundColor: "rgba(0,0,0,0.1)",
    },
    progressBarFill: {
      height: 2,
      backgroundColor: colors.primary,
      opacity: 0.8,
    },
    // Vectorization overlay
    vecOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0,0,0,0.5)",
      borderRadius: radius.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    vecOverlayText: {
      marginTop: 6,
      fontSize: 14,
      fontWeight: fontWeight.medium,
      color: "#fff",
    },
    queuedOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0,0,0,0.35)",
      borderRadius: radius.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    queuedOverlayText: {
      marginTop: 4,
      fontSize: 12,
      fontWeight: fontWeight.medium,
      color: "#fff",
    },
    vecBadge: {
      position: "absolute",
      top: 2,
      left: 2,
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      backgroundColor: "rgba(22,163,74,0.8)",
      borderRadius: radius.sm,
      paddingHorizontal: 4,
      paddingVertical: 2,
    },
    vecBadgeText: { fontSize: 7, fontWeight: fontWeight.medium, color: "#fff" },
    infoWrap: { paddingTop: 6, paddingHorizontal: 1 },
    bookTitle: {
      fontSize: 13,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      lineHeight: 14,
    },
    tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 3, marginTop: 3 },
    tagBadge: {
      backgroundColor: `${colors.muted}`,
      borderRadius: radius.full,
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    tagText: { fontSize: 8, color: colors.mutedForeground },
    tagBadgeUncategorized: {
      backgroundColor: `${colors.muted}80`,
      borderRadius: radius.full,
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    tagTextUncategorized: { fontSize: 8, color: `${colors.mutedForeground}99` },
    tagOverflow: { fontSize: 8, color: `${colors.mutedForeground}99`, alignSelf: "center" },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 3,
      minHeight: 14,
    },
    progressText: { fontSize: 9, color: colors.mutedForeground, fontVariant: ["tabular-nums"] },
    completeText: { fontSize: 9, fontWeight: fontWeight.medium, color: "#16a34a" },
    newBadge: {
      backgroundColor: `${colors.primary}14`,
      borderRadius: radius.full,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    newText: { fontSize: 8, fontWeight: fontWeight.medium, color: colors.primary },
    formatText: {
      fontSize: 8,
      color: `${colors.mutedForeground}99`,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    // Action Sheet
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.4)",
    },
    actionSheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingBottom: 34,
    },
    actionHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.muted,
      alignSelf: "center",
      marginTop: 12,
      marginBottom: 8,
    },
    actionHeader: { paddingHorizontal: 20, paddingBottom: 12 },
    actionTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    actionAuthor: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2 },
    actionDivider: { height: 0.5, backgroundColor: colors.border },
    actionItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 20,
      paddingVertical: 14,
    },
    actionLabel: { fontSize: fontSize.base, color: colors.foreground },
    actionItemDestructive: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 20,
      paddingVertical: 14,
    },
    actionLabelDestructive: { fontSize: fontSize.base, color: colors.destructive },
    actionCancel: {
      alignItems: "center",
      paddingVertical: 14,
    },
    actionCancelText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
  });
