/**
 * SyncSettings — WebDAV sync configuration and status panel
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSyncStore } from "@/stores/sync-store";
import { Switch } from "@/components/ui/switch";

export function SyncSettings() {
  const { t } = useTranslation();
  const {
    config,
    status,
    isSyncing,
    loadConfig,
    loadStatus,
    testConnection,
    saveConfig,
    syncNow,
    setAutoSync,
    resetSync,
  } = useSyncStore();

  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
  const [testError, setTestError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    loadConfig();
    loadStatus();
  }, [loadConfig, loadStatus]);

  useEffect(() => {
    if (config) {
      setUrl(config.url);
      setUsername(config.username);
      setPassword(config.password);
    }
  }, [config]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await testConnection(url, username, password);
      setTestResult("success");
    } catch (e) {
      setTestResult("error");
      setTestError(String(e));
    } finally {
      setTesting(false);
    }
  }, [url, username, password, testConnection]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await saveConfig(url, username, password);
    } finally {
      setSaving(false);
    }
  }, [url, username, password, saveConfig]);

  const handleSync = useCallback(async () => {
    await syncNow();
  }, [syncNow]);

  const handleReset = useCallback(async () => {
    if (window.confirm(t("settings.syncResetConfirm"))) {
      await resetSync();
    }
  }, [resetSync, t]);

  const formatLastSync = (ts: number | null) => {
    if (!ts) return t("settings.syncNever");
    const date = new Date(ts);
    return date.toLocaleString();
  };

  return (
    <div className="space-y-6 p-4 pt-3">
      {/* Connection Section */}
      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-4 text-sm font-medium text-neutral-900">
          {t("settings.syncConnection")}
        </h2>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm text-neutral-800">
              {t("settings.syncUrl")}
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t("settings.syncUrlPlaceholder")}
              className="w-full rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-neutral-800">
                {t("settings.syncUsername")}
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-neutral-800">
                {t("settings.syncPassword")}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleTest}
              disabled={testing || !url}
              className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-50"
            >
              {testing ? t("settings.syncTesting") : t("settings.syncTestConnection")}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !url || !username}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white transition-colors hover:bg-neutral-800 disabled:opacity-50"
            >
              {t("settings.syncSave")}
            </button>
            {testResult === "success" && (
              <span className="text-xs text-green-600">{t("settings.syncTestSuccess")}</span>
            )}
            {testResult === "error" && (
              <span className="text-xs text-red-500">
                {t("settings.syncTestFailed", { error: testError })}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Sync Status Section */}
      {status.is_configured && (
        <section className="rounded-lg bg-muted/60 p-4">
          <h2 className="mb-4 text-sm font-medium text-neutral-900">
            {t("settings.syncStatus")}
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-neutral-800">{t("settings.syncLastSync")}</span>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {formatLastSync(status.last_sync_at)}
                </p>
              </div>
              <button
                onClick={handleSync}
                disabled={isSyncing}
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white transition-colors hover:bg-neutral-800 disabled:opacity-50"
              >
                {isSyncing ? t("settings.syncSyncing") : t("settings.syncNow")}
              </button>
            </div>

            {/* Last sync result */}
            {status.last_result && (
              <div className="rounded-md bg-white/60 p-3 text-xs text-neutral-600">
                {status.last_result.success ? (
                  <div className="space-y-0.5">
                    <p>{t("settings.syncRecordsUp", { count: status.last_result.records_uploaded })}</p>
                    <p>{t("settings.syncRecordsDown", { count: status.last_result.records_downloaded })}</p>
                    {status.last_result.files_uploaded > 0 && (
                      <p>{t("settings.syncFilesUp", { count: status.last_result.files_uploaded })}</p>
                    )}
                    {status.last_result.files_downloaded > 0 && (
                      <p>{t("settings.syncFilesDown", { count: status.last_result.files_downloaded })}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-red-500">
                    {t("settings.syncFailed", { error: status.last_result.error })}
                  </p>
                )}
              </div>
            )}

            {/* Auto sync toggle */}
            <div className="flex items-center justify-between pt-1">
              <div>
                <span className="text-sm text-neutral-800">{t("settings.syncAutoSync")}</span>
                <p className="mt-0.5 text-xs text-neutral-500">{t("settings.syncAutoSyncDesc")}</p>
              </div>
              <Switch
                checked={config?.auto_sync ?? false}
                onCheckedChange={(checked) => setAutoSync(checked)}
              />
            </div>
          </div>
        </section>
      )}

      {/* Advanced Section */}
      {status.is_configured && (
        <section className="rounded-lg bg-muted/60 p-4">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="mb-2 text-sm font-medium text-neutral-900"
          >
            {t("settings.syncAdvanced")} {showAdvanced ? "−" : "+"}
          </button>

          {showAdvanced && (
            <div className="space-y-3">
              {status.device_id && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-neutral-600">{t("settings.syncDeviceId")}</span>
                  <span className="font-mono text-xs text-neutral-400">
                    {status.device_id.slice(0, 8)}...
                  </span>
                </div>
              )}
              <div className="pt-2">
                <button
                  onClick={handleReset}
                  className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-50"
                >
                  {t("settings.syncReset")}
                </button>
                <p className="mt-1 text-xs text-neutral-500">
                  {t("settings.syncResetDesc")}
                </p>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
