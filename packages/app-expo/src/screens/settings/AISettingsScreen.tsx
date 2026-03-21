import { useSettingsStore } from "@/stores";
import type { AIEndpoint, AIProviderType } from "@readany/core/types";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LoaderIcon, MinusIcon, PlusIcon, Trash2Icon, XIcon } from "../../components/ui/Icon";
import { PasswordInput } from "../../components/ui/PasswordInput";
import {
  type ThemeColors,
  fontSize,
  fontWeight,
  radius,
  spacing,
  useColors,
  withOpacity,
} from "../../styles/theme";
import { SettingsHeader } from "./SettingsHeader";

const PROVIDERS: { id: AIProviderType; label: string }[] = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "google", label: "Google" },
  { id: "deepseek", label: "DeepSeek" },
];

// Individual endpoint editor with local state
function EndpointEditor({
  ep,
  isActive,
  onUpdate,
  onDelete,
  onFetchModels,
  aiConfig,
  setActiveEndpoint,
  setActiveModel,
  colors,
  styles,
  t,
}: {
  ep: AIEndpoint;
  isActive: boolean;
  onUpdate: (id: string, updates: Partial<AIEndpoint>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onFetchModels: (ep: AIEndpoint) => Promise<void>;
  aiConfig: { activeModel: string; activeEndpointId: string };
  setActiveEndpoint: (id: string) => void;
  setActiveModel: (model: string) => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  t: TFunction;
}) {
  // Local state for form fields - only initialized once
  const [name, setName] = useState(ep.name);
  const [apiKey, setApiKey] = useState(ep.apiKey);
  const [baseUrl, setBaseUrl] = useState(ep.baseUrl);
  const [newModelInput, setNewModelInput] = useState("");

  // Refs to track latest values for unmount save
  const epRef = useRef(ep);
  epRef.current = ep;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const stateRef = useRef({ name, apiKey, baseUrl });
  stateRef.current = { name, apiKey, baseUrl };

  // Save on unmount if there are unsaved changes
  useEffect(() => {
    return () => {
      const current = epRef.current;
      const update = onUpdateRef.current;
      const state = stateRef.current;
      if (
        state.name !== current.name ||
        state.apiKey !== current.apiKey ||
        state.baseUrl !== current.baseUrl
      ) {
        update(current.id, {
          name: state.name,
          apiKey: state.apiKey,
          baseUrl: state.baseUrl,
        }).catch(console.error);
      }
    };
  }, []);

  const handleAddModel = useCallback(() => {
    const trimmed = newModelInput.trim();
    if (!trimmed || ep.models.includes(trimmed)) return;
    onUpdate(ep.id, { models: [...ep.models, trimmed] }).catch(console.error);
    setNewModelInput("");
  }, [newModelInput, ep.models, ep.id, onUpdate]);

  return (
    <View style={styles.expandedContent}>
      {/* Set as active */}
      <TouchableOpacity style={styles.row} onPress={() => setActiveEndpoint(ep.id)}>
        <Text style={styles.label}>{t("settings.ai_setDefault", "设为默认")}</Text>
        <View style={[styles.toggle, isActive && styles.toggleActive]}>
          <View style={[styles.toggleThumb, isActive && styles.toggleThumbActive]} />
        </View>
      </TouchableOpacity>

      {/* Name */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>{t("settings.ai_name", "名称")}</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          onBlur={() => {
            if (name !== ep.name) onUpdate(ep.id, { name }).catch(console.error);
          }}
          placeholderTextColor={colors.mutedForeground}
        />
      </View>

      {/* Provider grid */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>{t("settings.ai_providerLabel", "提供商")}</Text>
        <View style={styles.providerGrid}>
          {PROVIDERS.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.providerBtn, ep.provider === p.id && styles.providerBtnActive]}
              onPress={() => onUpdate(ep.id, { provider: p.id }).catch(console.error)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.providerBtnText,
                  ep.provider === p.id && styles.providerBtnTextActive,
                ]}
              >
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* API Key */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>{t("settings.ai_apiKey", "API Key")}</Text>
        <PasswordInput
          style={styles.input}
          value={apiKey}
          onChangeText={setApiKey}
          onBlur={() => {
            if (apiKey !== ep.apiKey) onUpdate(ep.id, { apiKey }).catch(console.error);
          }}
          placeholder="sk-..."
          placeholderTextColor={colors.mutedForeground}
        />
      </View>

      {/* Base URL */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>{t("settings.ai_baseUrl", "Base URL")}</Text>
        <TextInput
          style={styles.input}
          value={baseUrl}
          onChangeText={setBaseUrl}
          onBlur={() => {
            if (baseUrl !== ep.baseUrl) onUpdate(ep.id, { baseUrl }).catch(console.error);
          }}
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
        />
      </View>

      {/* Models */}
      <View style={styles.fieldGroup}>
        <View style={styles.modelsHeader}>
          <Text style={styles.fieldLabel}>{t("settings.ai_modelsList", "模型列表")}</Text>
          <TouchableOpacity
            style={styles.fetchBtn}
            onPress={() => onFetchModels(ep)}
            disabled={!!ep.modelsFetching}
          >
            {ep.modelsFetching ? (
              <LoaderIcon size={12} color={colors.primary} />
            ) : (
              <Text style={styles.fetchBtnText}>{t("settings.ai_fetchModels", "获取模型")}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Model tags */}
        <View style={styles.modelTags}>
          {ep.models.map((m) => {
            const modelActive = aiConfig.activeModel === m && isActive;
            return (
              <View key={m} style={[styles.modelTag, modelActive && styles.modelTagActive]}>
                <TouchableOpacity
                  onPress={() => {
                    setActiveEndpoint(ep.id);
                    setActiveModel(m);
                  }}
                >
                  <Text
                    style={[styles.modelTagText, modelActive && styles.modelTagTextActive]}
                    numberOfLines={1}
                  >
                    {m}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() =>
                    onUpdate(ep.id, {
                      models: ep.models.filter((x) => x !== m),
                    }).catch(console.error)
                  }
                  hitSlop={{
                    top: 4,
                    bottom: 4,
                    left: 4,
                    right: 4,
                  }}
                >
                  <XIcon size={12} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
            );
          })}
        </View>

        {/* Add model input */}
        <View style={styles.addModelRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder={t("settings.ai_addManualModelPlaceholder", "手动添加模型名")}
            placeholderTextColor={colors.mutedForeground}
            value={newModelInput}
            onChangeText={setNewModelInput}
            onSubmitEditing={handleAddModel}
          />
          <TouchableOpacity style={styles.addModelBtn} onPress={handleAddModel} activeOpacity={0.8}>
            <Text style={styles.addModelBtnText}>{t("common.add", "添加")}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Delete button */}
      <TouchableOpacity
        style={styles.deleteBtn}
        onPress={() => onDelete(ep.id)}
        activeOpacity={0.8}
      >
        <Trash2Icon size={14} color={colors.destructive} />
        <Text style={styles.deleteBtnText}>{t("common.delete", "删除")}</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function AISettingsScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { t } = useTranslation();
  const {
    aiConfig,
    addEndpoint,
    updateEndpoint,
    removeEndpoint,
    setActiveEndpoint,
    setActiveModel,
    updateAIConfig,
    fetchModels,
  } = useSettingsStore();

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleAddEndpoint = useCallback(async () => {
    await addEndpoint({
      id: `${Date.now()}`,
      name: t("settings.ai_newEndpoint", "新端点"),
      provider: "openai",
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      models: [],
      modelsFetched: false,
    });
  }, [addEndpoint, t]);

  const handleFetchModels = useCallback(
    async (ep: AIEndpoint) => {
      await updateEndpoint(ep.id, { modelsFetching: true });
      try {
        const models = await fetchModels(ep.id);
        // 自动选中第一个模型（如果当前没有选中任何模型）
        if (models.length > 0 && !aiConfig.activeModel) {
          setActiveEndpoint(ep.id);
          setActiveModel(models[0]);
        }
      } catch (err) {
        console.error("Failed to fetch models:", err);
      }
    },
    [fetchModels, updateEndpoint, aiConfig.activeModel, setActiveEndpoint, setActiveModel],
  );

  const addButton = (
    <TouchableOpacity style={styles.addBtn} onPress={handleAddEndpoint} activeOpacity={0.8}>
      <PlusIcon size={14} color={colors.primaryForeground} />
      <Text style={styles.addBtnText}>{t("common.add", "添加")}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top"]}
    >
      <SettingsHeader
        title={t("settings.ai_title", "AI 设置")}
        subtitle={t("settings.realtimeHint")}
        right={addButton}
      />

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={true}
          alwaysBounceVertical={false}
          scrollEventThrottle={16}
          overScrollMode="never"
          bounces={true}
        >
          {/* Endpoints */}
          {aiConfig.endpoints.map((ep) => {
            const isActive = ep.id === aiConfig.activeEndpointId;
            const isExpanded = expandedId === ep.id;

            return (
              <View
                key={ep.id}
                style={[styles.endpointCard, isActive && styles.endpointCardActive]}
              >
                {/* Header */}
                <TouchableOpacity
                  style={styles.endpointHeader}
                  onPress={() => setExpandedId(isExpanded ? null : ep.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.endpointInfo}>
                    <View style={styles.endpointNameRow}>
                      <Text style={styles.endpointName}>
                        {ep.name || t("common.unnamed", "未命名")}
                      </Text>
                      {isActive && (
                        <View style={styles.currentBadge}>
                          <Text style={styles.currentBadgeText}>{t("common.current", "当前")}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.endpointProvider}>{ep.provider}</Text>
                  </View>
                  <Text style={styles.chevron}>{isExpanded ? "▲" : "▼"}</Text>
                </TouchableOpacity>

                {/* Expanded Content */}
                {isExpanded && (
                  <EndpointEditor
                    ep={ep}
                    isActive={isActive}
                    onUpdate={updateEndpoint}
                    onDelete={removeEndpoint}
                    onFetchModels={handleFetchModels}
                    aiConfig={aiConfig}
                    setActiveEndpoint={setActiveEndpoint}
                    setActiveModel={setActiveModel}
                    colors={colors}
                    styles={styles}
                    t={t}
                  />
                )}
              </View>
            );
          })}

          {/* Global Settings */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{t("settings.ai_globalParams", "全局参数")}</Text>

            <View style={styles.paramRow}>
              <Text style={styles.paramLabel}>Temperature</Text>
              <View style={styles.stepperContainer}>
                <TouchableOpacity
                  style={styles.stepperBtn}
                  onPress={() => {
                    const newValue = Math.max(0, aiConfig.temperature - 0.1);
                    updateAIConfig({ temperature: Math.round(newValue * 10) / 10 });
                  }}
                  activeOpacity={0.7}
                >
                  <MinusIcon size={16} color={colors.foreground} />
                </TouchableOpacity>
                <TextInput
                  style={styles.stepperInput}
                  value={String(aiConfig.temperature)}
                  onChangeText={(v) => {
                    const num = Number.parseFloat(v);
                    if (!Number.isNaN(num) && num >= 0 && num <= 1) {
                      updateAIConfig({ temperature: num });
                    }
                  }}
                  keyboardType="decimal-pad"
                  placeholder="0.0 - 1.0"
                  textAlign="center"
                />
                <TouchableOpacity
                  style={styles.stepperBtn}
                  onPress={() => {
                    const newValue = Math.min(1, aiConfig.temperature + 0.1);
                    updateAIConfig({ temperature: Math.round(newValue * 10) / 10 });
                  }}
                  activeOpacity={0.7}
                >
                  <PlusIcon size={16} color={colors.foreground} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={[styles.paramRow, { marginTop: spacing.md }]}>
              <Text style={styles.paramLabel}>Max Tokens</Text>
              <View style={styles.stepperContainer}>
                <TouchableOpacity
                  style={styles.stepperBtn}
                  onPress={() => {
                    const newValue = Math.max(256, aiConfig.maxTokens - 256);
                    updateAIConfig({ maxTokens: newValue });
                  }}
                  activeOpacity={0.7}
                >
                  <MinusIcon size={16} color={colors.foreground} />
                </TouchableOpacity>
                <TextInput
                  style={styles.stepperInput}
                  value={String(aiConfig.maxTokens)}
                  onChangeText={(v) => {
                    const num = Number.parseInt(v, 10);
                    if (!Number.isNaN(num) && num > 0) {
                      updateAIConfig({ maxTokens: num });
                    }
                  }}
                  keyboardType="number-pad"
                  textAlign="center"
                />
                <TouchableOpacity
                  style={styles.stepperBtn}
                  onPress={() => {
                    const newValue = Math.min(32768, aiConfig.maxTokens + 256);
                    updateAIConfig({ maxTokens: newValue });
                  }}
                  activeOpacity={0.7}
                >
                  <PlusIcon size={16} color={colors.foreground} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={[styles.paramRow, { marginTop: spacing.md }]}>
              <Text style={styles.paramLabel}>{t("settings.ai_slidingWindow", "上下文窗口")}</Text>
              <View style={styles.stepperContainer}>
                <TouchableOpacity
                  style={styles.stepperBtn}
                  onPress={() => {
                    const newValue = Math.max(1, aiConfig.slidingWindowSize - 1);
                    updateAIConfig({ slidingWindowSize: newValue });
                  }}
                  activeOpacity={0.7}
                >
                  <MinusIcon size={16} color={colors.foreground} />
                </TouchableOpacity>
                <TextInput
                  style={styles.stepperInput}
                  value={String(aiConfig.slidingWindowSize)}
                  onChangeText={(v) => {
                    const num = Number.parseInt(v, 10);
                    if (!Number.isNaN(num) && num > 0) {
                      updateAIConfig({ slidingWindowSize: num });
                    }
                  }}
                  keyboardType="number-pad"
                  textAlign="center"
                />
                <TouchableOpacity
                  style={styles.stepperBtn}
                  onPress={() => {
                    const newValue = Math.min(100, aiConfig.slidingWindowSize + 1);
                    updateAIConfig({ slidingWindowSize: newValue });
                  }}
                  activeOpacity={0.7}
                >
                  <PlusIcon size={16} color={colors.foreground} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1 },
    keyboardView: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: { padding: spacing.md, gap: spacing.md },

    addBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
    },
    addBtnText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primaryForeground,
    },

    endpointCard: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      overflow: "hidden",
    },
    endpointCardActive: {
      borderColor: colors.primary,
    },
    endpointHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    endpointInfo: { flex: 1 },
    endpointNameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    endpointName: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    currentBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: radius.sm,
      backgroundColor: withOpacity(colors.primary, 0.15),
    },
    currentBadgeText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.primary,
    },
    endpointProvider: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      marginTop: 2,
    },
    chevron: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },

    expandedContent: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.md,
      gap: spacing.md,
    },

    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: spacing.xs,
    },
    label: {
      fontSize: fontSize.sm,
      color: colors.foreground,
    },
    toggle: {
      width: 44,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.muted,
      padding: 2,
    },
    toggleActive: {
      backgroundColor: colors.primary,
    },
    toggleThumb: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.background,
      transform: [{ translateX: 0 }],
    },
    toggleThumbActive: {
      transform: [{ translateX: 20 }],
    },

    fieldGroup: { gap: spacing.xs },
    fieldLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    input: {
      height: 36,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      paddingHorizontal: spacing.sm,
      fontSize: fontSize.sm,
      color: colors.foreground,
    },

    providerGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs,
    },
    providerBtn: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    providerBtnActive: {
      borderColor: colors.primary,
      backgroundColor: withOpacity(colors.primary, 0.1),
    },
    providerBtnText: {
      fontSize: fontSize.sm,
      color: colors.foreground,
    },
    providerBtnTextActive: {
      color: colors.primary,
      fontWeight: fontWeight.medium,
    },

    modelsHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    fetchBtn: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    fetchBtnText: {
      fontSize: fontSize.xs,
      color: colors.foreground,
    },
    modelTags: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs,
    },
    modelTag: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    modelTagActive: {
      borderColor: colors.primary,
      backgroundColor: withOpacity(colors.primary, 0.1),
    },
    modelTagText: {
      fontSize: fontSize.xs,
      color: colors.foreground,
      maxWidth: 120,
    },
    modelTagTextActive: {
      color: colors.primary,
      fontWeight: fontWeight.medium,
    },

    addModelRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    addModelBtn: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
    },
    addModelBtnText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primaryForeground,
    },

    deleteBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.destructive,
      backgroundColor: withOpacity(colors.destructive, 0.05),
    },
    deleteBtnText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.destructive,
    },

    sectionCard: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: spacing.md,
      gap: spacing.md,
    },
    sectionTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    sectionDesc: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },

    paramRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    paramLabel: {
      fontSize: fontSize.sm,
      color: colors.foreground,
    },
    paramValue: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primary,
    },
    paramInput: {
      width: 80,
      height: 32,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      paddingHorizontal: spacing.sm,
      fontSize: fontSize.sm,
      color: colors.foreground,
      textAlign: "right",
    },

    stepperContainer: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    stepperBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      alignItems: "center",
      justifyContent: "center",
    },
    stepperInput: {
      width: 60,
      height: 32,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      fontSize: fontSize.sm,
      color: colors.foreground,
    },
  });
