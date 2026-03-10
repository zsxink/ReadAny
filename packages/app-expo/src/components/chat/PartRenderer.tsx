/**
 * PartRenderer — renders individual message parts (text, reasoning, tool calls, citations, mindmaps).
 * React Native version adapted from app-mobile PartRenderer.
 */
import { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useThrottledValue } from "@/hooks";
import { useColors, fontSize as fs, radius, fontWeight as fw } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";
import type {
  Part,
  TextPart,
  ReasoningPart,
  ToolCallPart,
  MindmapPart,
} from "@readany/core/types/message";
import { MarkdownRenderer } from "./MarkdownRenderer";
import {
  BrainIcon,
  ChevronDownIcon,
  CheckIcon,
  XIcon,
  LoaderIcon,
} from "@/components/ui/Icon";

interface PartProps {
  part: Part;
}

export function PartRenderer({ part }: PartProps) {
  switch (part.type) {
    case "text":
      return <TextPartView part={part} />;
    case "reasoning":
      return <ReasoningPartView part={part} />;
    case "tool_call":
      return <ToolCallPartView part={part} />;
    case "citation":
      return null;
    case "mindmap":
      return <MindmapPartView part={part} />;
    default:
      return null;
  }
}

function TextPartView({ part }: { part: TextPart }) {
  const colors = useColors();
  const throttledText = useThrottledValue(part.text, 100);
  const isStreaming = part.status === "running";

  if (!throttledText.trim()) {
    if (isStreaming) {
      return (
        <View style={{ flexDirection: "row", paddingVertical: 4 }}>
          <View
            style={{
              width: 2,
              height: 16,
              borderRadius: 1,
              backgroundColor: colors.foreground,
              opacity: 0.7,
            }}
          />
        </View>
      );
    }
    return null;
  }

  return <MarkdownRenderer content={throttledText} isStreaming={isStreaming} />;
}

function ReasoningPartView({ part }: { part: ReasoningPart }) {
  const [isOpen, setIsOpen] = useState(part.status === "running");
  const throttledText = useThrottledValue(part.text, 100);
  const { t } = useTranslation();
  const colors = useColors();
  const s = makeReasoningStyles(colors);

  useEffect(() => {
    if (part.status === "running") setIsOpen(true);
  }, [part.status]);

  if (!throttledText.trim()) return null;

  return (
    <View style={s.container}>
      <TouchableOpacity
        style={s.header}
        onPress={() => setIsOpen(!isOpen)}
        activeOpacity={0.7}
      >
        <View style={s.headerLeft}>
          {part.status === "running" ? (
            <View style={s.pulsingDot} />
          ) : (
            <BrainIcon size={14} color="#7c3aed" />
          )}
          <Text style={s.headerText}>
            {part.status === "running"
              ? t("streaming.reasoningRunning", "思考中...")
              : t("streaming.reasoningDone", "思考完成")}
          </Text>
        </View>
        <View style={[s.chevron, isOpen && s.chevronOpen]}>
          <ChevronDownIcon size={14} color="#a78bfa" />
        </View>
      </TouchableOpacity>
      {isOpen && (
        <View style={s.body}>
          <Text style={s.bodyText}>{throttledText}</Text>
        </View>
      )}
    </View>
  );
}

const TOOL_LABEL_KEYS: Record<string, string> = {
  ragSearch: "toolLabels.ragSearch",
  ragToc: "toolLabels.ragToc",
  ragContext: "toolLabels.ragContext",
  summarize: "toolLabels.summarize",
  extractEntities: "toolLabels.extractEntities",
  analyzeArguments: "toolLabels.analyzeArguments",
  findQuotes: "toolLabels.findQuotes",
  getAnnotations: "toolLabels.getAnnotations",
  compareSections: "toolLabels.compareSections",
  getCurrentChapter: "toolLabels.getCurrentChapter",
  getSelection: "toolLabels.getSelection",
  getReadingProgress: "toolLabels.getReadingProgress",
  getRecentHighlights: "toolLabels.getRecentHighlights",
  getSurroundingContext: "toolLabels.getSurroundingContext",
  listBooks: "toolLabels.listBooks",
  searchAllHighlights: "toolLabels.searchAllHighlights",
  searchAllNotes: "toolLabels.searchAllNotes",
  getReadingStats: "toolLabels.getReadingStats",
  getSkills: "toolLabels.getSkills",
  mindmap: "toolLabels.mindmap",
};

function ToolCallPartView({ part }: { part: ToolCallPart }) {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useTranslation();
  const colors = useColors();
  const s = makeToolStyles(colors);

  const getStatusIcon = () => {
    switch (part.status) {
      case "pending":
        return <View style={[s.dot, { backgroundColor: colors.mutedForeground }]} />;
      case "running":
        return <ActivityIndicator size="small" color={colors.blue} />;
      case "completed":
        return <CheckIcon size={14} color={colors.emerald} />;
      case "error":
        return <XIcon size={14} color={colors.destructive} />;
      default:
        return <View style={[s.dot, { backgroundColor: colors.mutedForeground }]} />;
    }
  };

  const label = TOOL_LABEL_KEYS[part.name]
    ? t(TOOL_LABEL_KEYS[part.name])
    : part.name;
  const queryText = part.args.query ? String(part.args.query) : "";

  return (
    <View style={s.container}>
      <TouchableOpacity
        style={s.header}
        onPress={() => setIsOpen(!isOpen)}
        activeOpacity={0.7}
      >
        <View style={s.headerLeft}>
          {getStatusIcon()}
          <Text style={s.headerText} numberOfLines={1}>
            {label}
          </Text>
          {queryText ? (
            <Text style={s.queryText} numberOfLines={1}>
              {queryText.slice(0, 30)}
            </Text>
          ) : null}
        </View>
        <View style={[s.chevron, isOpen && s.chevronOpen]}>
          <ChevronDownIcon size={14} color={colors.mutedForeground} />
        </View>
      </TouchableOpacity>
      {isOpen && (
        <View style={s.body}>
          {Object.keys(part.args).length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>
                {t("common.params", "参数")}
              </Text>
              <View style={s.codeBlock}>
                {Object.entries(part.args).map(([key, value]) => (
                  <Text key={key} style={s.codeText}>
                    <Text style={s.codeKey}>{key}: </Text>
                    {typeof value === "string" && value.length > 80
                      ? `${value.slice(0, 80)}...`
                      : String(value)}
                  </Text>
                ))}
              </View>
            </View>
          )}
          {part.result !== undefined && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>
                {t("common.result", "结果")}
              </Text>
              <View style={s.codeBlock}>
                <Text style={s.codeText} numberOfLines={10}>
                  {typeof part.result === "string" && part.result.length > 300
                    ? `${part.result.slice(0, 300)}...`
                    : JSON.stringify(part.result, null, 2)}
                </Text>
              </View>
            </View>
          )}
          {part.error && (
            <View style={s.errorBlock}>
              <Text style={s.errorText}>{part.error}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function MindmapPartView({ part }: { part: MindmapPart }) {
  const colors = useColors();
  return (
    <View
      style={{
        marginVertical: 8,
        padding: 12,
        borderRadius: radius.md,
        backgroundColor: colors.muted,
      }}
    >
      <Text
        style={{
          fontSize: fs.sm,
          fontWeight: fw.semibold,
          color: colors.foreground,
          marginBottom: 6,
        }}
      >
        {part.title}
      </Text>
      <MarkdownRenderer content={part.markdown} />
    </View>
  );
}

const makeReasoningStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      marginVertical: 4,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: "#e9d5ff",
      backgroundColor: "rgba(139,92,246,0.05)",
      overflow: "hidden",
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    headerLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      flex: 1,
    },
    pulsingDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: "#a78bfa",
      opacity: 0.8,
    },
    headerText: {
      fontSize: fs.sm,
      fontWeight: fw.medium,
      color: "#7c3aed",
    },
    chevron: {},
    chevronOpen: { transform: [{ rotate: "180deg" }] },
    body: {
      borderTopWidth: 0.5,
      borderTopColor: "rgba(139,92,246,0.2)",
      backgroundColor: "rgba(255,255,255,0.3)",
      paddingHorizontal: 10,
      paddingVertical: 8,
      maxHeight: 200,
    },
    bodyText: {
      fontSize: fs.sm,
      lineHeight: 18,
      color: "#581c87",
    },
  });

const makeToolStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      marginVertical: 4,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    headerLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      flex: 1,
    },
    dot: { width: 8, height: 8, borderRadius: 4 },
    headerText: {
      fontSize: fs.sm,
      fontWeight: fw.medium,
      color: colors.foreground,
    },
    queryText: {
      flex: 1,
      fontSize: fs.xs,
      fontFamily: "Menlo",
      color: colors.mutedForeground,
    },
    chevron: {},
    chevronOpen: { transform: [{ rotate: "180deg" }] },
    body: {
      borderTopWidth: 0.5,
      borderTopColor: colors.border,
      backgroundColor: colors.muted,
      padding: 10,
      gap: 8,
    },
    section: { gap: 4 },
    sectionTitle: {
      fontSize: fs.xs,
      fontWeight: fw.medium,
      color: colors.mutedForeground,
    },
    codeBlock: {
      borderWidth: 0.5,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: radius.sm,
      padding: 8,
    },
    codeText: {
      fontSize: fs.xs,
      fontFamily: "Menlo",
      color: colors.foreground,
      lineHeight: 16,
    },
    codeKey: { color: colors.mutedForeground },
    errorBlock: {
      borderWidth: 0.5,
      borderColor: colors.destructive,
      backgroundColor: "rgba(229,57,53,0.05)",
      borderRadius: radius.sm,
      padding: 8,
    },
    errorText: {
      fontSize: fs.xs,
      color: colors.destructive,
    },
  });
