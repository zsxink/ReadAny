import {
  ChevronDownIcon,
  HeadphonesIcon,
  MinusIcon,
  PlusIcon,
} from "@/components/ui/Icon";
import { type ThemeColors, fontWeight, radius, useColors, withOpacity } from "@/styles/theme";
import {
  buildNarrationPreview,
  DASHSCOPE_VOICES,
  EDGE_TTS_VOICES,
  type TTSConfig,
  type TTSPlayState,
  getTTSVoiceLabel,
} from "@readany/core/tts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

// ── Dimensions ────────────────────────────────────────────────────────────────
const { height: SH, width: SW } = Dimensions.get("window");
// Full-size cover — 28:41 book aspect ratio
const COVER_H = Math.round(SH * 0.375);
const COVER_W = Math.round(COVER_H * (28 / 41));
// Thumbnail for lyrics header
const THUMB_W = 48;
const THUMB_H = Math.round(THUMB_W * (41 / 28)); // ≈ 70

// ── Inline SVG icons ──────────────────────────────────────────────────────────

function PlayIcon({ size = 28, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M8 5v14l11-7z" />
    </Svg>
  );
}

function PauseIcon({ size = 26, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M6 4h4v16H6zM14 4h4v16h-4z" />
    </Svg>
  );
}

function StopIcon({ size = 20, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M6 6h12v12H6z" />
    </Svg>
  );
}

/** Replay — curved arrow wrapping a filled play tip; means "restart here" */
function ReplayIcon({ size = 22, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Arc from ~4 o'clock back up to ~10 o'clock (counter-clockwise, ≈ 240°) */}
      <Path
        d="M12 5 A7 7 0 1 0 18.5 15.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      />
      {/* Arrow head pointing back to ~10 o'clock */}
      <Path
        d="M12 2 L12 8 L7.5 5 Z"
        fill={color}
      />
    </Svg>
  );
}

/** Skip to previous chapter */
function SkipBackIcon({ size = 20, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      {/* Vertical bar on left */}
      <Path d="M6 4h2v16H6z" />
      {/* Left-pointing filled triangle */}
      <Path d="M18 5 L8 12 L18 19 Z" />
    </Svg>
  );
}

/** Skip to next chapter */
function SkipForwardIcon({ size = 20, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      {/* Right-pointing filled triangle */}
      <Path d="M6 5 L16 12 L6 19 Z" />
      {/* Vertical bar on right */}
      <Path d="M16 4h2v16h-2z" />
    </Svg>
  );
}

// ── BookCoverImage — pure render helper ───────────────────────────────────────

interface BookCoverImageProps {
  coverUri?: string;
  bookTitle: string;
  chapterTitle: string;
  width: number;
  height: number;
  borderRadius: number;
  pct: number;
  colors: ThemeColors;
  t: (key: string) => string;
}

function BookCoverImage({
  coverUri,
  bookTitle,
  chapterTitle,
  width,
  height,
  borderRadius,
  pct,
  colors,
  t,
}: BookCoverImageProps) {
  const showStrip = pct > 0 && pct < 100;
  const fontSize = Math.max(8, Math.round(width * 0.055));
  const subFontSize = Math.max(7, Math.round(width * 0.042));

  return (
    <View
      style={{
        width,
        height,
        borderRadius,
        overflow: "hidden",
        backgroundColor: colors.muted,
      }}
    >
      {coverUri ? (
        <>
          {/* Cover image */}
          <Image
            source={{ uri: coverUri }}
            style={StyleSheet.absoluteFillObject}
            resizeMode="cover"
          />
          {/* Realistic book-spine gradient overlay */}
          <View
            style={[StyleSheet.absoluteFillObject, { flexDirection: "row" }]}
            pointerEvents="none"
          >
            <View style={{ width: "6%", height: "100%", backgroundColor: "rgba(0,0,0,0.10)" }} />
            <View
              style={{ width: "8%", height: "100%", backgroundColor: "rgba(20,20,20,0.20)" }}
            />
            <View
              style={{
                width: "5%",
                height: "100%",
                backgroundColor: "rgba(240,240,240,0.40)",
              }}
            />
            <View
              style={{
                width: "18%",
                height: "100%",
                backgroundColor: "rgba(215,215,215,0.35)",
              }}
            />
            <View
              style={{ flex: 1, height: "100%", backgroundColor: "rgba(100,100,100,0.10)" }}
            />
          </View>
          {/* Top highlight */}
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: "3%",
              backgroundColor: "rgba(240,240,240,0.15)",
            }}
            pointerEvents="none"
          />
          {/* Bottom shadow */}
          <View
            style={{
              position: "absolute",
              bottom: showStrip ? 2 : 0,
              left: 0,
              right: 0,
              height: "8%",
              backgroundColor: "rgba(15,15,15,0.15)",
            }}
            pointerEvents="none"
          />
        </>
      ) : (
        /* Fallback: serif gradient — mirrors BookCard style */
        <View style={{ flex: 1, overflow: "hidden" }}>
          <View
            style={{
              position: "absolute",
              inset: 0,
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: colors.stone100,
            }}
          />
          <View
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: "50%",
              backgroundColor: colors.stone200,
            }}
          />
          <View
            style={{
              flex: 1,
              padding: Math.max(6, width * 0.07),
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1,
            }}
          >
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text
                style={{
                  textAlign: "center",
                  fontSize,
                  fontWeight: fontWeight.medium,
                  fontFamily: "serif",
                  color: colors.stone500,
                  lineHeight: Math.round(fontSize * 1.45),
                }}
                numberOfLines={4}
              >
                {bookTitle || t("reader.untitled")}
              </Text>
            </View>
            <View
              style={{
                width: Math.round(width * 0.28),
                height: 1,
                backgroundColor: `${colors.stone300}99`,
                marginVertical: 5,
              }}
            />
            <View style={{ height: "22%", alignItems: "center", justifyContent: "center" }}>
              <Text
                style={{
                  textAlign: "center",
                  fontSize: subFontSize,
                  fontFamily: "serif",
                  color: colors.stone400,
                }}
                numberOfLines={1}
              >
                {chapterTitle}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Reading progress strip at bottom edge */}
      {showStrip && (
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 2,
            backgroundColor: "rgba(0,0,0,0.1)",
          }}
        >
          <View
            style={{
              height: "100%" as unknown as number,
              width: `${pct}%` as unknown as number,
              backgroundColor: colors.primary,
              opacity: 0.9,
            }}
          />
        </View>
      )}
    </View>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface TTSPageProps {
  visible: boolean;
  bookTitle: string;
  chapterTitle: string;
  coverUri?: string;
  playState: TTSPlayState;
  currentText: string;
  config: TTSConfig;
  readingProgress: number;
  currentPage: number;
  totalPages: number;
  sourceLabel: string;
  continuousEnabled: boolean;
  narrationSegments?: Array<{ text: string; cfi?: string | null }>;
  /** Sentences from the previously-read page, shown above current page sentences */
  prevNarrationSegments?: Array<{ text: string; cfi?: string | null }>;
  currentSegmentCfi?: string | null;
  currentChunkIndex?: number;
  totalChunks?: number;
  onClose: () => void;
  onReturnToReading?: () => void | Promise<void>;
  onReplay: () => void | Promise<void>;
  onPlayPause: () => void | Promise<void>;
  onStop: () => void;
  onAdjustRate: (delta: number) => void;
  onAdjustPitch: (delta: number) => void;
  onToggleContinuous: () => void;
  /**
   * Called when user taps a lyric line.
   * `offsetFromCurrent` is 0-based within the current page segments;
   * negative values mean a sentence from the previous page.
   */
  onJumpToSegment?: (offsetFromCurrent: number) => void;
  onJumpToLyricSegment?: (
    segment: { text: string; cfi?: string | null },
    offsetFromCurrent: number,
  ) => void | Promise<void>;
  onLoadMoreAbove?: () => void | Promise<void>;
  onLoadMoreBelow?: () => void | Promise<void>;
  onUpdateConfig?: (updates: Partial<TTSConfig>) => void;
  onPrevChapter?: () => void | Promise<void>;
  onNextChapter?: () => void | Promise<void>;
}

function clampPct(p: number) {
  return Math.max(0, Math.min(100, Math.round(p * 100)));
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TTSPage({
  visible,
  bookTitle,
  chapterTitle,
  coverUri,
  playState,
  currentText,
  config,
  readingProgress,
  currentPage,
  totalPages,
  continuousEnabled,
  narrationSegments,
  prevNarrationSegments,
  currentSegmentCfi,
  currentChunkIndex = 0,
  totalChunks = 0,
  onClose,
  onReturnToReading,
  onReplay,
  onPlayPause,
  onStop,
  onAdjustRate,
  onAdjustPitch,
  onToggleContinuous,
  onJumpToSegment,
  onJumpToLyricSegment,
  onLoadMoreAbove,
  onLoadMoreBelow,
  onUpdateConfig,
  onPrevChapter,
  onNextChapter,
}: TTSPageProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [voicePickerVisible, setVoicePickerVisible] = useState(false);
  const lyricScrollRef = useRef<ScrollView>(null);
  const lyricLayoutRef = useRef(new Map<number, { y: number; height: number }>());
  const userScrollingRef = useRef(false);
  const userScrollUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadMoreAboveLockRef = useRef(false);
  const loadMoreBelowLockRef = useRef(false);
  const autoScrollLockUntilRef = useRef(0);

  const fallbackPreview = useMemo(() => buildNarrationPreview(currentText), [currentText]);

  // Measured height of the lyricArea — used to compute paddingBottom so the
  // last sentence can always scroll to the vertical center of the list.
  const [lyricAreaHeight, setLyricAreaHeight] = useState(SH * 0.4);
  const onLyricAreaLayout = useCallback((e: { nativeEvent: { layout: { height: number } } }) => {
    setLyricAreaHeight(e.nativeEvent.layout.height);
  }, []);

  // Number of prev-page sentences prepended to the list (only used in fallback mode)
  // Number of prev-page sentences prepended to the list
  const prevCount =
    prevNarrationSegments?.filter((segment) => segment.text.trim().length > 0).length ?? 0;
  const lyricSegments = useMemo(() => {
    const keyCounts = new Map<string, number>();
    const toLyricItem = (
      prefix: "prev" | "curr",
      segment: { text: string; cfi?: string | null },
      index: number,
    ) => {
      const fallbackKey = segment.text.trim().slice(0, 32) || `line-${index}`;
      const baseKey = segment.cfi ? `${prefix}:${segment.cfi}` : `${prefix}:${index}:${fallbackKey}`;
      const occurrence = keyCounts.get(baseKey) ?? 0;
      keyCounts.set(baseKey, occurrence + 1);
      return {
        id: `${baseKey}:${occurrence}`,
        text: segment.text,
        cfi: segment.cfi ?? null,
      };
    };

    const prev = (prevNarrationSegments ?? [])
      .filter((segment) => segment.text.trim().length > 0)
      .map((segment, index) => toLyricItem("prev", segment, index));
    const curr = (narrationSegments ?? [])
      .filter((segment) => segment.text.trim().length > 0)
      .map((segment, index) => toLyricItem("curr", segment, index));
    if (prev.length > 0 || curr.length > 0) {
      return [...prev, ...curr];
    }
    return currentText ? [{ id: "fallback:current-text", text: currentText, cfi: null }] : [];
  }, [currentText, narrationSegments, prevNarrationSegments]);
  const lyricSegmentIdsKey = useMemo(
    () => lyricSegments.map((segment) => segment.id).join("|"),
    [lyricSegments],
  );

  // Prefer the actual spoken segment CFI so lyric centering doesn't reset when
  // the visible/current arrays are sliced or rebuilt around the current sentence.
  const safeChunkIndex = useMemo(() => {
    if (!lyricSegments.length) return 0;
    if (currentSegmentCfi) {
      const currentIndex = lyricSegments.findIndex((segment) => segment.cfi === currentSegmentCfi);
      if (currentIndex >= 0) {
        return currentIndex;
      }
    }
    const actualPrevCount = lyricSegments.filter((s) => s.id.startsWith("prev:")).length;
    const prevCountStale = prevCount !== actualPrevCount;
    if (prevCountStale) {
      const cfiInCurr =
        currentSegmentCfi && narrationSegments
          ? narrationSegments.findIndex((s) => s.cfi === currentSegmentCfi)
          : -1;
      if (cfiInCurr >= 0) {
        return Math.min(actualPrevCount + cfiInCurr, lyricSegments.length - 1);
      }
      return Math.min(actualPrevCount, lyricSegments.length - 1);
    }
    const fallback = prevCount + currentChunkIndex;
    if (fallback < lyricSegments.length) {
      return Math.max(0, fallback);
    }
    const cfiInCurr =
      currentSegmentCfi && narrationSegments
        ? narrationSegments.findIndex((s) => s.cfi === currentSegmentCfi)
        : -1;
    if (cfiInCurr >= 0) {
      return prevCount + cfiInCurr;
    }
    return Math.max(0, Math.min(prevCount, lyricSegments.length - 1));
  }, [currentChunkIndex, currentSegmentCfi, lyricSegments, narrationSegments, prevCount]);
  const lyricCenterPadding = useMemo(
    () => Math.max(40, Math.round(lyricAreaHeight / 2 - 32)),
    [lyricAreaHeight],
  );
  const currentExcerpt = lyricSegments[safeChunkIndex]?.text || fallbackPreview.currentExcerpt;
  const centerLyricIndex = useCallback(
    (index: number, animated = true) => {
      const layout = lyricLayoutRef.current.get(index);
      if (layout) {
        const targetOffset = Math.max(
          0,
          lyricCenterPadding + layout.y - (lyricAreaHeight - layout.height) / 2,
        );
        autoScrollLockUntilRef.current = Date.now() + (animated ? 800 : 250);
        if (__DEV__) {
          console.log("[TTSPage][lyrics] center", {
            index,
            animated,
            layoutY: layout.y,
            layoutHeight: layout.height,
            lyricAreaHeight,
            lyricCenterPadding,
            targetOffset,
          });
        }
        lyricScrollRef.current?.scrollTo({
          y: targetOffset,
          x: 0,
          animated,
        });
        return;
      }
      const estimatedOffset = Math.max(
        0,
        lyricCenterPadding + index * 44 - lyricAreaHeight / 2 + 22,
      );
      autoScrollLockUntilRef.current = Date.now() + (animated ? 800 : 250);
      if (__DEV__) {
        console.log("[TTSPage][lyrics] center-estimated", {
          index,
          animated,
          lyricAreaHeight,
          lyricCenterPadding,
          estimatedOffset,
        });
      }
      lyricScrollRef.current?.scrollTo({
        y: estimatedOffset,
        x: 0,
        animated,
      });
    },
    [lyricAreaHeight, lyricCenterPadding],
  );

  const pct = clampPct(readingProgress);
  const voiceLabel = getTTSVoiceLabel(config);
  const isPlaying = playState === "playing";
  const isLoading = playState === "loading";
  const chromeTopInset = Platform.OS === "android" ? Math.max(insets.top, 6) : Math.max(insets.top, 10);
  const chromeBottomInset =
    Platform.OS === "android" ? Math.max(insets.bottom, 6) : Math.max(insets.bottom, 10);

  const stateLabel =
    playState === "loading"
      ? t("tts.loading")
      : playState === "playing"
        ? t("tts.playing")
        : playState === "paused"
          ? t("tts.paused")
          : t("tts.stopped");

  const pageLabel =
    currentPage > 0 && totalPages > 0
      ? t("tts.pageProgress", { current: currentPage, total: totalPages })
      : `${pct}%`;

  const engineLabel =
    config.engine === "edge"
      ? "Edge TTS"
      : config.engine === "dashscope"
        ? "DashScope"
        : t("tts.browser");

  const pendingCenterRef = useRef<number | null>(null);

  useEffect(() => {
    if (!visible || lyricSegments.length <= 1) return;
    if (userScrollingRef.current) return;
    const targetIndex = Math.max(0, Math.min(safeChunkIndex, lyricSegments.length - 1));
    if (__DEV__) {
      console.log("[TTSPage][lyrics] active-changed", {
        currentSegmentCfi,
        currentChunkIndex,
        safeChunkIndex: targetIndex,
        lyricSegmentsLength: lyricSegments.length,
      });
    }
    if (lyricLayoutRef.current.has(targetIndex)) {
      const timer = setTimeout(() => {
        centerLyricIndex(targetIndex, true);
      }, 80);
      return () => clearTimeout(timer);
    } else {
      pendingCenterRef.current = targetIndex;
    }
  }, [centerLyricIndex, lyricSegments.length, safeChunkIndex, visible]);

  useEffect(() => {
    lyricLayoutRef.current.clear();
    pendingCenterRef.current = null;
  }, [lyricSegmentIdsKey]);

  useEffect(() => {
    return () => {
      if (userScrollUnlockTimerRef.current) {
        clearTimeout(userScrollUnlockTimerRef.current);
      }
    };
  }, []);

  const markUserScrolling = useCallback(() => {
    userScrollingRef.current = true;
    if (userScrollUnlockTimerRef.current) {
      clearTimeout(userScrollUnlockTimerRef.current);
      userScrollUnlockTimerRef.current = null;
    }
  }, []);

  const releaseUserScrolling = useCallback(() => {
    if (userScrollUnlockTimerRef.current) {
      clearTimeout(userScrollUnlockTimerRef.current);
    }
    userScrollUnlockTimerRef.current = setTimeout(() => {
      userScrollingRef.current = false;
    }, 900);
  }, []);

  const handleLyricPress = useCallback(
    (segment: { text: string; cfi?: string | null }, index: number) => {
      const offsetFromCurrent = index - prevCount;
      if (onJumpToLyricSegment) {
        onJumpToLyricSegment(segment, offsetFromCurrent);
        return;
      }
      onJumpToSegment?.(offsetFromCurrent);
    },
    [onJumpToLyricSegment, onJumpToSegment, prevCount],
  );

  const triggerLoadMoreAbove = useCallback(() => {
    if (!onLoadMoreAbove || loadMoreAboveLockRef.current) return;
    loadMoreAboveLockRef.current = true;
    onLoadMoreAbove();
    setTimeout(() => {
      loadMoreAboveLockRef.current = false;
    }, 350);
  }, [onLoadMoreAbove]);

  const triggerLoadMoreBelow = useCallback(() => {
    if (!onLoadMoreBelow || loadMoreBelowLockRef.current) return;
    loadMoreBelowLockRef.current = true;
    onLoadMoreBelow();
    setTimeout(() => {
      loadMoreBelowLockRef.current = false;
    }, 350);
  }, [onLoadMoreBelow]);

  // ── PanResponder listener removed — replaced by native ScrollView paging ──

  const s = makeStyles(colors);

  // ── Shared UI blocks ───────────────────────────────────────────────────────

  const progressBarJSX = (
    <View style={s.progress}>
      <View style={s.progressTrack}>
        <View style={[s.progressFill, { width: `${pct}%` as unknown as number }]} />
      </View>
      <View style={s.progressRow}>
        <Text style={s.progressTxt}>{pageLabel}</Text>
        <Text style={s.progressTxt}>
          {totalChunks > 0 ? `${currentChunkIndex + 1} / ${totalChunks}` : `${pct}%`}
        </Text>
      </View>
    </View>
  );

  const controlsJSX = (
    <View style={s.controls}>
      {/* Prev chapter */}
      <Pressable
        style={({ pressed }) => [s.ctrlBtnSm, pressed && { opacity: 0.5 }, !onPrevChapter && s.ctrlBtnDisabled]}
        onPress={onPrevChapter}
        hitSlop={12}
        disabled={!onPrevChapter}
        accessibilityLabel={t("tts.prevChapter")}
      >
        <SkipBackIcon size={18} color={onPrevChapter ? colors.foreground : colors.mutedForeground} />
      </Pressable>

      <Pressable
        style={({ pressed }) => [s.ctrlBtn, pressed && { opacity: 0.5 }]}
        onPress={onReplay}
        hitSlop={14}
        accessibilityLabel={t("tts.restartFromHere")}
      >
        <ReplayIcon size={20} color={colors.foreground} />
      </Pressable>

      <TouchableOpacity
        style={s.playBtn}
        onPress={onPlayPause}
        activeOpacity={0.85}
        accessibilityLabel={isPlaying ? t("tts.paused") : t("tts.playing")}
      >
        {isLoading ? (
          <ActivityIndicator size="large" color={colors.primaryForeground} />
        ) : isPlaying ? (
          <PauseIcon size={28} color={colors.primaryForeground} />
        ) : (
          <PlayIcon size={30} color={colors.primaryForeground} />
        )}
      </TouchableOpacity>

      <Pressable
        style={({ pressed }) => [s.ctrlBtn, pressed && { opacity: 0.5 }]}
        onPress={onStop}
        hitSlop={14}
        accessibilityLabel={t("common.stop")}
      >
        <StopIcon size={20} color={colors.foreground} />
      </Pressable>

      {/* Next chapter */}
      <Pressable
        style={({ pressed }) => [s.ctrlBtnSm, pressed && { opacity: 0.5 }, !onNextChapter && s.ctrlBtnDisabled]}
        onPress={onNextChapter}
        hitSlop={12}
        disabled={!onNextChapter}
        accessibilityLabel={t("tts.nextChapter")}
      >
        <SkipForwardIcon size={18} color={onNextChapter ? colors.foreground : colors.mutedForeground} />
      </Pressable>
    </View>
  );

  const settingsJSX = (
    <View style={s.settings}>
      {/* Rate stepper */}
      <View style={s.settingGroup}>
        <Text style={s.settingLbl}>{t("tts.rate")}</Text>
        <View style={s.stepper}>
          <Pressable style={s.stepBtn} onPress={() => onAdjustRate(-0.1)} hitSlop={12}>
            <MinusIcon size={10} color={colors.foreground} />
          </Pressable>
          <Text style={s.stepVal}>{config.rate.toFixed(1)}x</Text>
          <Pressable style={s.stepBtn} onPress={() => onAdjustRate(0.1)} hitSlop={12}>
            <PlusIcon size={10} color={colors.foreground} />
          </Pressable>
        </View>
      </View>

      <View style={s.settingDiv} />

      {/* Pitch stepper */}
      <View style={s.settingGroup}>
        <Text style={s.settingLbl}>{t("tts.pitch")}</Text>
        <View style={s.stepper}>
          <Pressable style={s.stepBtn} onPress={() => onAdjustPitch(-0.1)} hitSlop={12}>
            <MinusIcon size={10} color={colors.foreground} />
          </Pressable>
          <Text style={s.stepVal}>{config.pitch.toFixed(1)}</Text>
          <Pressable style={s.stepBtn} onPress={() => onAdjustPitch(0.1)} hitSlop={12}>
            <PlusIcon size={10} color={colors.foreground} />
          </Pressable>
        </View>
      </View>
    </View>
  );

  const chipsJSX = (
    <View style={s.chips}>
      {/* Engine chip — tappable if onUpdateConfig is provided */}
      <TouchableOpacity
        style={s.chip}
        onPress={() => onUpdateConfig && setVoicePickerVisible(true)}
        activeOpacity={onUpdateConfig ? 0.7 : 1}
        disabled={!onUpdateConfig}
      >
        <Text style={[s.chipTxt, onUpdateConfig ? { color: colors.primary } : null]} numberOfLines={1}>
          {engineLabel}
          {onUpdateConfig ? " ›" : ""}
        </Text>
      </TouchableOpacity>
      {/* Voice chip — tappable if onUpdateConfig is provided */}
      <TouchableOpacity
        style={s.chip}
        onPress={() => onUpdateConfig && setVoicePickerVisible(true)}
        activeOpacity={onUpdateConfig ? 0.7 : 1}
        disabled={!onUpdateConfig}
      >
        <Text style={[s.chipTxt, onUpdateConfig ? { color: colors.primary } : null]} numberOfLines={1}>
          {voiceLabel}
          {onUpdateConfig ? " ›" : ""}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const bottomStripJSX = (
    <View style={s.bottomStrip}>
      <View style={s.bottomStripLeft}>
        <TouchableOpacity
          style={s.returnBtn}
          onPress={() => {
            if (onReturnToReading) {
              onReturnToReading();
              return;
            }
            handleLyricPress(lyricSegments[safeChunkIndex] ?? { text: currentText, cfi: null }, safeChunkIndex);
          }}
          activeOpacity={0.8}
        >
          <Text style={s.returnBtnTxt}>{t("tts.returnToReading")}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.contBtn, continuousEnabled && s.contBtnOn]}
          onPress={onToggleContinuous}
          activeOpacity={0.8}
        >
          <Text style={[s.contBtnTxt, continuousEnabled && s.contBtnTxtOn]}>
            {continuousEnabled ? t("tts.autoContinuePage") : t("tts.keepPageAligned")}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Engine + voice chips — right side */}
      {chipsJSX}
    </View>
  );

  // ── Top bar ────────────────────────────────────────────────────────────────

  const topBarJSX = (
    <View
      style={[
        s.topBar,
        {
          paddingTop: chromeTopInset + (Platform.OS === "android" ? 8 : 10),
          paddingBottom: Platform.OS === "android" ? 0 : 2,
        },
      ]}
    >
      <TouchableOpacity style={s.iconBtn} onPress={onClose} activeOpacity={0.7}>
        <ChevronDownIcon size={22} color={colors.mutedForeground} />
      </TouchableOpacity>
      <View style={s.statusPill}>
        <HeadphonesIcon size={10} color={colors.primary} />
        <Text style={s.statusTxt}>{stateLabel}</Text>
      </View>
      <View style={s.iconBtn} />
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent={Platform.OS === "android"}
      navigationBarTranslucent={Platform.OS === "android"}
      hardwareAccelerated={Platform.OS === "android"}
    >
      <View style={s.screen}>
        {topBarJSX}
        <View style={s.content}>
          <View style={s.lyricHeaderRow}>
            <View style={s.thumbShadowWrap}>
              <BookCoverImage
                coverUri={coverUri}
                bookTitle={bookTitle}
                chapterTitle={chapterTitle}
                width={THUMB_W}
                height={THUMB_H}
                borderRadius={radius.sm ?? 6}
                pct={pct}
                colors={colors}
                t={t}
              />
            </View>
            <View style={s.lyricHeaderMeta}>
              <Text style={s.lyricBookName} numberOfLines={2}>
                {bookTitle || t("reader.untitled")}
              </Text>
              <Text style={s.lyricChapterName} numberOfLines={1}>
                {chapterTitle || t("tts.fromCurrentPage")}
              </Text>
            </View>
          </View>

          <View style={s.lyricArea} onLayout={onLyricAreaLayout}>
            {lyricSegments.length > 0 ? (
              <ScrollView
                ref={lyricScrollRef}
                style={s.lyricList}
                contentContainerStyle={[
                  s.lyricListContent,
                  {
                    paddingTop: lyricCenterPadding,
                    paddingBottom: lyricCenterPadding,
                    minHeight: lyricAreaHeight + lyricCenterPadding * 2,
                  },
                ]}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
                onScrollBeginDrag={markUserScrolling}
                onMomentumScrollBegin={markUserScrolling}
                onScrollEndDrag={releaseUserScrolling}
                onMomentumScrollEnd={releaseUserScrolling}
                scrollEventThrottle={16}
                onScroll={(event) => {
                  const {
                    contentOffset,
                    contentSize,
                    layoutMeasurement,
                  } = event.nativeEvent;
                  const distanceFromBottom =
                    contentSize.height - (contentOffset.y + layoutMeasurement.height);
                  const canAutoLoadMore =
                    userScrollingRef.current && Date.now() > autoScrollLockUntilRef.current;
                  if (canAutoLoadMore && contentOffset.y < 180) {
                    if (__DEV__) {
                      console.log("[TTSPage][lyrics] load-more-above", {
                        offsetY: contentOffset.y,
                      });
                    }
                    triggerLoadMoreAbove();
                  }
                  if (canAutoLoadMore && distanceFromBottom < 260) {
                    if (__DEV__) {
                      console.log("[TTSPage][lyrics] load-more-below", {
                        distanceFromBottom,
                      });
                    }
                    triggerLoadMoreBelow();
                  }
                }}
              >
                <View style={s.lyricInner}>
                  {lyricSegments.map((item, index) => {
                    const active = index === safeChunkIndex;
                    const past = index < safeChunkIndex;
                    const isFirstCurrentSegment = prevCount > 0 && index === prevCount;
                    return (
                      <View
                        key={item.id}
                        onLayout={(event) => {
                          const { y, height } = event.nativeEvent.layout;
                          lyricLayoutRef.current.set(index, { y, height });
                          if (visible && index === safeChunkIndex && !userScrollingRef.current) {
                            requestAnimationFrame(() => {
                              centerLyricIndex(index, false);
                            });
                          } else if (pendingCenterRef.current === index && !userScrollingRef.current) {
                            pendingCenterRef.current = null;
                            requestAnimationFrame(() => {
                              centerLyricIndex(index, true);
                            });
                          }
                        }}
                      >
                        {isFirstCurrentSegment ? (
                          <View style={s.lyricSectionDivider} />
                        ) : null}
                        <Pressable
                          style={[s.lyricLinePressable, active && s.lyricLinePressableActive]}
                          onPress={() => handleLyricPress(item, index)}
                        >
                          <Text
                            style={[
                              s.lyricLine,
                              active && s.lyricLineActive,
                              past && s.lyricLinePast,
                            ]}
                          >
                            {item.text}
                          </Text>
                        </Pressable>
                      </View>
                    );
                  })}

                  {continuousEnabled &&
                  playState === "playing" &&
                  safeChunkIndex >= lyricSegments.length - 1 ? (
                    <View style={s.lyricLoadingFooter}>
                      <ActivityIndicator size="small" color={colors.mutedForeground} />
                    </View>
                  ) : null}
                </View>
              </ScrollView>
            ) : (
              <Text style={s.lyricActive}>{currentExcerpt || t("tts.waitingText")}</Text>
            )}
          </View>

          {progressBarJSX}
          {controlsJSX}
          {settingsJSX}

          <View style={[s.bottom, { paddingBottom: chromeBottomInset + 10 }]}>
            {bottomStripJSX}
          </View>
        </View>
      </View>

      {/* ── Engine + Voice Picker Modal ────────────────────────────────────── */}
      <Modal
        visible={voicePickerVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setVoicePickerVisible(false)}
      >
        <View style={s.voicePickerContainer}>
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={() => setVoicePickerVisible(false)}
        />
        <View style={s.voicePickerSheet}>
          {/* Handle bar */}
          <View style={s.voicePickerHandle} />

          {/* Header */}
          <View style={s.voicePickerHeader}>
            <Text style={s.voicePickerTitle}>{t("tts.ttsEngine")}</Text>
          </View>

          {/* Engine selector */}
          <View style={s.engineSection}>
            {(["edge", "dashscope", "browser"] as const).map((eng) => {
              const isActive = config.engine === eng;
              const label =
                eng === "edge" ? "Edge TTS" : eng === "dashscope" ? "DashScope" : t("tts.browser");
              const desc =
                eng === "edge"
                  ? "Microsoft · 多语言"
                  : eng === "dashscope"
                    ? "阿里云通义 · 中文优化"
                    : "系统内置 · 免费";
              return (
                <TouchableOpacity
                  key={eng}
                  style={[s.engineRow, isActive && s.engineRowActive]}
                  onPress={() => onUpdateConfig?.({ engine: eng })}
                  activeOpacity={0.7}
                >
                  <View style={s.engineRowLeft}>
                    <Text style={[s.engineRowLabel, isActive && s.engineRowLabelActive]}>
                      {label}
                    </Text>
                    <Text style={s.engineRowDesc}>{desc}</Text>
                  </View>
                  {isActive && (
                    <View style={s.engineCheckmark}>
                      <Text style={s.engineCheckmarkTxt}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Divider + voice section title */}
          {config.engine !== "browser" && (
            <View style={s.voicePickerHeader}>
              <Text style={s.voicePickerTitle}>{t("tts.selectVoice")}</Text>
            </View>
          )}

          <ScrollView
            style={s.voicePickerList}
            showsVerticalScrollIndicator={false}
          >
            {/* DashScope voices */}
            {config.engine === "dashscope" &&
              DASHSCOPE_VOICES.map((v) => {
                const isSelected = config.dashscopeVoice === v.id;
                return (
                  <TouchableOpacity
                    key={v.id}
                    style={[s.voiceItem, isSelected && s.voiceItemSelected]}
                    onPress={() => {
                      onUpdateConfig?.({ dashscopeVoice: v.id });
                      setVoicePickerVisible(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.voiceItemTxt, isSelected && s.voiceItemTxtSelected]}>
                      {v.label}
                    </Text>
                    {isSelected && (
                      <Text style={s.voiceItemCheck}>✓</Text>
                    )}
                  </TouchableOpacity>
                );
              })}

            {/* Edge TTS voices — grouped by language, zh-* first */}
            {config.engine === "edge" &&
              (() => {
                const grouped = EDGE_TTS_VOICES.reduce<Record<string, typeof EDGE_TTS_VOICES>>(
                  (acc, v) => {
                    (acc[v.lang] ??= []).push(v);
                    return acc;
                  },
                  {},
                );
                const langs = Object.keys(grouped).sort((a, b) => {
                  const aZh = a.startsWith("zh") ? -1 : 0;
                  const bZh = b.startsWith("zh") ? -1 : 0;
                  return aZh - bZh || a.localeCompare(b);
                });
                return langs.map((lang) => (
                  <View key={lang}>
                    <View style={s.voiceLangHeader}>
                      <Text style={s.voiceLangTxt}>{lang}</Text>
                    </View>
                    {grouped[lang].map((v) => {
                      const isSelected = config.edgeVoice === v.id;
                      return (
                        <TouchableOpacity
                          key={v.id}
                          style={[s.voiceItem, isSelected && s.voiceItemSelected]}
                          onPress={() => {
                            onUpdateConfig?.({ edgeVoice: v.id });
                            setVoicePickerVisible(false);
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={[s.voiceItemTxt, isSelected && s.voiceItemTxtSelected]}>
                            {v.name}
                          </Text>
                          {isSelected && (
                            <Text style={s.voiceItemCheck}>✓</Text>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ));
              })()}

            {/* Browser — no selectable voices */}
            {config.engine === "browser" && (
              <View style={s.voiceBrowserNote}>
                <Text style={s.voiceBrowserNoteTxt}>
                  {t("tts.browserVoiceNote")}
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Cancel button */}
          <TouchableOpacity
            style={s.voicePickerCancel}
            onPress={() => setVoicePickerVisible(false)}
            activeOpacity={0.7}
          >
            <Text style={s.voicePickerCancelTxt}>{t("common.cancel")}</Text>
          </TouchableOpacity>
        </View>
        </View>
      </Modal>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      flex: 1,
      backgroundColor: colors.background,
    },

    // ── Pager (native horizontal ScrollView) ─────────────────────────────
    pager: {
      flex: 1,
    },
    pagerContent: {
      // contentContainerStyle — pages define their own width via s.page
    },
    page: {
      width: SW,
      flex: 1,
      flexDirection: "column",
      backgroundColor: colors.background,
    },

    // ── Top bar — sits above the pager, never scrolls ─────────────────────
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingTop: 52,
      paddingBottom: 4,
    },
    iconBtn: {
      width: 40,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    statusPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: withOpacity(colors.primary, 0.1),
    },
    statusTxt: {
      fontSize: 11,
      fontWeight: fontWeight.semibold,
      color: colors.primary,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    // ── Cover section ─────────────────────────────────────────────────────
    coverSection: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 8,
    },
    /**
     * Ambient glow effect — intentionally NO backgroundColor.
     * Without a fill, this is invisible as a shape; the shadow
     * properties alone produce the soft halo on iOS (shadowColor /
     * shadowRadius). On Android the elevation tint from the cover
     * itself provides the same effect.
     */
    glow: {
      position: "absolute",
      width: COVER_W + 60,
      height: COVER_H + 40,
      borderRadius: (COVER_W + 60) / 2,
      // NO backgroundColor — this was the source of the "圆环" ring artifact
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.22,
      shadowRadius: 64,
    },
    coverShadow: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 18 },
      shadowOpacity: 0.28,
      shadowRadius: 32,
      elevation: 16,
    },

    // ── Book info below cover ─────────────────────────────────────────────
    bookInfo: {
      alignItems: "center",
      paddingHorizontal: 36,
      paddingTop: 4,
      paddingBottom: 8,
    },
    bookTitle: {
      fontSize: 18,
      fontWeight: fontWeight.bold,
      color: colors.foreground,
      textAlign: "center",
      lineHeight: 26,
    },
    bookChapter: {
      fontSize: 14,
      color: colors.mutedForeground,
      textAlign: "center",
      lineHeight: 20,
      marginTop: 2,
    },

    // ── Progress bar ──────────────────────────────────────────────────────
    progress: {
      paddingHorizontal: 24,
      paddingBottom: 8,
    },
    progressTrack: {
      height: 3,
      borderRadius: 999,
      backgroundColor: withOpacity(colors.border, 0.45),
      overflow: "hidden",
    },
    progressFill: {
      height: "100%" as unknown as number,
      borderRadius: 999,
      backgroundColor: colors.primary,
    },
    progressRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 5,
    },
    progressTxt: {
      fontSize: 10,
      color: colors.mutedForeground,
    },

    // ── Transport controls ─────────────────────────────────────────────────
    controls: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 20,
      paddingVertical: 4,
      paddingBottom: 10,
    },
    ctrlBtn: {
      width: 46,
      height: 46,
      borderRadius: 23,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: withOpacity(colors.muted, 0.7),
    },
    /** Smaller secondary button for prev/next chapter */
    ctrlBtnSm: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: withOpacity(colors.muted, 0.5),
    },
    ctrlBtnDisabled: {
      opacity: 0.3,
    },
    playBtn: {
      width: 68,
      height: 68,
      borderRadius: 34,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35,
      shadowRadius: 16,
      elevation: 10,
    },

    // ── Settings row ──────────────────────────────────────────────────────
    settings: {
      flexDirection: "row",
      alignItems: "center",
      marginHorizontal: 20,
      marginBottom: 8,
      borderRadius: 16,
      backgroundColor: withOpacity(colors.muted, 0.5),
      paddingHorizontal: 18,
      paddingVertical: 12,
    },
    settingGroup: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    settingLbl: {
      fontSize: 11,
      color: colors.mutedForeground,
      fontWeight: fontWeight.medium,
    },
    stepper: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
    },
    stepBtn: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: withOpacity(colors.border, 0.6),
    },
    stepVal: {
      fontSize: 12,
      color: colors.foreground,
      fontWeight: fontWeight.semibold,
      minWidth: 30,
      textAlign: "center",
    },
    settingDiv: {
      width: 1,
      height: 20,
      backgroundColor: withOpacity(colors.border, 0.5),
      marginHorizontal: 10,
    },
    contBtn: {
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 4,
      backgroundColor: withOpacity(colors.background, 0.7),
      borderWidth: 1,
      borderColor: withOpacity(colors.border, 0.5),
    },
    contBtnOn: {
      backgroundColor: withOpacity(colors.primary, 0.12),
      borderColor: withOpacity(colors.primary, 0.3),
    },
    contBtnTxt: {
      fontSize: 10,
      fontWeight: fontWeight.semibold,
      color: colors.mutedForeground,
    },
    contBtnTxtOn: {
      color: colors.primary,
    },

    // ── Bottom row ────────────────────────────────────────────────────────
    bottom: {
      alignItems: "center",
      justifyContent: "center",
      paddingBottom: 34,
      paddingTop: 4,
    },
    /** Bottom strip — continuous toggle on left, chips on right */
    bottomStrip: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      width: "100%" as unknown as number,
      gap: 8,
    },
    bottomStripLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexShrink: 1,
    },
    returnBtn: {
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: withOpacity(colors.primary, 0.1),
      borderWidth: 1,
      borderColor: withOpacity(colors.primary, 0.22),
    },
    returnBtnTxt: {
      fontSize: 10,
      fontWeight: fontWeight.semibold,
      color: colors.primary,
    },
    /** Animated page indicator — inner container */
    pageIndicator: {
      // PILL_W(18) + GAP(5) + DOT(6) = 29 — all children are absolutely positioned
      width: 29,
      height: 6,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: withOpacity(colors.mutedForeground, 0.65),
    },
    /** Helper — makes a dot absolutely positioned within pageIndicator */
    dotAbs: {
      position: "absolute",
      top: 0,
    },
    /** Animated pill — absolutely positioned at left:0, translateX 0→11 */
    dotPill: {
      position: "absolute",
      top: 0,
      left: 0,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.primary,
    },
    chips: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    chip: {
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: withOpacity(colors.muted, 0.9),
      maxWidth: 130,
    },
    chipTxt: {
      fontSize: 10,
      color: colors.mutedForeground,
      fontWeight: fontWeight.medium,
    },

    // ── Lyrics view ───────────────────────────────────────────────────────

    /** Thumbnail + book meta side by side below top bar */
    lyricHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 22,
      paddingVertical: 10,
      gap: 14,
    },
    thumbShadowWrap: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.18,
      shadowRadius: 8,
      elevation: 6,
    },
    lyricHeaderMeta: {
      flex: 1,
    },
    lyricBookName: {
      fontSize: 15,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      lineHeight: 22,
    },
    lyricChapterName: {
      fontSize: 12,
      color: colors.mutedForeground,
      lineHeight: 18,
      marginTop: 3,
    },

    /** Karaoke text area — centered, fills remaining space */
    lyricArea: {
      flex: 1,
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 16,
      alignSelf: "stretch",
    },
    lyricList: {
      flex: 1,
      alignSelf: "stretch",
    },
    lyricListContent: {
      justifyContent: "center",
    },
    lyricInner: {
      gap: 8,
    },
    lyricLinePressable: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 18,
    },
    lyricLinePressableActive: {
      backgroundColor: withOpacity(colors.foreground, 0.05),
    },
    lyricLine: {
      fontSize: 16,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
      textAlign: "center",
      lineHeight: 27,
      opacity: 0.32,
    },
    lyricLineActive: {
      fontSize: 22,
      fontWeight: fontWeight.bold,
      lineHeight: 34,
      opacity: 1,
      color: colors.foreground,
    },
    lyricLinePast: {
      opacity: 0.58,
    },
    lyricContextLabel: {
      fontSize: 11,
      color: colors.mutedForeground,
      textAlign: "center",
      marginBottom: 8,
    },
    lyricSectionDivider: {
      height: 1,
      backgroundColor: colors.mutedForeground,
      opacity: 0.2,
      marginVertical: 10,
      marginHorizontal: 16,
    },
    lyricHintLabel: {
      fontSize: 11,
      color: colors.mutedForeground,
      textAlign: "center",
      marginTop: 8,
    },
    lyricLoadingFooter: {
      alignItems: "center",
      paddingVertical: 16,
      opacity: 0.5,
    },
    lyricActive: {
      fontSize: 18,
      fontWeight: fontWeight.bold,
      color: colors.foreground,
      textAlign: "center",
      lineHeight: 28,
    },

    // ── Engine + Voice picker bottom sheet ───────────────────────────────
    voicePickerContainer: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    voicePickerSheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingBottom: 34,
      maxHeight: SH * 0.82,
    },
    voicePickerHandle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      alignSelf: "center",
      marginTop: 12,
      marginBottom: 4,
    },
    voicePickerHeader: {
      paddingHorizontal: 20,
      paddingTop: 14,
      paddingBottom: 8,
    },
    voicePickerTitle: {
      fontSize: 11,
      fontWeight: fontWeight.semibold,
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.9,
    },
    // Engine selector rows
    engineSection: {
      marginHorizontal: 16,
      marginBottom: 4,
      borderRadius: 14,
      overflow: "hidden",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    engineRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 13,
      backgroundColor: colors.background,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withOpacity(colors.border, 0.5),
    },
    engineRowActive: {
      backgroundColor: withOpacity(colors.primary, 0.06),
    },
    engineRowLeft: {
      flex: 1,
    },
    engineRowLabel: {
      fontSize: 15,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    engineRowLabelActive: {
      color: colors.primary,
      fontWeight: fontWeight.semibold,
    },
    engineRowDesc: {
      fontSize: 11,
      color: colors.mutedForeground,
      marginTop: 2,
    },
    engineCheckmark: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      marginLeft: 12,
    },
    engineCheckmarkTxt: {
      fontSize: 13,
      color: "#fff",
      fontWeight: fontWeight.bold,
    },
    // Voice list
    voicePickerList: {
      flexGrow: 0,
    },
    voiceLangHeader: {
      paddingHorizontal: 20,
      paddingVertical: 6,
      backgroundColor: withOpacity(colors.muted, 0.6),
    },
    voiceLangTxt: {
      fontSize: 10,
      fontWeight: fontWeight.semibold,
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    voiceItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingVertical: 15,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withOpacity(colors.border, 0.4),
    },
    voiceItemSelected: {
      backgroundColor: withOpacity(colors.primary, 0.06),
    },
    voiceItemTxt: {
      fontSize: 15,
      color: colors.foreground,
    },
    voiceItemTxtSelected: {
      fontWeight: fontWeight.semibold,
      color: colors.primary,
    },
    voiceItemCheck: {
      fontSize: 15,
      fontWeight: fontWeight.bold,
      color: colors.primary,
    },
    voiceBrowserNote: {
      padding: 28,
      alignItems: "center",
    },
    voiceBrowserNoteTxt: {
      fontSize: 14,
      color: colors.mutedForeground,
      textAlign: "center",
      lineHeight: 20,
    },
    voicePickerCancel: {
      marginHorizontal: 16,
      marginTop: 12,
      paddingVertical: 15,
      borderRadius: 14,
      backgroundColor: colors.muted,
      alignItems: "center",
    },
    voicePickerCancelTxt: {
      fontSize: 15,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
  });
