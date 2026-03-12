import { ChevronDownIcon, ChevronUpIcon } from "@/components/ui/Icon";
import { useTTSStore } from "@/stores";
import { type ThemeColors, fontSize, radius, useColors } from "@/styles/theme";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

function PlayIcon({ size = 24, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M8 5v14l11-7z" />
    </Svg>
  );
}

function PauseIcon({ size = 24, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M6 4h4v16H6zM14 4h4v16h-4z" />
    </Svg>
  );
}

function SquareIcon({ size = 24, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M6 6h12v12H6z" />
    </Svg>
  );
}

function Volume2Icon({ size = 24, color = "#fff" }: { size?: number; color?: string }) {
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
      <Path d="M11 5L6 9H2v6h4l5 4V5z" />
      <Path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </Svg>
  );
}

function MinusIcon({ size = 24, color = "#fff" }: { size?: number; color?: string }) {
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
      <Path d="M5 12h14" />
    </Svg>
  );
}

function PlusIcon({ size = 24, color = "#fff" }: { size?: number; color?: string }) {
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
      <Path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

interface TTSControlsProps {
  onClose: () => void;
}

export function TTSControls({ onClose }: TTSControlsProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const s = makeStyles(colors);

  const playState = useTTSStore((s) => s.playState);
  const config = useTTSStore((s) => s.config);
  const pause = useTTSStore((s) => s.pause);
  const resume = useTTSStore((s) => s.resume);
  const stop = useTTSStore((s) => s.stop);
  const updateConfig = useTTSStore((s) => s.updateConfig);

  const [expanded, setExpanded] = useState(false);

  const handleStop = useCallback(() => {
    stop();
    onClose();
  }, [stop, onClose]);

  const adjustRate = useCallback(
    (delta: number) => {
      const newRate = Math.round(Math.max(0.5, Math.min(2.0, config.rate + delta)) * 10) / 10;
      updateConfig({ rate: newRate });
    },
    [config.rate, updateConfig],
  );

  const adjustPitch = useCallback(
    (delta: number) => {
      const newPitch = Math.round(Math.max(0.5, Math.min(2.0, config.pitch + delta)) * 10) / 10;
      updateConfig({ pitch: newPitch });
    },
    [config.pitch, updateConfig],
  );

  const stateLabel =
    playState === "loading"
      ? t("tts.loading", "加载中")
      : playState === "playing"
        ? t("tts.playing", "播放中")
        : playState === "paused"
          ? t("tts.paused", "已暂停")
          : t("tts.stopped", "已停止");

  return (
    <View style={[s.container, { paddingBottom: insets.bottom || 16 }]}>
      {expanded && (
        <View style={s.expandedPanel}>
          <View style={s.settingRow}>
            <Text style={s.settingLabel}>{t("tts.rate", "语速")}</Text>
            <View style={s.settingControl}>
              <TouchableOpacity style={s.stepBtn} onPress={() => adjustRate(-0.1)}>
                <MinusIcon size={14} color={colors.foreground} />
              </TouchableOpacity>
              <Text style={s.settingValue}>{config.rate.toFixed(1)}x</Text>
              <TouchableOpacity style={s.stepBtn} onPress={() => adjustRate(0.1)}>
                <PlusIcon size={14} color={colors.foreground} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.settingRow}>
            <Text style={s.settingLabel}>{t("tts.pitch", "音调")}</Text>
            <View style={s.settingControl}>
              <TouchableOpacity style={s.stepBtn} onPress={() => adjustPitch(-0.1)}>
                <MinusIcon size={14} color={colors.foreground} />
              </TouchableOpacity>
              <Text style={s.settingValue}>{config.pitch.toFixed(1)}</Text>
              <TouchableOpacity style={s.stepBtn} onPress={() => adjustPitch(0.1)}>
                <PlusIcon size={14} color={colors.foreground} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <View style={s.mainBar}>
        <View style={s.leftSection}>
          <Volume2Icon size={16} color={colors.indigo} />
          <Text style={s.stateLabel}>{stateLabel}</Text>
        </View>

        <View style={s.centerSection}>
          <TouchableOpacity style={s.stepBtn} onPress={() => adjustRate(-0.1)}>
            <MinusIcon size={14} color={colors.foreground} />
          </TouchableOpacity>

          <Text style={s.rateLabel}>{config.rate.toFixed(1)}x</Text>

          <TouchableOpacity style={s.stepBtn} onPress={() => adjustRate(0.1)}>
            <PlusIcon size={14} color={colors.foreground} />
          </TouchableOpacity>

          <View style={s.divider} />

          <TouchableOpacity
            style={s.playBtn}
            onPress={() => {
              if (playState === "playing") pause();
              else if (playState === "paused") resume();
            }}
            disabled={playState === "loading" || playState === "stopped"}
          >
            {playState === "loading" ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : playState === "playing" ? (
              <PauseIcon size={16} color="#fff" />
            ) : (
              <PlayIcon size={16} color="#fff" />
            )}
          </TouchableOpacity>

          <TouchableOpacity style={s.stopBtn} onPress={handleStop}>
            <SquareIcon size={14} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={s.expandBtn} onPress={() => setExpanded(!expanded)}>
          {expanded ? (
            <ChevronDownIcon size={16} color={colors.mutedForeground} />
          ) : (
            <ChevronUpIcon size={16} color={colors.mutedForeground} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      zIndex: 60,
    },
    expandedPanel: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    settingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    settingLabel: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    settingControl: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    settingValue: {
      fontSize: fontSize.sm,
      color: colors.foreground,
      width: 40,
      textAlign: "center",
    },
    stepBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.lg,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    mainBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      height: 48,
    },
    leftSection: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flex: 1,
    },
    stateLabel: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
    },
    centerSection: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    rateLabel: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      width: 36,
      textAlign: "center",
    },
    divider: {
      width: 1,
      height: 16,
      backgroundColor: colors.border,
      marginHorizontal: 4,
    },
    playBtn: {
      width: 36,
      height: 36,
      borderRadius: radius.full,
      backgroundColor: colors.indigo,
      alignItems: "center",
      justifyContent: "center",
    },
    stopBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.lg,
      alignItems: "center",
      justifyContent: "center",
    },
    expandBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.lg,
      justifyContent: "center",
      flex: 1,
      alignItems: "flex-end",
    },
  });
