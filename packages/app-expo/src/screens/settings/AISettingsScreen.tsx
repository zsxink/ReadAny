import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores";
import type { AIEndpoint, AIProviderType } from "@readany/core/types";
import { SettingsHeader } from "./SettingsHeader";
import { PlusIcon, Trash2Icon, XIcon, LoaderIcon } from "../../components/ui/Icon";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { type ThemeColors, fontSize, fontWeight, spacing, radius, useColors, withOpacity } from "../../styles/theme";

const PROVIDERS: { id: AIProviderType; label: string }[] = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "google", label: "Google" },
  { id: "deepseek", label: "DeepSeek" },
];

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
  const [newModelInput, setNewModelInput] = useState("");
  const [manualModelInput, setManualModelInput] = useState("");

  const activeEndpoint = aiConfig.endpoints.find((ep) => ep.id === aiConfig.activeEndpointId);

  const handleAddEndpoint = useCallback(() => {
    addEndpoint({
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
      updateEndpoint(ep.id, { modelsFetching: true });
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

  const handleAddManualModel = useCallback(
    (endpointId: string, models: string[]) => {
      const trimmed = newModelInput.trim();
      if (!trimmed || models.includes(trimmed)) return;
      updateEndpoint(endpointId, { models: [...models, trimmed] });
      setNewModelInput("");
    },
    [newModelInput, updateEndpoint],
  );

  const addButton = (
    <TouchableOpacity
      style={styles.addBtn}
      onPress={handleAddEndpoint}
      activeOpacity={0.8}
    >
      <PlusIcon size={14} color={colors.primaryForeground} />
      <Text style={styles.addBtnText}>{t("common.add", "添加")}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
      <SettingsHeader
        title={t("settings.ai_title", "AI 设置")}
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
        >
        {/* Endpoints */}
        {aiConfig.endpoints.map((ep) => {
          const isActive = ep.id === aiConfig.activeEndpointId;
          const isExpanded = expandedId === ep.id;

          return (
            <View
              key={ep.id}
              style={[
                styles.endpointCard,
                isActive && styles.endpointCardActive,
              ]}
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
                        <Text style={styles.currentBadgeText}>
                          {t("common.current", "当前")}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.endpointProvider}>{ep.provider}</Text>
                </View>
                <Text style={styles.chevron}>{isExpanded ? "▲" : "▼"}</Text>
              </TouchableOpacity>

              {/* Expanded Content */}
              {isExpanded && (
                <View style={styles.expandedContent}>
                  {/* Set as active */}
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => setActiveEndpoint(ep.id)}
                  >
                    <Text style={styles.label}>
                      {t("settings.ai_setDefault", "设为默认")}
                    </Text>
                    <View
                      style={[
                        styles.toggle,
                        isActive && styles.toggleActive,
                      ]}
                    >
                      <View
                        style={[
                          styles.toggleThumb,
                          isActive && styles.toggleThumbActive,
                        ]}
                      />
                    </View>
                  </TouchableOpacity>

                  {/* Name */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>
                      {t("settings.ai_name", "名称")}
                    </Text>
                    <TextInput
                      style={styles.input}
                      value={ep.name}
                      onChangeText={(v) => updateEndpoint(ep.id, { name: v })}
                      placeholderTextColor={colors.mutedForeground}
                    />
                  </View>

                  {/* Provider grid */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>
                      {t("settings.ai_providerLabel", "提供商")}
                    </Text>
                    <View style={styles.providerGrid}>
                      {PROVIDERS.map((p) => (
                        <TouchableOpacity
                          key={p.id}
                          style={[
                            styles.providerBtn,
                            ep.provider === p.id && styles.providerBtnActive,
                          ]}
                          onPress={() =>
                            updateEndpoint(ep.id, { provider: p.id })
                          }
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.providerBtnText,
                              ep.provider === p.id &&
                                styles.providerBtnTextActive,
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
                    <Text style={styles.fieldLabel}>
                      {t("settings.ai_apiKey", "API Key")}
                    </Text>
                    <PasswordInput
                      style={styles.input}
                      value={ep.apiKey}
                      onChangeText={(v) =>
                        updateEndpoint(ep.id, { apiKey: v })
                      }
                      placeholder="sk-..."
                      placeholderTextColor={colors.mutedForeground}
                    />
                  </View>

                  {/* Base URL */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>
                      {t("settings.ai_baseUrl", "Base URL")}
                    </Text>
                    <TextInput
                      style={styles.input}
                      value={ep.baseUrl}
                      onChangeText={(v) =>
                        updateEndpoint(ep.id, { baseUrl: v })
                      }
                      placeholderTextColor={colors.mutedForeground}
                      autoCapitalize="none"
                    />
                  </View>

                  {/* Models */}
                  <View style={styles.fieldGroup}>
                    <View style={styles.modelsHeader}>
                      <Text style={styles.fieldLabel}>
                        {t("settings.ai_modelsList", "模型列表")}
                      </Text>
                      <TouchableOpacity
                        style={styles.fetchBtn}
                        onPress={() => handleFetchModels(ep)}
                        disabled={!!ep.modelsFetching}
                      >
                        {ep.modelsFetching ? (
                          <LoaderIcon size={12} color={colors.primary} />
                        ) : (
                          <Text style={styles.fetchBtnText}>
                            {t("settings.ai_fetchModels", "获取模型")}
                          </Text>
                        )}
                      </TouchableOpacity>
                    </View>

                    {/* Model tags */}
                    <View style={styles.modelTags}>
                      {ep.models.map((m) => {
                        const modelActive =
                          aiConfig.activeModel === m && isActive;
                        return (
                          <View
                            key={m}
                            style={[
                              styles.modelTag,
                              modelActive && styles.modelTagActive,
                            ]}
                          >
                            <TouchableOpacity
                              onPress={() => {
                                setActiveEndpoint(ep.id);
                                setActiveModel(m);
                              }}
                            >
                              <Text
                                style={[
                                  styles.modelTagText,
                                  modelActive && styles.modelTagTextActive,
                                ]}
                                numberOfLines={1}
                              >
                                {m}
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() =>
                                updateEndpoint(ep.id, {
                                  models: ep.models.filter((x) => x !== m),
                                })
                              }
                              hitSlop={{
                                top: 4,
                                bottom: 4,
                                left: 4,
                                right: 4,
                              }}
                            >
                              <XIcon
                                size={12}
                                color={colors.mutedForeground}
                              />
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </View>

                    {/* Add model input */}
                    <View style={styles.addModelRow}>
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        placeholder={t(
                          "settings.ai_addManualModelPlaceholder",
                          "手动添加模型名",
                        )}
                        placeholderTextColor={colors.mutedForeground}
                        value={newModelInput}
                        onChangeText={setNewModelInput}
                        onSubmitEditing={() =>
                          handleAddManualModel(ep.id, ep.models)
                        }
                        autoCapitalize="none"
                      />
                      <TouchableOpacity
                        style={styles.addModelBtn}
                        onPress={() =>
                          handleAddManualModel(ep.id, ep.models)
                        }
                      >
                        <Text style={styles.addModelBtnText}>
                          {t("common.add", "添加")}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Delete */}
                  {aiConfig.endpoints.length > 1 && (
                    <TouchableOpacity
                      style={styles.deleteBtn}
                      onPress={() => removeEndpoint(ep.id)}
                      activeOpacity={0.7}
                    >
                      <Trash2Icon size={16} color={colors.destructive} />
                      <Text style={styles.deleteBtnText}>
                        {t("settings.ai_deleteEndpoint", "删除端点")}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          );
        })}

        {/* Current Model Selection */}
        <View style={styles.globalCard}>
          <Text style={styles.globalTitle}>
            {t("settings.ai_activeModel", "模型")}
          </Text>

          {activeEndpoint && activeEndpoint.models.length > 0 ? (
            <View style={styles.modelTags}>
              {activeEndpoint.models.map((m) => {
                const isSelected = aiConfig.activeModel === m;
                return (
                  <TouchableOpacity
                    key={m}
                    style={[
                      styles.modelTag,
                      isSelected && styles.modelTagActive,
                    ]}
                    onPress={() => {
                      setActiveEndpoint(activeEndpoint.id);
                      setActiveModel(m);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.modelTagText,
                        isSelected && styles.modelTagTextActive,
                      ]}
                      numberOfLines={1}
                    >
                      {m}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <View style={styles.addModelRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={t("settings.ai_selectModel", "选择模型")}
                placeholderTextColor={colors.mutedForeground}
                value={manualModelInput || aiConfig.activeModel}
                onChangeText={(v) => {
                  setManualModelInput(v);
                  setActiveModel(v);
                }}
                autoCapitalize="none"
              />
            </View>
          )}

          {activeEndpoint && activeEndpoint.models.length === 0 && (
            <Text style={styles.noModelsHint}>
              {t("settings.ai_noModels", "暂无模型 — 可从 API 拉取或手动添加")}
            </Text>
          )}
        </View>

        {/* Global Params */}
        <View style={styles.globalCard}>
          <Text style={styles.globalTitle}>
            {t("settings.ai_globalParams", "全局参数")}
          </Text>

          {/* Temperature */}
          <View style={styles.sliderGroup}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>
                {t("settings.ai_temperature", "Temperature")}
              </Text>
              <Text style={styles.sliderValue}>
                {aiConfig.temperature.toFixed(1)}
              </Text>
            </View>
            <TextInput
              style={styles.sliderInput}
              keyboardType="decimal-pad"
              value={String(aiConfig.temperature)}
              onChangeText={(v) => {
                const n = Number.parseFloat(v);
                if (!Number.isNaN(n) && n >= 0 && n <= 1)
                  updateAIConfig({ temperature: n });
              }}
              placeholder="0.0 - 1.0"
              placeholderTextColor={colors.mutedForeground}
            />
          </View>

          {/* Max Tokens */}
          <View style={styles.sliderGroup}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>
                {t("settings.ai_maxTokens", "Max Tokens")}
              </Text>
              <Text style={styles.sliderValue}>{aiConfig.maxTokens}</Text>
            </View>
            <TextInput
              style={styles.sliderInput}
              keyboardType="number-pad"
              value={String(aiConfig.maxTokens)}
              onChangeText={(v) => {
                const n = Number.parseInt(v, 10);
                if (!Number.isNaN(n) && n >= 1024 && n <= 32768)
                  updateAIConfig({ maxTokens: n });
              }}
              placeholder="1024 - 32768"
              placeholderTextColor={colors.mutedForeground}
            />
          </View>

          {/* Context Window */}
          <View style={styles.sliderGroup}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>
                {t("settings.ai_contextWindow", "上下文窗口")}
              </Text>
              <Text style={styles.sliderValue}>
                {aiConfig.slidingWindowSize}{" "}
                {t("settings.ai_contextWindowUnit", "轮")}
              </Text>
            </View>
            <TextInput
              style={styles.sliderInput}
              keyboardType="number-pad"
              value={String(aiConfig.slidingWindowSize)}
              onChangeText={(v) => {
                const n = Number.parseInt(v, 10);
                if (!Number.isNaN(n) && n >= 2 && n <= 30)
                  updateAIConfig({ slidingWindowSize: n });
              }}
              placeholder="2 - 30"
              placeholderTextColor={colors.mutedForeground}
            />
          </View>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  keyboardView: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, gap: 16 },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  addBtnText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.primaryForeground,
  },
  endpointCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  endpointCardActive: {
    borderColor: withOpacity(colors.primary, 0.5),
    backgroundColor: withOpacity(colors.primary, 0.05),
  },
  endpointHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  endpointInfo: { flex: 1 },
  endpointNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  endpointName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.foreground,
  },
  currentBadge: {
    backgroundColor: withOpacity(colors.primary, 0.1),
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  currentBadgeText: {
    fontSize: 10,
    fontWeight: fontWeight.medium,
    color: colors.primary,
  },
  endpointProvider: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  chevron: {
    fontSize: 12,
    color: colors.mutedForeground,
  },
  expandedContent: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: { fontSize: fontSize.sm, color: colors.foreground },
  toggle: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.muted,
    justifyContent: "center",
    padding: 2,
  },
  toggleActive: { backgroundColor: colors.primary },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.card,
  },
  toggleThumbActive: { alignSelf: "flex-end" },
  fieldGroup: { gap: 6 },
  fieldLabel: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
  },
  input: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: fontSize.sm,
    color: colors.foreground,
  },
  providerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  providerBtn: {
    width: "47%",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center",
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
    fontWeight: fontWeight.medium,
    color: colors.primary,
  },
  modelsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fetchBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  fetchBtnText: {
    fontSize: fontSize.xs,
    color: colors.primary,
  },
  modelTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  modelTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  modelTagActive: {
    borderColor: colors.primary,
    backgroundColor: withOpacity(colors.primary, 0.1),
  },
  modelTagText: {
    fontSize: fontSize.xs,
    color: colors.foreground,
    maxWidth: 160,
  },
  modelTagTextActive: {
    color: colors.primary,
  },
  addModelRow: {
    flexDirection: "row",
    gap: 8,
  },
  addModelBtn: {
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  addModelBtnText: {
    fontSize: fontSize.sm,
    color: colors.primaryForeground,
  },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: withOpacity(colors.destructive, 0.3),
    paddingVertical: 10,
  },
  deleteBtnText: {
    fontSize: fontSize.sm,
    color: colors.destructive,
  },
  globalCard: {
    borderRadius: radius.xl,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: 16,
  },
  globalTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.foreground,
  },
  sliderGroup: { gap: 8 },
  sliderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sliderLabel: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
  },
  sliderValue: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  sliderInput: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: fontSize.sm,
    color: colors.foreground,
  },
  noModelsHint: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginTop: 4,
  },
});
