import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useSettingsStore } from "@/stores/settings-store";
import type { AIEndpoint, AIProviderType } from "@readany/core/types";
import { Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

function createEndpointId(): string {
  return `ep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Default base URLs per provider */
const PROVIDER_DEFAULTS: Record<
  AIProviderType,
  { baseUrl: string; placeholder: string; keyPlaceholder: string }
> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    placeholder: "https://api.openai.com/v1",
    keyPlaceholder: "sk-...",
  },
  anthropic: {
    baseUrl: "",
    placeholder: "https://api.anthropic.com",
    keyPlaceholder: "sk-ant-...",
  },
  google: {
    baseUrl: "",
    placeholder: "https://generativelanguage.googleapis.com",
    keyPlaceholder: "AIza...",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    placeholder: "https://api.deepseek.com",
    keyPlaceholder: "sk-...",
  },
};

function EndpointCard({
  endpoint,
  isActive,
  isExpanded,
  onUpdate,
  onRemove,
  onFetchModels,
  onSetActive,
  onToggleExpand,
}: {
  endpoint: AIEndpoint;
  isActive: boolean;
  isExpanded: boolean;
  onUpdate: (id: string, updates: Partial<AIEndpoint>) => void;
  onRemove: (id: string) => void;
  onFetchModels: (id: string) => void;
  onSetActive: (id: string) => void;
  onToggleExpand: () => void;
}) {
  const { t } = useTranslation();
  const [newModelName, setNewModelName] = useState("");

  const handleAddModel = useCallback(() => {
    const name = newModelName.trim();
    if (!name || endpoint.models.includes(name)) return;
    onUpdate(endpoint.id, { models: [...endpoint.models, name] });
    setNewModelName("");
  }, [newModelName, endpoint.id, endpoint.models, onUpdate]);

  const handleRemoveModel = useCallback(
    (model: string) => {
      onUpdate(endpoint.id, {
        models: endpoint.models.filter((m) => m !== model),
      });
    },
    [endpoint.id, endpoint.models, onUpdate],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddModel();
      }
    },
    [handleAddModel],
  );

  return (
    <div
      className={`rounded-lg border transition-colors ${
        isActive ? "border-primary/50 bg-primary/5" : "border-border bg-muted/30"
      }`}
    >
      {/* Clickable Header */}
      <div
        className="flex items-center gap-2 p-3 cursor-pointer hover:bg-muted/50"
        onClick={onToggleExpand}
        onKeyUp={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleExpand();
          }
        }}
        tabIndex={0}
        role="button"
        aria-expanded={isExpanded}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {endpoint.name || t("common.unnamed", "未命名")}
            </span>
            {isActive && (
              <span className="text-xs text-primary font-medium shrink-0">✓ Active</span>
            )}
          </div>
          <span className="text-xs text-muted-foreground truncate block">
            {endpoint.provider} • {endpoint.models.length} {t("settings.ai_models", "模型")}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isActive && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onSetActive(endpoint.id);
              }}
            >
              {t("settings.ai_activeEndpoint")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(endpoint.id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <span className="text-muted-foreground text-sm">{isExpanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* Collapsible Content */}
      {isExpanded && (
        <div className="p-3 pt-0 space-y-3 border-t border-border/50">
          {/* Provider selector */}
          <div>
            <label
              htmlFor={`provider-${endpoint.id}`}
              className="mb-1 block text-xs text-muted-foreground"
            >
              {t("settings.ai_provider")}
            </label>
            <Select
              value={endpoint.provider || "openai"}
              onValueChange={(v) => {
                const provider = v as AIProviderType;
                const defaults = PROVIDER_DEFAULTS[provider];
                onUpdate(endpoint.id, {
                  provider,
                  baseUrl: defaults.baseUrl,
                  models: [],
                  modelsFetched: false,
                });
              }}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">{t("settings.ai_provider_openai")}</SelectItem>
                <SelectItem value="anthropic">{t("settings.ai_provider_anthropic")}</SelectItem>
                <SelectItem value="google">{t("settings.ai_provider_google")}</SelectItem>
                <SelectItem value="deepseek">{t("settings.ai_provider_deepseek")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* API Key */}
          <div>
            <label
              htmlFor={`apiKey-${endpoint.id}`}
              className="mb-1 block text-xs text-muted-foreground"
            >
              {t("settings.ai_apiKey")}
            </label>
            <PasswordInput
              id={`apiKey-${endpoint.id}`}
              value={endpoint.apiKey}
              onChange={(e) => onUpdate(endpoint.id, { apiKey: e.target.value })}
              placeholder={PROVIDER_DEFAULTS[endpoint.provider || "openai"].keyPlaceholder}
              className="h-8 text-sm"
            />
          </div>

          {/* Base URL */}
          <div>
            <label
              htmlFor={`baseUrl-${endpoint.id}`}
              className="mb-1 block text-xs text-muted-foreground"
            >
              {endpoint.provider === "openai"
                ? t("settings.ai_baseUrl")
                : t("settings.ai_baseUrlOptional")}
            </label>
            <Input
              id={`baseUrl-${endpoint.id}`}
              value={endpoint.baseUrl}
              onChange={(e) => onUpdate(endpoint.id, { baseUrl: e.target.value })}
              placeholder={PROVIDER_DEFAULTS[endpoint.provider || "openai"].placeholder}
              className="h-8 text-sm"
            />
          </div>

          {/* Fetch models */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={!endpoint.apiKey || endpoint.modelsFetching}
              onClick={() => onFetchModels(endpoint.id)}
            >
              {endpoint.modelsFetching ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {endpoint.modelsFetching
                ? t("settings.ai_fetchingModels")
                : t("settings.ai_fetchModels")}
            </Button>
            <span className="text-xs text-muted-foreground">
              {endpoint.models.length > 0
                ? t("settings.ai_modelsLoaded", { count: endpoint.models.length })
                : ""}
            </span>
          </div>

          {/* Models list + manual add */}
          <div>
            <label
              htmlFor={`newModel-${endpoint.id}`}
              className="mb-1.5 block text-xs text-muted-foreground"
            >
              {t("settings.ai_modelsList")}
            </label>

            {/* Manual add input */}
            <div className="flex items-center gap-1.5 mb-2">
              <Input
                id={`newModel-${endpoint.id}`}
                value={newModelName}
                onChange={(e) => setNewModelName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("settings.ai_addModelPlaceholder")}
                className="h-7 text-xs flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1 shrink-0"
                disabled={!newModelName.trim()}
                onClick={handleAddModel}
              >
                <Plus className="h-3 w-3" />
                {t("settings.ai_addModel")}
              </Button>
            </div>

            {/* Model tags */}
            {endpoint.models.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {endpoint.models.map((model) => (
                  <span
                    key={model}
                    className="inline-flex items-center gap-1 rounded-md bg-background border px-2 py-0.5 text-xs text-foreground"
                  >
                    {model}
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      onClick={() => handleRemoveModel(model)}
                      title={t("settings.ai_removeModel")}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t("settings.ai_noModels")}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AISettings() {
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

  const [fetchError, setFetchError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const activeEndpoint = aiConfig.endpoints.find((ep) => ep.id === aiConfig.activeEndpointId);

  const handleAddEndpoint = useCallback(() => {
    const ep: AIEndpoint = {
      id: createEndpointId(),
      name: "",
      provider: "openai",
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      models: [],
      modelsFetched: false,
    };
    addEndpoint(ep);
  }, [addEndpoint]);

  const handleFetchModels = useCallback(
    async (endpointId: string) => {
      setFetchError(null);
      try {
        const models = await fetchModels(endpointId);
        if (models.length === 0) {
          setFetchError("No models returned. Check your API key and URL.");
        } else if (!aiConfig.activeModel) {
          // 自动选中第一个模型（如果当前没有选中任何模型）
          setActiveEndpoint(endpointId);
          setActiveModel(models[0]);
        }
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : "Failed to fetch models");
      }
    },
    [fetchModels, aiConfig.activeModel, setActiveEndpoint, setActiveModel],
  );

  return (
    <div className="space-y-6 p-4 pt-3">
      {/* Endpoint Management */}
      <section className="rounded-lg bg-muted/60 p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-medium text-foreground">{t("settings.ai_endpoints")}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{t("settings.ai_desc")}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={handleAddEndpoint}
          >
            <Plus className="h-3 w-3" />
            {t("settings.ai_addEndpoint")}
          </Button>
        </div>

        <div className="space-y-3">
          {aiConfig.endpoints.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              {t("settings.ai_noEndpoints")}
            </p>
          )}
          {aiConfig.endpoints.map((ep) => (
            <EndpointCard
              key={ep.id}
              endpoint={ep}
              isActive={ep.id === aiConfig.activeEndpointId}
              isExpanded={expandedId === ep.id}
              onUpdate={updateEndpoint}
              onRemove={removeEndpoint}
              onFetchModels={handleFetchModels}
              onSetActive={setActiveEndpoint}
              onToggleExpand={() => setExpandedId(expandedId === ep.id ? null : ep.id)}
            />
          ))}
        </div>

        {fetchError && <p className="mt-2 text-xs text-destructive">{fetchError}</p>}
      </section>

      {/* Active Model Selection */}
      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-3 text-sm font-medium text-foreground">{t("settings.ai_activeModel")}</h2>

        {/* Endpoint selector */}
        {aiConfig.endpoints.length > 1 && (
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-muted-foreground">{t("settings.ai_activeEndpoint")}</span>
            <Select value={aiConfig.activeEndpointId} onValueChange={setActiveEndpoint}>
              <SelectTrigger className="w-[200px] h-8 text-sm">
                <SelectValue placeholder={t("settings.ai_selectEndpoint")} />
              </SelectTrigger>
              <SelectContent>
                {aiConfig.endpoints.map((ep) => (
                  <SelectItem key={ep.id} value={ep.id}>
                    {ep.name || ep.baseUrl}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Model selector */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{t("settings.model")}</span>
          {activeEndpoint && activeEndpoint.models.length > 0 ? (
            <Select value={aiConfig.activeModel} onValueChange={setActiveModel}>
              <SelectTrigger className="w-[260px] h-8 text-sm">
                <SelectValue placeholder={t("settings.ai_selectModel")} />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {activeEndpoint.models.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                value={aiConfig.activeModel}
                onChange={(e) => setActiveModel(e.target.value)}
                placeholder={t("settings.ai_selectModel")}
                className="w-[260px] h-8 text-sm"
              />
            </div>
          )}
        </div>
        {activeEndpoint && activeEndpoint.models.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">{t("settings.ai_noModels")}</p>
        )}
      </section>

      {/* Parameters */}
      <section className="rounded-lg bg-muted/60 p-4 space-y-5">
        <h2 className="text-sm font-medium text-foreground">{t("settings.parameters")}</h2>

        {/* Temperature */}
        <div>
          <h3 className="mb-2 text-xs text-muted-foreground">
            {t("settings.temperature", { value: aiConfig.temperature })}
          </h3>
          <Slider
            min={0}
            max={1}
            step={0.1}
            value={[aiConfig.temperature]}
            onValueChange={([v]) => updateAIConfig({ temperature: v })}
          />
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>0</span>
            <span>0.5</span>
            <span>1</span>
          </div>
        </div>

        {/* Max Tokens */}
        <div>
          <h3 className="mb-2 text-xs text-muted-foreground">
            {t("settings.maxTokens", { value: aiConfig.maxTokens ?? 4096 })}
          </h3>
          <Slider
            min={1024}
            max={32768}
            step={1024}
            value={[aiConfig.maxTokens ?? 4096]}
            onValueChange={([v]) => updateAIConfig({ maxTokens: v })}
          />
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>1024</span>
            <span>16384</span>
            <span>32768</span>
          </div>
        </div>

        {/* Sliding Window Size */}
        <div>
          <h3 className="mb-2 text-xs text-muted-foreground">
            {t("settings.slidingWindowSize", { value: aiConfig.slidingWindowSize ?? 8 })}
          </h3>
          <Slider
            min={2}
            max={30}
            step={1}
            value={[aiConfig.slidingWindowSize ?? 8]}
            onValueChange={([v]) => updateAIConfig({ slidingWindowSize: v })}
          />
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>2</span>
            <span>16</span>
            <span>30</span>
          </div>
        </div>
      </section>
    </div>
  );
}
