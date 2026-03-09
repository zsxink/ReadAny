import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@readany/core/stores";
import {
  TRANSLATOR_PROVIDERS,
  TRANSLATOR_LANGS,
  type TranslationTargetLang,
} from "@readany/core/types/translation";
import { SettingsHeader } from "./SettingsHeader";
import { type ThemeColors, fontSize, fontWeight, spacing, radius, useColors } from "../../styles/theme";

export default function TranslationSettingsScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { t } = useTranslation();
  const { translationConfig, updateTranslationConfig, aiConfig } =
    useSettingsStore();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
      <SettingsHeader
        title={t("translation.settingsTitle", "翻译设置")}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Provider */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t("translation.engine", "翻译引擎")}
          </Text>
          <View style={styles.listCard}>
            {TRANSLATOR_PROVIDERS.map((p, idx) => (
              <TouchableOpacity
                key={p.id}
                style={[
                  styles.listItem,
                  idx < TRANSLATOR_PROVIDERS.length - 1 &&
                    styles.listItemBorder,
                ]}
                onPress={() =>
                  updateTranslationConfig({
                    provider: { id: p.id, name: p.name },
                  })
                }
                activeOpacity={0.7}
              >
                <View>
                  <Text style={styles.listItemText}>{p.name}</Text>
                  {p.id === "ai" && (
                    <Text style={styles.listItemSub}>
                      {t("translation.useAIModel", {
                        model: aiConfig.activeModel || "AI",
                      })}
                    </Text>
                  )}
                </View>
                {translationConfig.provider.id === p.id && (
                  <Text style={styles.check}>✓</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* DeepL API Key */}
        {translationConfig.provider.id === "deepl" && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {t("translation.deeplApiKey", "DeepL API Key")}
            </Text>
            <TextInput
              style={styles.apiKeyInput}
              value={translationConfig.provider.apiKey || ""}
              onChangeText={(v) =>
                updateTranslationConfig({
                  provider: {
                    ...translationConfig.provider,
                    apiKey: v,
                  },
                })
              }
              placeholder={t(
                "translation.deeplApiKeyPlaceholder",
                "输入 DeepL API Key",
              )}
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry
            />
          </View>
        )}

        {/* Target Language */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t("translation.targetLanguage", "目标语言")}
          </Text>
          <View style={[styles.listCard, { maxHeight: 320 }]}>
            <ScrollView nestedScrollEnabled>
              {Object.entries(TRANSLATOR_LANGS).map(([code, name]) => (
                <TouchableOpacity
                  key={code}
                  style={styles.langItem}
                  onPress={() =>
                    updateTranslationConfig({
                      targetLang: code as TranslationTargetLang,
                    })
                  }
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.langText,
                      translationConfig.targetLang === code &&
                        styles.langTextActive,
                    ]}
                  >
                    {name}
                  </Text>
                  {translationConfig.targetLang === code && (
                    <Text style={styles.check}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, gap: 24 },
  section: { gap: 12 },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  listCard: {
    borderRadius: radius.xl,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  listItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  listItemText: {
    fontSize: fontSize.md,
    color: colors.foreground,
  },
  listItemSub: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  check: {
    fontSize: 14,
    color: colors.primary,
  },
  apiKeyInput: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    fontSize: fontSize.sm,
    color: colors.foreground,
  },
  langItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
  },
  langText: {
    fontSize: fontSize.sm,
    color: colors.foreground,
  },
  langTextActive: {
    color: colors.primary,
    fontWeight: fontWeight.medium,
  },
});
