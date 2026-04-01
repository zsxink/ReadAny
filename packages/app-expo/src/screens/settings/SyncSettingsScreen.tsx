import { getPlatformService } from "@readany/core/services";
import QRCode from "react-native-qrcode-svg";
import { useSyncStore } from "@readany/core/stores";
import { type LANQRData, createLANBackend } from "@readany/core/sync/lan-backend";
import { createLANServer } from "@readany/core/sync/lan-server";
import type { S3Config, WebDavConfig } from "@readany/core/sync/sync-backend";
import { SYNC_SECRET_KEYS } from "@readany/core/sync/sync-backend";
/**
 * SyncSettingsScreen — Multi-backend sync configuration and status panel (mobile).
 * Supports WebDAV, S3, and LAN sync.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Constants from "expo-constants";
import { CameraView, useCameraPermissions } from "expo-camera";
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Scan } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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

type BackendType = "webdav" | "s3" | "lan";

function isWebDavConfig(config: unknown): config is WebDavConfig {
  return (
    typeof config === "object" && config !== null && (config as WebDavConfig).type === "webdav"
  );
}

function isS3Config(config: unknown): config is S3Config {
  return typeof config === "object" && config !== null && (config as S3Config).type === "s3";
}

function hasAutoSync(config: unknown): config is { autoSync: boolean } {
  return typeof config === "object" && config !== null && "autoSync" in config;
}

export default function SyncSettingsScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { t } = useTranslation();

  const {
    config,
    isConfigured,
    backendType,
    status,
    lastSyncAt,
    lastResult,
    error,
    progress,
    pendingDirection,
    loadConfig,
    testWebDavConnection,
    saveWebDavConfig,
    testS3Connection,
    saveS3Config,
    syncNow,
    syncWithBackend,
    setAutoSync,
    resetSync,
  } = useSyncStore();

  // Backend type selector
  const [selectedBackend, setSelectedBackend] = useState<BackendType>("webdav");

  // WebDAV state
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [allowInsecure, setAllowInsecure] = useState(false);

  // S3 state
  const [s3Endpoint, setS3Endpoint] = useState("");
  const [s3Region, setS3Region] = useState("auto");
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3AccessKeyId, setS3AccessKeyId] = useState("");
  const [s3SecretAccessKey, setS3SecretAccessKey] = useState("");

  // LAN state
  const [lanMode, setLanMode] = useState<"server" | "client">("server");
  const [lanServerStatus, setLanServerStatus] = useState<string>("idle");
  const [lanQrData, setLanQrData] = useState<LANQRData | null>(null);
  const [lanManualIP, setLanManualIP] = useState("");
  const [lanManualPort, setLanManualPort] = useState("");
  const [lanManualPairCode, setLanManualPairCode] = useState("");
  const [lanConnectionState, setLanConnectionState] = useState<string>("idle");
  const [lanServer, setLanServer] = useState<ReturnType<typeof createLANServer> | null>(null);
  const [lanError, setLanError] = useState("");
  const [showManualIPInput, setShowManualIPInput] = useState(false);
  const [lanManualServerIP, setLanManualServerIP] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
  const [testError, setTestError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isBusy = status !== "idle" && status !== "error";

  // Pulse animation for indeterminate progress (database phase)
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    if (isBusy && progress?.phase === "database") {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
        ]),
      );
      animation.start();
      return () => animation.stop();
    }
    pulseAnim.setValue(0.4);
  }, [isBusy, progress?.phase, pulseAnim]);

  // Load config on mount
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Load saved password from KV when config changes
  useEffect(() => {
    if (config) {
      setSelectedBackend(config.type);
      if (config.type === "webdav") {
        setUrl(config.url);
        setUsername(config.username);
        setAllowInsecure(config.allowInsecure ?? false);
        getPlatformService()
          .kvGetItem(SYNC_SECRET_KEYS.webdav)
          .then((pw) => {
            if (pw) setPassword(pw);
          });
      } else if (config.type === "s3") {
        setS3Endpoint(config.endpoint);
        setS3Region(config.region);
        setS3Bucket(config.bucket);
        setS3AccessKeyId(config.accessKeyId);
        getPlatformService()
          .kvGetItem("sync_s3_secret_key")
          .then((key) => {
            if (key) setS3SecretAccessKey(key);
          });
      }
    }
  }, [config]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    setTestError("");
    try {
      let success = false;
      if (selectedBackend === "webdav") {
        success = await testWebDavConnection(url, username, password, allowInsecure);
      } else if (selectedBackend === "s3") {
        success = await testS3Connection(
          { endpoint: s3Endpoint, region: s3Region, bucket: s3Bucket, accessKeyId: s3AccessKeyId },
          s3SecretAccessKey,
        );
      }
      setTestResult(success ? "success" : "error");
      if (!success) {
        setTestError(t("common.failed", "Failed"));
      }
    } catch (e) {
      setTestResult("error");
      setTestError(String(e));
    } finally {
      setTesting(false);
    }
  }, [
    selectedBackend,
    url,
    username,
    password,
    allowInsecure,
    s3Endpoint,
    s3Region,
    s3Bucket,
    s3AccessKeyId,
    s3SecretAccessKey,
    testWebDavConnection,
    testS3Connection,
    t,
  ]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      if (selectedBackend === "webdav") {
        await saveWebDavConfig(url, username, password, allowInsecure);
      } else if (selectedBackend === "s3") {
        await saveS3Config(
          { endpoint: s3Endpoint, region: s3Region, bucket: s3Bucket, accessKeyId: s3AccessKeyId },
          s3SecretAccessKey,
        );
      }
    } finally {
      setSaving(false);
    }
  }, [
    selectedBackend,
    url,
    username,
    password,
    allowInsecure,
    s3Endpoint,
    s3Region,
    s3Bucket,
    s3AccessKeyId,
    s3SecretAccessKey,
    saveWebDavConfig,
    saveS3Config,
  ]);

  // LAN Server handlers
  const handleStartLanServer = useCallback(async () => {
    setLanError("");
    setLanServerStatus("starting");
    setShowManualIPInput(false);
    try {
      const deviceName = "ReadAny Mobile";
      const server = createLANServer({
        deviceName,
        events: {
          onStatusChange: (status) => {
            setLanServerStatus(status);
            if (status === "error") {
              setShowManualIPInput(true);
            }
          },
          onError: (err) => {
            setLanError(err);
            setShowManualIPInput(true);
          },
        },
      });
      await server.start();
      const data = server.getQRData();
      if (data) {
        setLanQrData(data);
      }
      setLanServer(server);
    } catch (e) {
      setLanError(e instanceof Error ? e.message : String(e));
      setLanServerStatus("error");
      setShowManualIPInput(true);
    }
  }, []);

  const handleStartWithManualIP = useCallback(async () => {
    if (!lanManualServerIP) {
      setLanError(t("settings.syncLANFillAll"));
      return;
    }
    setLanError("");
    setLanServerStatus("starting");
    try {
      const deviceName = "ReadAny Mobile";
      const server = createLANServer({
        deviceName,
        events: {
          onStatusChange: setLanServerStatus,
          onError: setLanError,
        },
      });
      server.setManualIP(lanManualServerIP);
      await server.start();
      const data = server.getQRData();
      if (data) {
        setLanQrData(data);
      }
      setLanServer(server);
    } catch (e) {
      setLanError(e instanceof Error ? e.message : String(e));
      setLanServerStatus("error");
    }
  }, [lanManualServerIP, t]);

  const handleStopLanServer = useCallback(async () => {
    if (lanServer) {
      await lanServer.stop();
      setLanServer(null);
    }
    setLanServerStatus("idle");
    setLanQrData(null);
    setShowManualIPInput(false);
    setLanManualServerIP("");
  }, [lanServer]);

  // LAN Client handlers
  const handleLanClientConnect = useCallback(async () => {
    if (!lanManualIP || !lanManualPort || !lanManualPairCode) {
      setLanError(t("settings.syncLANFillAll"));
      return;
    }
    setLanError("");
    setLanConnectionState("connecting");
    try {
      const serverUrl = `http://${lanManualIP}:${lanManualPort}`;
      const deviceName = Constants.deviceName || "Mobile";
      const backend = createLANBackend(serverUrl, lanManualPairCode, deviceName);
      const connected = await backend.testConnection();
      if (!connected) {
        throw new Error(t("settings.syncLANConnectionFailed"));
      }
      setLanConnectionState("connected");
      // Use syncWithBackend to pass the LAN backend directly into the sync engine
      const result = await syncWithBackend(backend);
      if (result && !result.success) {
        setLanError(result.error || t("settings.syncLANConnectionFailed"));
      }
    } catch (e) {
      setLanError(e instanceof Error ? e.message : String(e));
      setLanConnectionState("error");
    }
  }, [lanManualIP, lanManualPort, lanManualPairCode, syncWithBackend, t]);

  const handleScanQRCode = useCallback(async () => {
    if (!permission) return;
    if (!permission.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        Alert.alert(t("settings.cameraPermission"), t("settings.cameraPermissionDesc"));
        return;
      }
    }
    setShowScanner(true);
  }, [permission, requestPermission, t]);

  const onBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      setShowScanner(false);
      const { parseLANQRData } = require("@readany/core/sync/lan-backend");
      const qrData = parseLANQRData(data);
      if (qrData) {
        setLanManualIP(qrData.ip);
        setLanManualPort(qrData.port.toString());
        setLanManualPairCode(qrData.pairCode);

        // Auto-connect after 500ms
        setTimeout(() => {
          const url = `http://${qrData.ip}:${qrData.port}`;
          const deviceName = Constants.deviceName || "Mobile";
          const backend = createLANBackend(url, qrData.pairCode, deviceName);
          setLanConnectionState("connecting");
          setLanError("");
          syncWithBackend(backend).catch((err) => {
            setLanConnectionState("error");
            setLanError(String(err));
          });
        }, 500);
      } else {
        setLanError(t("settings.syncLANInvalidQR"));
      }
    },
    [syncWithBackend, t],
  );

  const handleSync = useCallback(async () => {
    await syncNow();
  }, [syncNow]);

  const handleConflict = useCallback(
    (direction: "upload" | "download") => {
      syncNow(direction);
    },
    [syncNow],
  );

  const handleReset = useCallback(() => {
    Alert.alert(t("settings.syncReset"), t("settings.syncResetConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.confirm"),
        style: "destructive",
        onPress: () => resetSync(),
      },
    ]);
  }, [t, resetSync]);

  const formatLastSync = (ts: number | null) => {
    if (!ts) return t("settings.syncNever");
    return new Date(ts).toLocaleString();
  };

  const statusLabel = () => {
    switch (status) {
      case "checking":
        return t("settings.syncChecking");
      case "uploading":
        return t("settings.syncUploading");
      case "downloading":
        return t("settings.syncDownloading");
      case "syncing-files":
        return t("settings.syncSyncingFiles");
      case "error":
        return t("settings.syncError");
      default:
        return null;
    }
  };

  const autoSyncEnabled = hasAutoSync(config) ? config.autoSync : false;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top"]}
    >
      <SettingsHeader title={t("settings.syncTitle")} />

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {/* Backend Type Selector */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("settings.syncBackendType")}</Text>
            <View style={styles.backendSelector}>
              <TouchableOpacity
                style={[styles.backendBtn, selectedBackend === "webdav" && styles.backendBtnActive]}
                onPress={() => setSelectedBackend("webdav")}
              >
                <Text
                  style={[
                    styles.backendBtnText,
                    selectedBackend === "webdav" && styles.backendBtnTextActive,
                  ]}
                >
                  WebDAV
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.backendBtn, selectedBackend === "s3" && styles.backendBtnActive]}
                onPress={() => setSelectedBackend("s3")}
              >
                <Text
                  style={[
                    styles.backendBtnText,
                    selectedBackend === "s3" && styles.backendBtnTextActive,
                  ]}
                >
                  S3
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.backendBtn, selectedBackend === "lan" && styles.backendBtnActive]}
                onPress={() => setSelectedBackend("lan")}
              >
                <Text
                  style={[
                    styles.backendBtnText,
                    selectedBackend === "lan" && styles.backendBtnTextActive,
                  ]}
                >
                  LAN
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* WebDAV Connection */}
          {selectedBackend === "webdav" && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t("settings.syncConnection")}</Text>
              <View style={styles.card}>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t("settings.syncUrl")}</Text>
                  <TextInput
                    style={styles.input}
                    value={url}
                    onChangeText={setUrl}
                    placeholder={t("settings.syncUrlPlaceholder")}
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                    keyboardType="url"
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t("settings.syncUsername")}</Text>
                  <TextInput
                    style={styles.input}
                    value={username}
                    onChangeText={setUsername}
                    placeholder={t("settings.syncUsername")}
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t("settings.syncPassword")}</Text>
                  <PasswordInput
                    style={styles.input}
                    value={password}
                    onChangeText={setPassword}
                    placeholder={t("settings.syncPassword")}
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>

                <View style={styles.autoSyncRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.autoSyncLabel}>{t("settings.syncAllowInsecure")}</Text>
                    <Text style={styles.autoSyncDesc}>{t("settings.syncAllowInsecureDescMobile")}</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.toggle, allowInsecure && styles.toggleActive]}
                    onPress={() => setAllowInsecure(!allowInsecure)}
                  >
                    <View
                      style={[styles.toggleThumb, allowInsecure && styles.toggleThumbActive]}
                    />
                  </TouchableOpacity>
                </View>

                <View style={styles.btnRow}>
                  <TouchableOpacity
                    style={[styles.outlineBtn, (!url || testing) && styles.btnDisabled]}
                    onPress={handleTest}
                    disabled={testing || !url}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.outlineBtnText}>
                      {testing ? t("settings.syncTesting") : t("settings.syncTestConnection")}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryBtn, (saving || !url || !username) && styles.btnDisabled]}
                    onPress={handleSave}
                    disabled={saving || !url || !username}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.primaryBtnText}>{t("settings.syncSave")}</Text>
                  </TouchableOpacity>
                </View>

                {testResult === "success" && (
                  <Text style={styles.successText}>{t("settings.syncTestSuccess")}</Text>
                )}
                {testResult === "error" && (
                  <Text style={styles.errorText}>
                    {t("settings.syncTestFailed", { error: testError })}
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* S3 Connection */}
          {selectedBackend === "s3" && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t("settings.syncConnection")}</Text>
              <View style={styles.card}>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t("settings.syncS3Endpoint")}</Text>
                  <TextInput
                    style={styles.input}
                    value={s3Endpoint}
                    onChangeText={setS3Endpoint}
                    placeholder="https://s3.amazonaws.com"
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                    keyboardType="url"
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t("settings.syncS3Region")}</Text>
                  <TextInput
                    style={styles.input}
                    value={s3Region}
                    onChangeText={setS3Region}
                    placeholder="us-east-1"
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t("settings.syncS3Bucket")}</Text>
                  <TextInput
                    style={styles.input}
                    value={s3Bucket}
                    onChangeText={setS3Bucket}
                    placeholder="my-bucket"
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t("settings.syncS3AccessKeyId")}</Text>
                  <TextInput
                    style={styles.input}
                    value={s3AccessKeyId}
                    onChangeText={setS3AccessKeyId}
                    placeholder="AKIAIOSFODNN7EXAMPLE"
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t("settings.syncS3SecretAccessKey")}</Text>
                  <PasswordInput
                    style={styles.input}
                    value={s3SecretAccessKey}
                    onChangeText={setS3SecretAccessKey}
                    placeholder={t("settings.syncS3SecretAccessKey")}
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>

                <View style={styles.btnRow}>
                  <TouchableOpacity
                    style={[
                      styles.outlineBtn,
                      (!s3Endpoint || !s3Bucket || testing) && styles.btnDisabled,
                    ]}
                    onPress={handleTest}
                    disabled={testing || !s3Endpoint || !s3Bucket}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.outlineBtnText}>
                      {testing ? t("settings.syncTesting") : t("settings.syncTestConnection")}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.primaryBtn,
                      (saving || !s3Endpoint || !s3Bucket || !s3AccessKeyId) && styles.btnDisabled,
                    ]}
                    onPress={handleSave}
                    disabled={saving || !s3Endpoint || !s3Bucket || !s3AccessKeyId}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.primaryBtnText}>{t("settings.syncSave")}</Text>
                  </TouchableOpacity>
                </View>

                {testResult === "success" && (
                  <Text style={styles.successText}>{t("settings.syncTestSuccess")}</Text>
                )}
                {testResult === "error" && (
                  <Text style={styles.errorText}>
                    {t("settings.syncTestFailed", { error: testError })}
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* LAN Connection */}
          {selectedBackend === "lan" && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t("settings.syncConnection")}</Text>
              <View style={styles.card}>
                <Text style={styles.lanDesc}>{t("settings.syncLANDescFull")}</Text>

                {/* Mode selector */}
                <View style={styles.lanModeSelector}>
                  <TouchableOpacity
                    style={[styles.lanModeBtn, lanMode === "server" && styles.lanModeBtnActive]}
                    onPress={() => setLanMode("server")}
                  >
                    <Text
                      style={[
                        styles.lanModeBtnText,
                        lanMode === "server" && styles.lanModeBtnTextActive,
                      ]}
                    >
                      {t("settings.syncLANServer")}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.lanModeBtn, lanMode === "client" && styles.lanModeBtnActive]}
                    onPress={() => setLanMode("client")}
                  >
                    <Text
                      style={[
                        styles.lanModeBtnText,
                        lanMode === "client" && styles.lanModeBtnTextActive,
                      ]}
                    >
                      {t("settings.syncLANClient")}
                    </Text>
                  </TouchableOpacity>
                </View>

                {lanMode === "server" ? (
                  <View style={styles.lanServerSection}>
                    <View style={styles.lanStatusRow}>
                      <View
                        style={[
                          styles.lanStatusDot,
                          lanServerStatus === "running"
                            ? styles.lanStatusDotGreen
                            : lanServerStatus === "error"
                              ? styles.lanStatusDotRed
                              : undefined,
                        ]}
                      />
                      <Text style={styles.lanStatusText}>
                        {t(`settings.syncLANServerStatus.${lanServerStatus}`)}
                      </Text>
                    </View>

                    {/* Manual IP input (shown when auto-detection fails) */}
                    {showManualIPInput && lanServerStatus !== "running" && (
                      <View style={styles.manualIPCard}>
                        <Text style={styles.manualIPHint}>
                          {t("settings.syncLANManualIPHint")}
                        </Text>
                        <View style={styles.manualIPRow}>
                          <TextInput
                            style={[styles.input, { flex: 1 }]}
                            value={lanManualServerIP}
                            onChangeText={setLanManualServerIP}
                            placeholder="192.168.1.100"
                            placeholderTextColor={colors.mutedForeground}
                            keyboardType="numeric"
                          />
                          <TouchableOpacity
                            style={[styles.primaryBtn, !lanManualServerIP && styles.btnDisabled]}
                            onPress={handleStartWithManualIP}
                            disabled={!lanManualServerIP}
                          >
                            <Text style={styles.primaryBtnText}>
                              {t("settings.syncLANServerStart")}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}

                    {lanQrData && (
                      <View style={styles.lanQrSection}>
                        <View style={styles.lanQrPlaceholder}>
                          <QRCode value={JSON.stringify(lanQrData)} size={160} />
                        </View>
                        <Text style={styles.lanPairCodeLabel}>{t("settings.syncLANPairCode")}</Text>
                        <Text style={styles.lanPairCode}>{lanQrData.pairCode}</Text>
                        <View style={{ marginTop: 12, alignItems: "center", gap: 4 }}>
                          <Text style={styles.lanAddress}>
                            {t("settings.syncLANIP")}: <Text style={{ fontFamily: "SpaceMono_400Regular", color: colors.foreground }}>{lanQrData.ip}</Text>
                          </Text>
                          <Text style={styles.lanAddress}>
                            {t("settings.syncLANPort")}: <Text style={{ fontFamily: "SpaceMono_400Regular", color: colors.foreground }}>{lanQrData.port}</Text>
                          </Text>
                        </View>
                      </View>
                    )}

                    {lanError && !showManualIPInput && (
                      <Text style={styles.errorText}>{lanError}</Text>
                    )}

                    {!showManualIPInput && (
                      <View style={styles.btnRow}>
                        {lanServerStatus !== "running" ? (
                          <TouchableOpacity
                            style={[styles.primaryBtn, styles.lanBtn]}
                            onPress={handleStartLanServer}
                            disabled={lanServerStatus === "starting"}
                          >
                            <Text style={styles.primaryBtnText}>
                              {lanServerStatus === "starting"
                                ? t("settings.syncLANServerStarting")
                                : t("settings.syncLANServerStart")}
                            </Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            style={[styles.outlineBtn, styles.lanBtn]}
                            onPress={handleStopLanServer}
                          >
                            <Text style={styles.outlineBtnText}>
                              {t("settings.syncLANServerStop")}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={styles.lanClientSection}>
                    <TouchableOpacity
                      style={[styles.outlineBtn, { marginBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }]}
                      onPress={handleScanQRCode}
                    >
                      <Scan size={20} color={colors.primary} />
                      <Text style={styles.outlineBtnText}>{t("settings.syncLANScanQR")}</Text>
                    </TouchableOpacity>

                    <View style={styles.separator}>
                      <View style={styles.separatorLine} />
                      <Text style={styles.separatorText}>{t("settings.syncLANManual")}</Text>
                      <View style={styles.separatorLine} />
                    </View>

                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>{t("settings.syncLANIP")}</Text>
                      <TextInput
                        style={styles.input}
                        value={lanManualIP}
                        onChangeText={setLanManualIP}
                        placeholder="192.168.1.100"
                        placeholderTextColor={colors.mutedForeground}
                      />
                    </View>
                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>{t("settings.syncLANPort")}</Text>
                      <TextInput
                        style={styles.input}
                        value={lanManualPort}
                        onChangeText={setLanManualPort}
                        placeholder="8080"
                        placeholderTextColor={colors.mutedForeground}
                        keyboardType="number-pad"
                      />
                    </View>
                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>{t("settings.syncLANPairCodeLabel")}</Text>
                      <TextInput
                        style={styles.input}
                        value={lanManualPairCode}
                        onChangeText={setLanManualPairCode}
                        placeholder="123456"
                        placeholderTextColor={colors.mutedForeground}
                        maxLength={6}
                        keyboardType="number-pad"
                      />
                    </View>

                    {lanError && <Text style={styles.errorText}>{lanError}</Text>}

                    <TouchableOpacity
                      style={[
                        styles.primaryBtn,
                        (lanConnectionState === "connecting" ||
                          isBusy ||
                          !lanManualIP ||
                          !lanManualPort ||
                          !lanManualPairCode) &&
                          styles.btnDisabled,
                      ]}
                      onPress={handleLanClientConnect}
                      disabled={
                        lanConnectionState === "connecting" ||
                        isBusy ||
                        !lanManualIP ||
                        !lanManualPort ||
                        !lanManualPairCode
                      }
                    >
                      <Text style={styles.primaryBtnText}>
                        {isBusy
                          ? t("settings.syncSyncing")
                          : lanConnectionState === "connecting"
                            ? t("settings.syncLANConnecting")
                            : t("settings.syncLANConnect")}
                      </Text>
                    </TouchableOpacity>

                    {isBusy && progress && (
                      <View style={[styles.progressContainer, { marginTop: 12 }]}>
                        <View style={styles.progressTrack}>
                          {progress.phase === "database" ? (
                            <Animated.View
                              style={[styles.progressFill, { width: "100%", opacity: pulseAnim }]}
                            />
                          ) : (
                            <View
                              style={[
                                styles.progressFill,
                                {
                                  width: `${progress.totalFiles > 0 ? Math.round((progress.completedFiles / progress.totalFiles) * 100) : 0}%`,
                                },
                              ]}
                            />
                          )}
                        </View>
                        <Text style={styles.progressText}>
                          {progress.message || (progress.phase === "database"
                            ? t("settings.syncProgressDatabase", {
                                operation:
                                  progress.operation === "upload"
                                    ? t("settings.syncUploading")
                                    : t("settings.syncDownloading"),
                              })
                            : t("settings.syncProgressFiles", {
                                operation:
                                  progress.operation === "upload"
                                    ? t("settings.syncUploading")
                                    : t("settings.syncDownloading"),
                                completed: progress.completedFiles,
                                total: progress.totalFiles,
                              }))}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Conflict Resolution */}
          {pendingDirection === "conflict" && (
            <View style={styles.section}>
              <View style={styles.conflictCard}>
                <Text style={styles.conflictTitle}>{t("settings.syncConflictTitle")}</Text>
                <Text style={styles.conflictDesc}>{t("settings.syncConflictDesc")}</Text>
                <View style={styles.btnRow}>
                  <TouchableOpacity
                    style={styles.uploadBtn}
                    onPress={() => handleConflict("upload")}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.uploadBtnText}>{t("settings.syncConflictUpload")}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.downloadBtn}
                    onPress={() => handleConflict("download")}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.downloadBtnText}>{t("settings.syncConflictDownload")}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}

          {/* Sync Status */}
          {(isConfigured || isBusy || lastSyncAt) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t("settings.syncStatus")}</Text>
              <View style={styles.card}>
                <View style={styles.syncRow}>
                  <View>
                    <Text style={styles.syncLabel}>{t("settings.syncLastSync")}</Text>
                    <Text style={styles.syncValue}>{formatLastSync(lastSyncAt)}</Text>
                    {statusLabel() && <Text style={styles.statusText}>{statusLabel()}</Text>}
                    {/* Sync progress bar */}
                    {isBusy && progress && (
                      <View style={styles.progressContainer}>
                        <View style={styles.progressTrack}>
                          {progress.phase === "database" ? (
                            <Animated.View
                              style={[styles.progressFill, { width: "100%", opacity: pulseAnim }]}
                            />
                          ) : (
                            <View
                              style={[
                                styles.progressFill,
                                {
                                  width: `${progress.totalFiles > 0 ? Math.round((progress.completedFiles / progress.totalFiles) * 100) : 0}%`,
                                },
                              ]}
                            />
                          )}
                        </View>
                        <Text style={styles.progressText}>
                          {progress.phase === "database"
                            ? t("settings.syncProgressDatabase", {
                                operation:
                                  progress.operation === "upload"
                                    ? t("settings.syncUploading")
                                    : t("settings.syncDownloading"),
                              })
                            : t("settings.syncProgressFiles", {
                                operation:
                                  progress.operation === "upload"
                                    ? t("settings.syncUploading")
                                    : t("settings.syncDownloading"),
                                completed: progress.completedFiles,
                                total: progress.totalFiles,
                              })}
                        </Text>
                      </View>
                    )}
                  </View>
                  <TouchableOpacity
                    style={[styles.syncBtn, isBusy && styles.btnDisabled]}
                    onPress={handleSync}
                    disabled={isBusy}
                    activeOpacity={0.7}
                  >
                    {isBusy && <ActivityIndicator size="small" color={colors.primaryForeground} />}
                    <Text style={styles.syncBtnText}>
                      {isBusy ? t("settings.syncSyncing") : t("settings.syncNow")}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Last result */}
                {lastResult && (
                  <View style={styles.resultCard}>
                    {lastResult.success ? (
                      <>
                        <Text style={styles.resultText}>
                          {t("settings.syncDirection", { direction: lastResult.direction })}
                        </Text>
                        {lastResult.filesUploaded > 0 && (
                          <Text style={styles.resultText}>
                            {t("settings.syncFilesUp", { count: lastResult.filesUploaded })}
                          </Text>
                        )}
                        {lastResult.filesDownloaded > 0 && (
                          <Text style={styles.resultText}>
                            {t("settings.syncFilesDown", { count: lastResult.filesDownloaded })}
                          </Text>
                        )}
                      </>
                    ) : (
                      <Text style={styles.errorText}>
                        {t("settings.syncFailed", { error: lastResult.error })}
                      </Text>
                    )}
                  </View>
                )}

                {/* Error */}
                {error && !lastResult && <Text style={styles.errorText}>{error}</Text>}

                {/* Auto sync toggle */}
                <View style={styles.autoSyncRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.autoSyncLabel}>{t("settings.syncAutoSync")}</Text>
                    <Text style={styles.autoSyncDesc}>{t("settings.syncAutoSyncDesc")}</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.toggle, autoSyncEnabled && styles.toggleActive]}
                    onPress={() => setAutoSync(!autoSyncEnabled)}
                  >
                    <View
                      style={[styles.toggleThumb, autoSyncEnabled && styles.toggleThumbActive]}
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
                <Text style={styles.sectionTitle}>{t("settings.syncAdvanced")}</Text>
                <Text style={styles.chevron}>{showAdvanced ? "▲" : "▼"}</Text>
              </TouchableOpacity>
              {showAdvanced && (
                <View style={styles.card}>
                  <TouchableOpacity
                    style={styles.resetBtn}
                    onPress={handleReset}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.resetBtnText}>{t("settings.syncReset")}</Text>
                  </TouchableOpacity>
                  <Text style={styles.resetDesc}>{t("settings.syncResetDesc")}</Text>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* QR Scanner Modal */}
      <Modal visible={showScanner} animationType="slide" transparent={false}>
        <View style={styles.scannerContainer}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            onBarcodeScanned={onBarcodeScanned}
            barcodeScannerSettings={{
              barcodeTypes: ["qr"],
            }}
          />
          <View style={styles.scannerOverlay}>
            <View style={styles.scannerTarget} />
            <Text style={styles.scannerText}>{t("settings.syncLANScanHint") || "Scan the center QR code."}</Text>
            <TouchableOpacity
              style={styles.scannerCloseBtn}
              onPress={() => setShowScanner(false)}
            >
              <Text style={styles.scannerCloseText}>{t("settings.syncClose") || "Close"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
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
    conflictCard: {
      borderRadius: radius.xl,
      backgroundColor: colors.card,
      borderWidth: 2,
      borderColor: withOpacity("#f59e0b", 0.5),
      padding: spacing.lg,
      gap: 12,
    },
    conflictTitle: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    conflictDesc: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
    },
    uploadBtn: {
      flex: 1,
      borderRadius: radius.lg,
      backgroundColor: colors.primary,
      paddingVertical: 8,
      alignItems: "center",
    },
    uploadBtnText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primaryForeground,
    },
    downloadBtn: {
      flex: 1,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      paddingVertical: 8,
      alignItems: "center",
    },
    downloadBtnText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    fieldGroup: { gap: 6, marginBottom: 12 },
    fieldLabel: { fontSize: fontSize.sm, color: colors.mutedForeground },
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
    btnRow: { flexDirection: "row", gap: 12, paddingTop: 4 },
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
    syncLabel: { fontSize: fontSize.sm, color: colors.mutedForeground },
    syncValue: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
      marginTop: 2,
    },
    statusText: {
      fontSize: fontSize.xs,
      color: colors.primary,
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
    resultCard: {
      borderRadius: radius.lg,
      backgroundColor: colors.background,
      padding: 12,
      gap: 2,
    },
    resultText: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
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
    chevron: { fontSize: 12, color: colors.mutedForeground },
    resetBtn: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: withOpacity(colors.destructive, 0.3),
      paddingVertical: 8,
      alignItems: "center",
    },
    resetBtnText: {
      fontSize: fontSize.sm,
      color: colors.destructive,
    },
    resetDesc: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      marginTop: 8,
      textAlign: "center",
    },
    progressContainer: {
      marginTop: 8,
    },
    progressTrack: {
      height: 4,
      backgroundColor: colors.muted,
      borderRadius: 2,
      overflow: "hidden",
    },
    progressFill: {
      height: "100%",
      backgroundColor: colors.primary,
      borderRadius: 2,
    },
    progressText: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      marginTop: 4,
    },
    backendSelector: {
      flexDirection: "row",
      gap: 8,
    },
    backendBtn: {
      flex: 1,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: radius.lg,
      backgroundColor: colors.muted,
      alignItems: "center",
    },
    backendBtnActive: {
      backgroundColor: colors.primary,
    },
    backendBtnText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
    },
    backendBtnTextActive: {
      color: colors.primaryForeground,
    },
    lanDesc: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      marginBottom: 12,
    },
    lanModeSelector: {
      flexDirection: "row",
      gap: 8,
      marginBottom: 12,
    },
    lanModeBtn: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: radius.md,
      backgroundColor: colors.muted,
      alignItems: "center",
    },
    lanModeBtnActive: {
      backgroundColor: colors.primary,
    },
    lanModeBtnText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
    },
    lanModeBtnTextActive: {
      color: colors.primaryForeground,
    },
    lanStatusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 12,
    },
    lanStatusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.muted,
    },
    lanStatusDotGreen: {
      backgroundColor: colors.emerald,
    },
    lanStatusText: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
    },
    lanQrSection: {
      alignItems: "center",
      marginBottom: 12,
    },
    lanQrPlaceholder: {
      width: 160,
      height: 160,
      backgroundColor: colors.muted,
      borderRadius: radius.lg,
      justifyContent: "center",
      alignItems: "center",
      marginBottom: 12,
    },
    lanQrText: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
    },
    lanPairCodeLabel: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    lanPairCode: {
      fontSize: 24,
      fontWeight: fontWeight.bold,
      letterSpacing: 4,
      color: colors.foreground,
      marginVertical: 8,
    },
    lanAddress: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
    },
    lanBtn: {
      flex: 1,
    },
    lanServerSection: {},
    lanClientSection: {},
    lanStatusDotRed: {
      backgroundColor: colors.destructive,
    },
    manualIPCard: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: withOpacity(colors.destructive, 0.3),
      backgroundColor: withOpacity(colors.destructive, 0.05),
      padding: 12,
      marginBottom: 12,
    },
    manualIPHint: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      marginBottom: 8,
    },
    manualIPRow: {
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
    },
    separator: {
      flexDirection: "row",
      alignItems: "center",
      marginVertical: 16,
      gap: 8,
    },
    separatorLine: {
      flex: 1,
      height: 1,
      backgroundColor: colors.border,
    },
    separatorText: {
      fontSize: 12,
      color: colors.mutedForeground,
      fontWeight: "500",
    },
    scannerContainer: {
      flex: 1,
      backgroundColor: "#000",
    },
    scannerOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "center",
      alignItems: "center",
    },
    scannerTarget: {
      width: 250,
      height: 250,
      borderWidth: 2,
      borderColor: colors.primary,
      backgroundColor: "transparent",
      borderRadius: 12,
    },
    scannerText: {
      color: "#fff",
      fontSize: 16,
      marginTop: 24,
      textAlign: "center",
      paddingHorizontal: 32,
    },
    scannerCloseBtn: {
      position: "absolute",
      bottom: 64,
      paddingVertical: 12,
      paddingHorizontal: 32,
      backgroundColor: "rgba(255,255,255,0.2)",
      borderRadius: 24,
    },
    scannerCloseText: {
      color: "#fff",
      fontSize: 16,
      fontWeight: "600",
    },
  });
