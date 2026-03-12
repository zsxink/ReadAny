import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { SettingsHeader } from "./SettingsHeader";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { type ThemeColors, fontSize, fontWeight, spacing, radius, useColors, withOpacity } from "../../styles/theme";

export default function SyncSettingsScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { t } = useTranslation();

  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(
    null,
  );
  const [testError, setTestError] = useState("");
  const [saving, setSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [autoSync, setAutoSync] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [deviceId, setDeviceId] = useState("");

  // Try to load sync store if available
  useEffect(() => {
    (async () => {
      try {
        const mod = await import("@readany/core/stores");
        const store = (mod as Record<string, unknown>)["useSyncStore"];
        if (typeof store === "function") {
          const state = (store as () => Record<string, unknown>)();
          if (state.config) {
            const cfg = state.config as Record<string, string>;
            setUrl(cfg.url || "");
            setUsername(cfg.username || "");
            setPassword(cfg.password || "");
            setIsConfigured(true);
          }
        }
      } catch {
        // sync store not available
      }
    })();
  }, []);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Placeholder: real implementation would call sync service
      await new Promise((r) => setTimeout(r, 1500));
      setTestResult("success");
    } catch (e) {
      setTestResult("error");
      setTestError(String(e));
    } finally {
      setTesting(false);
    }
  }, [url, username, password]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await new Promise((r) => setTimeout(r, 500));
      setIsConfigured(true);
    } finally {
      setSaving(false);
    }
  }, [url, username, password]);

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      await new Promise((r) => setTimeout(r, 2000));
      setLastSyncAt(Date.now());
    } finally {
      setIsSyncing(false);
    }
  }, []);

  const handleReset = useCallback(() => {
    Alert.alert(
      t("settings.syncReset", "重置同步"),
      t("settings.syncResetConfirm", "确定要重置同步数据吗？"),
      [
        { text: t("common.cancel", "取消"), style: "cancel" },
        {
          text: t("common.confirm", "确定"),
          style: "destructive",
          onPress: () => {
            setIsConfigured(false);
            setUrl("");
            setUsername("");
            setPassword("");
          },
        },
      ],
    );
  }, [t]);

  const formatLastSync = (ts: number | null) => {
    if (!ts) return t("settings.syncNever", "从未同步");
    return new Date(ts).toLocaleString();
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top"]}>
      <SettingsHeader title={t("settings.syncTitle", "同步设置")} />

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
        {/* Connection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t("settings.syncConnection", "连接配置")}
          </Text>
          <View style={styles.card}>
            {/* URL */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>
                {t("settings.syncUrl", "WebDAV URL")}
              </Text>
              <TextInput
                style={styles.input}
                value={url}
                onChangeText={setUrl}
                placeholder={t(
                  "settings.syncUrlPlaceholder",
                  "https://dav.example.com/readany",
                )}
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                keyboardType="url"
              />
            </View>

            {/* Username */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>
                {t("settings.syncUsername", "用户名")}
              </Text>
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                placeholder={t("settings.syncUsername", "用户名")}
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
              />
            </View>

            {/* Password */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>
                {t("settings.syncPassword", "密码")}
              </Text>
              <PasswordInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder={t("settings.syncPassword", "密码")}
                placeholderTextColor={colors.mutedForeground}
              />
            </View>

            {/* Buttons */}
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[styles.outlineBtn, (!url || testing) && styles.btnDisabled]}
                onPress={handleTest}
                disabled={testing || !url}
                activeOpacity={0.7}
              >
                <Text style={styles.outlineBtnText}>
                  {testing
                    ? t("settings.syncTesting", "测试中...")
                    : t("settings.syncTestConnection", "测试连接")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  (saving || !url || !username) && styles.btnDisabled,
                ]}
                onPress={handleSave}
                disabled={saving || !url || !username}
                activeOpacity={0.7}
              >
                <Text style={styles.primaryBtnText}>
                  {t("settings.syncSave", "保存")}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Test result */}
            {testResult === "success" && (
              <Text style={styles.successText}>
                {t("settings.syncTestSuccess", "连接成功")}
              </Text>
            )}
            {testResult === "error" && (
              <Text style={styles.errorText}>
                {t("settings.syncTestFailed", {
                  error: testError,
                  defaultValue: `连接失败: ${testError}`,
                })}
              </Text>
            )}
          </View>
        </View>

        {/* Sync Status */}
        {isConfigured && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {t("settings.syncStatus", "同步状态")}
            </Text>
            <View style={styles.card}>
              {/* Last sync + Sync Now */}
              <View style={styles.syncRow}>
                <View>
                  <Text style={styles.syncLabel}>
                    {t("settings.syncLastSync", "上次同步")}
                  </Text>
                  <Text style={styles.syncValue}>
                    {formatLastSync(lastSyncAt)}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.syncBtn,
                    isSyncing && styles.btnDisabled,
                  ]}
                  onPress={handleSync}
                  disabled={isSyncing}
                  activeOpacity={0.7}
                >
                  {isSyncing && (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  )}
                  <Text style={styles.syncBtnText}>
                    {isSyncing
                      ? t("settings.syncSyncing", "同步中...")
                      : t("settings.syncNow", "立即同步")}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Auto sync toggle */}
              <View style={styles.autoSyncRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.autoSyncLabel}>
                    {t("settings.syncAutoSync", "自动同步")}
                  </Text>
                  <Text style={styles.autoSyncDesc}>
                    {t(
                      "settings.syncAutoSyncDesc",
                      "应用启动时自动同步数据",
                    )}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.toggle,
                    autoSync && styles.toggleActive,
                  ]}
                  onPress={() => setAutoSync(!autoSync)}
                >
                  <View
                    style={[
                      styles.toggleThumb,
                      autoSync && styles.toggleThumbActive,
                    ]}
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Advanced */}
        {isConfigured && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.advancedHeader}
              onPress={() => setShowAdvanced(!showAdvanced)}
            >
              <Text style={styles.sectionTitle}>
                {t("settings.syncAdvanced", "高级选项")}
              </Text>
              <Text style={styles.chevron}>
                {showAdvanced ? "▲" : "▼"}
              </Text>
            </TouchableOpacity>
            {showAdvanced && (
              <View style={styles.card}>
                {deviceId ? (
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>
                      {t("settings.syncDeviceId", "设备 ID")}
                    </Text>
                    <Text style={styles.deviceIdText}>
                      {deviceId.slice(0, 8)}...
                    </Text>
                  </View>
                ) : null}
                <TouchableOpacity
                  style={styles.resetBtn}
                  onPress={handleReset}
                  activeOpacity={0.7}
                >
                  <Text style={styles.resetBtnText}>
                    {t("settings.syncReset", "重置同步")}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.resetDesc}>
                  {t(
                    "settings.syncResetDesc",
                    "重置后将清除本地同步记录，下次同步时将重新同步所有数据",
                  )}
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  keyboardView: { flex: 1 },
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
  card: {
    borderRadius: radius.xl,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: 12,
  },
  fieldGroup: { gap: 4 },
  fieldLabel: {
    fontSize: fontSize.sm,
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
  btnRow: {
    flexDirection: "row",
    gap: 12,
    paddingTop: 4,
  },
  outlineBtn: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    alignItems: "center",
  },
  outlineBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.foreground,
  },
  primaryBtn: {
    flex: 1,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    paddingVertical: 8,
    alignItems: "center",
  },
  primaryBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.primaryForeground,
  },
  btnDisabled: { opacity: 0.4 },
  successText: { fontSize: fontSize.sm, color: colors.emerald },
  errorText: { fontSize: fontSize.sm, color: colors.destructive },
  syncRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  syncLabel: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
  },
  syncValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.foreground,
    marginTop: 2,
  },
  syncBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  syncBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.primaryForeground,
  },
  autoSyncRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  autoSyncLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.foreground,
  },
  autoSyncDesc: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginTop: 2,
  },
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
  advancedHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  chevron: {
    fontSize: 12,
    color: colors.mutedForeground,
  },
  deviceIdText: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  resetBtn: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: withOpacity(colors.destructive, 0.3),
    paddingVertical: 8,
    alignItems: "center",
  },
  resetBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.destructive,
  },
  resetDesc: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
  },
});
