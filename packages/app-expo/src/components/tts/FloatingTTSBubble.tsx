/**
 * FloatingTTSBubble — Global draggable mini-player shown when TTS is active.
 *
 * Rendered as a sibling to NavigationContainer in AppInner so it floats
 * above every screen. Tapping it expands a compact player modal.
 *
 * Design:
 * - Bubble always shows headphones icon (no play/pause switching)
 * - Pulsing ring animation when playing; no animation when paused
 * - No X close badge — stop is inside the expanded mini player
 * - Tap bubble → toggle mini player
 * - Long press bubble → stop TTS
 */
import { useTTSStore } from "@/stores";
import { useReaderStore } from "@/stores/reader-store";
import { fontSize, radius, useColors } from "@/styles/theme";
import { pushRoute } from "@/lib/navigationRef";
import { eventBus } from "@readany/core/utils/event-bus";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  LayoutChangeEvent,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

// ─── Icons ───────────────────────────────────────────────────────────────────

function HeadphonesIcon({ size = 22, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <Path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </Svg>
  );
}

function PlayIcon({ size = 20, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M8 5v14l11-7z" />
    </Svg>
  );
}

function PauseIcon({ size = 20, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M6 4h4v16H6zM14 4h4v16h-4z" />
    </Svg>
  );
}

function SquareIcon({ size = 16, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M6 6h12v12H6z" />
    </Svg>
  );
}

function BookOpenIcon({ size = 16, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <Path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </Svg>
  );
}

function LyricsIcon({ size = 16, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M5 7h14" />
      <Path d="M5 12h14" />
      <Path d="M5 17h10" />
    </Svg>
  );
}

// ─── Compact expanded player modal ───────────────────────────────────────────

function TTSMiniPlayer({
  visible,
  onClose,
  anchorLayout,
}: {
  visible: boolean;
  onClose: () => void;
  anchorLayout: { left: number; top: number; size: number; screenWidth: number; screenHeight: number } | null;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const playState = useTTSStore((s) => s.playState);
  const currentBookTitle = useTTSStore((s) => s.currentBookTitle);
  const currentChapterTitle = useTTSStore((s) => s.currentChapterTitle);
  const currentBookId = useTTSStore((s) => s.currentBookId);
  const currentLocationCfi = useTTSStore((s) => s.currentLocationCfi);
  const goToCfiFn = useReaderStore((s) => s.goToCfiFn);
  const config = useTTSStore((s) => s.config);
  const pause = useTTSStore((s) => s.pause);
  const resume = useTTSStore((s) => s.resume);
  const stop = useTTSStore((s) => s.stop);
  const updateConfig = useTTSStore((s) => s.updateConfig);

  const handleStop = useCallback(() => {
    stop();
    onClose();
  }, [stop, onClose]);

  const handleJumpToCurrentLocation = useCallback(() => {
    let handled = false;
    if (currentBookId && currentLocationCfi) {
      eventBus.emit("tts:jump-to-current", {
        bookId: currentBookId,
        cfi: currentLocationCfi,
        respond: () => {
          handled = true;
        },
      });
    }
    if (!handled && currentLocationCfi && goToCfiFn) {
      goToCfiFn(currentLocationCfi);
      onClose();
      return;
    }
    if (!handled && currentBookId) {
      pushRoute("Reader", { bookId: currentBookId, cfi: currentLocationCfi || undefined });
    }
    onClose();
  }, [currentBookId, currentLocationCfi, goToCfiFn, onClose]);

  const handleOpenLyricsPage = useCallback(() => {
    if (!currentBookId) return;
    let handled = false;
    eventBus.emit("tts:open-lyrics-page", {
      bookId: currentBookId,
      respond: () => {
        handled = true;
      },
    });
    if (!handled) {
      pushRoute("Reader", { bookId: currentBookId, cfi: currentLocationCfi || undefined });
      setTimeout(() => {
        eventBus.emit("tts:open-lyrics-page", { bookId: currentBookId });
      }, 450);
    }
    onClose();
  }, [currentBookId, currentLocationCfi, onClose]);

  const handlePlayPause = useCallback(() => {
    if (playState === "playing") {
      pause();
    } else if (playState === "paused") {
      resume();
    }
  }, [playState, pause, resume]);

  const adjustRate = useCallback(
    (delta: number) => {
      const newRate = Math.round(Math.max(0.5, Math.min(2.0, config.rate + delta)) * 10) / 10;
      updateConfig({ rate: newRate });
    },
    [config.rate, updateConfig],
  );

  // Pulse animation for the headphones icon when playing
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (playState === "playing") {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
      anim.start();
      return () => anim.stop();
    }
    pulseAnim.setValue(1);
  }, [playState, pulseAnim]);

  const statusText =
    playState === "loading"
      ? "加载中…"
      : playState === "playing"
        ? "播放中"
        : playState === "paused"
          ? "已暂停"
          : "已停止";

  const panelWidth = Math.min(388, Math.max(320, (anchorLayout?.screenWidth || 360) - 16));
  const [panelHeight, setPanelHeight] = useState(152);
  const [panelMeasured, setPanelMeasured] = useState(false);
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
  const anchor = anchorLayout ?? {
    left: 16,
    top: 120,
    size: BUBBLE_SIZE,
    screenWidth: Dimensions.get("window").width,
    screenHeight: Dimensions.get("window").height,
  };
  const left = clamp(
    anchor.left + anchor.size / 2 - panelWidth / 2,
    10,
    anchor.screenWidth - panelWidth - 10,
  );
  const aboveGap = 10;
  const belowGap = 10;
  const safeTop = (insets.top || 12) + 8;
  const safeBottom = anchor.screenHeight - panelHeight - Math.max(insets.bottom, 16) - 8;
  const aboveTop = anchor.top - panelHeight - aboveGap;
  const belowTop = anchor.top + anchor.size + belowGap;
  const canPlaceAbove = aboveTop >= safeTop;
  const canPlaceBelow = belowTop <= safeBottom;
  const top = canPlaceAbove
    ? aboveTop
    : canPlaceBelow
      ? belowTop
      : clamp(belowTop, safeTop, safeBottom);

  const handlePanelLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height || 0);
    if (nextHeight > 0) {
      if (nextHeight !== panelHeight) {
        setPanelHeight(nextHeight);
      }
      if (!panelMeasured) {
        setPanelMeasured(true);
      }
    }
  }, [panelHeight, panelMeasured]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={StyleSheet.absoluteFillObject}
        onPress={onClose}
        accessible={false}
      />
      <View
        style={[
          styles.miniPlayerContainer,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            left,
            top,
            width: panelWidth,
            opacity: panelMeasured || !visible ? 1 : 0,
          },
        ]}
        pointerEvents="box-none"
        onLayout={handlePanelLayout}
      >
        {/* Header row */}
        <View style={styles.miniPlayerHeader}>
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <HeadphonesIcon size={18} color={colors.primary} />
          </Animated.View>
          <View style={styles.miniPlayerTitleGroup}>
            <Text style={[styles.miniPlayerBook, { color: colors.foreground }]} numberOfLines={1}>
              {currentBookTitle || "正在听书"}
            </Text>
            {!!currentChapterTitle && (
              <Text
                style={[styles.miniPlayerChapter, { color: colors.mutedForeground }]}
                numberOfLines={1}
              >
                {currentChapterTitle}
              </Text>
            )}
          </View>
          <Text style={[styles.miniPlayerStatus, { color: colors.mutedForeground }]}>
            {statusText}
          </Text>
        </View>

        {/* Divider */}
        <View style={[styles.miniPlayerDivider, { backgroundColor: colors.border }]} />

        {/* Controls row */}
        <View style={styles.miniPlayerControls}>
          {/* Rate adjust */}
          <TouchableOpacity
            style={[styles.miniPlayerRateBtn, { backgroundColor: colors.muted }]}
            onPress={() => adjustRate(-0.1)}
          >
            <Text style={[styles.miniPlayerRateText, { color: colors.foreground }]}>−</Text>
          </TouchableOpacity>

          <Text style={[styles.miniPlayerRateValue, { color: colors.mutedForeground }]}>
            {config.rate.toFixed(1)}x
          </Text>

          <TouchableOpacity
            style={[styles.miniPlayerRateBtn, { backgroundColor: colors.muted }]}
            onPress={() => adjustRate(0.1)}
          >
            <Text style={[styles.miniPlayerRateText, { color: colors.foreground }]}>+</Text>
          </TouchableOpacity>

          <View style={[styles.miniPlayerDividerV, { backgroundColor: colors.border }]} />

          {/* Play/Pause */}
          <TouchableOpacity
            style={[styles.miniPlayerPlayBtn, { backgroundColor: colors.primary }]}
            onPress={handlePlayPause}
            disabled={playState === "loading" || playState === "stopped"}
          >
            {playState === "loading" ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : playState === "playing" ? (
              <PauseIcon size={20} color={colors.primaryForeground} />
            ) : (
              <PlayIcon size={20} color={colors.primaryForeground} />
            )}
          </TouchableOpacity>

          {/* Stop */}
          <TouchableOpacity
            style={[styles.miniPlayerStopBtn, { backgroundColor: colors.muted }]}
            onPress={handleStop}
            accessibilityRole="button"
            accessibilityLabel={t("tts.stop", "停止")}
          >
            <SquareIcon size={16} color={colors.foreground} />
          </TouchableOpacity>

          {!!currentBookId && <View style={[styles.miniPlayerDividerV, { backgroundColor: colors.border }]} />}

          {!!currentBookId && (
            <TouchableOpacity
              style={[styles.miniPlayerGoBtn, { backgroundColor: colors.muted }]}
              onPress={handleJumpToCurrentLocation}
              accessibilityRole="button"
              accessibilityLabel={t("tts.jumpToCurrentLocation")}
            >
              <BookOpenIcon size={16} color={colors.foreground} />
            </TouchableOpacity>
          )}

          {!!currentBookId && (
            <TouchableOpacity
              style={[styles.miniPlayerGoBtn, { backgroundColor: colors.muted }]}
              onPress={handleOpenLyricsPage}
              accessibilityRole="button"
              accessibilityLabel={t("tts.openLyricsPage", "跳到歌词页")}
            >
              <LyricsIcon size={16} color={colors.foreground} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Main floating bubble ─────────────────────────────────────────────────────

export function FloatingTTSBubble() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

  const playState = useTTSStore((s) => s.playState);

  const [showPlayer, setShowPlayer] = useState(false);
  const [bubbleOffset, setBubbleOffset] = useState({ x: 0, y: 0 });
  const [anchorLayout, setAnchorLayout] = useState<{
    left: number;
    top: number;
    size: number;
    screenWidth: number;
    screenHeight: number;
  } | null>(null);

  // Only show when TTS is active (playing or paused)
  const isActive = playState === "playing" || playState === "paused" || playState === "loading";

  // When TTS stops, close the mini player
  useEffect(() => {
    if (!isActive) {
      setShowPlayer(false);
    }
  }, [isActive]);

  // Draggable position — starts at bottom right
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const bubbleRight = useRef(20);
  const bubbleBottom = useRef(120);
  const bubbleRef = useRef<View>(null);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 5 || Math.abs(gs.dy) > 5,
      onPanResponderGrant: () => {
        pan.setOffset({ x: (pan.x as any)._value, y: (pan.y as any)._value });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: () => {
        pan.flattenOffset();
      },
    }),
  ).current;

  useEffect(() => {
    const id = pan.addListener((value) => {
      setBubbleOffset({ x: value.x, y: value.y });
    });
    return () => {
      pan.removeListener(id);
    };
  }, [pan]);

  // Ripple pulse rings — only when playing
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (playState === "playing") {
      const makeRipple = (anim: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(anim, {
              toValue: 1,
              duration: 1600,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
          ]),
        );

      const a1 = makeRipple(ring1, 0);
      const a2 = makeRipple(ring2, 700);
      a1.start();
      a2.start();
      return () => {
        a1.stop();
        a2.stop();
      };
    }
    ring1.setValue(0);
    ring2.setValue(0);
  }, [playState, ring1, ring2]);

  const makeRingStyle = (anim: Animated.Value) => ({
    transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.0] }) }],
    opacity: anim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.35, 0] }),
  });

  const handleBubbleTap = useCallback(() => {
    setShowPlayer((v) => !v);
  }, []);

  const measureBubble = useCallback(() => {
    requestAnimationFrame(() => {
      bubbleRef.current?.measureInWindow((left, top, width, height) => {
        if (width > 0 && height > 0) {
          setAnchorLayout({
            left,
            top,
            size: Math.max(width, height),
            screenWidth,
            screenHeight,
          });
        }
      });
    });
  }, [screenHeight, screenWidth]);

  useEffect(() => {
    if (!isActive) {
      setAnchorLayout(null);
      return;
    }
    measureBubble();
  }, [bubbleOffset.x, bubbleOffset.y, isActive, measureBubble, showPlayer]);

  return (
    <>
      {/* Draggable bubble — only rendered when active */}
      {isActive && (
        <Animated.View
          ref={bubbleRef}
          collapsable={false}
          style={[
            styles.bubbleWrapper,
            {
              right: bubbleRight.current,
              bottom: bubbleBottom.current + (insets.bottom || 0),
              transform: pan.getTranslateTransform(),
            },
          ]}
          {...panResponder.panHandlers}
        >
          {/* Ripple rings — playing only */}
          <Animated.View
            style={[styles.bubbleRing, { backgroundColor: colors.primary }, makeRingStyle(ring1)]}
            pointerEvents="none"
          />
          <Animated.View
            style={[styles.bubbleRing, { backgroundColor: colors.primary }, makeRingStyle(ring2)]}
            pointerEvents="none"
          />

          {/* Main bubble */}
          <TouchableOpacity
            style={[styles.bubble, { backgroundColor: colors.primary }]}
            onPress={handleBubbleTap}
            activeOpacity={0.85}
          >
            {playState === "loading" ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <HeadphonesIcon size={22} color={colors.primaryForeground} />
            )}
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Mini player modal — visible prop controls it independently so it
          can animate out even as isActive drops to false */}
      <TTSMiniPlayer
        visible={showPlayer && isActive}
        onClose={() => setShowPlayer(false)}
        anchorLayout={anchorLayout}
      />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const BUBBLE_SIZE = 56;

const styles = StyleSheet.create({
  bubbleWrapper: {
    position: "absolute",
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    zIndex: 9999,
  },
  bubbleRing: {
    position: "absolute",
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    top: 0,
    left: 0,
  },
  bubble: {
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 12,
  },
  // Mini player
  miniPlayerContainer: {
    position: "absolute",
    borderRadius: radius.xl,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 20,
    overflow: "hidden",
  },
  miniPlayerHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  miniPlayerTitleGroup: {
    flex: 1,
    gap: 2,
  },
  miniPlayerBook: {
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  miniPlayerChapter: {
    fontSize: fontSize.xs,
  },
  miniPlayerStatus: {
    fontSize: fontSize.xs,
  },
  miniPlayerDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
  },
  miniPlayerControls: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  miniPlayerRateBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  miniPlayerRateText: {
    fontSize: 18,
    fontWeight: "500",
    lineHeight: 20,
  },
  miniPlayerRateValue: {
    fontSize: fontSize.xs,
    width: 40,
    textAlign: "center",
  },
  miniPlayerDividerV: {
    width: StyleSheet.hairlineWidth,
    height: 24,
    marginHorizontal: 2,
  },
  miniPlayerPlayBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  miniPlayerStopBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  miniPlayerGoBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
});
