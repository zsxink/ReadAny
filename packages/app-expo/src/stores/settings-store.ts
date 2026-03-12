/**
 * Settings store — global reading settings, AI config, translation config
 */
import type { AIConfig, AIEndpoint, ReadSettings } from "@readany/core/types";
import type { TranslationConfig, TranslationTargetLang } from "@readany/core/types/translation";
import { create } from "zustand";
import { withPersist } from "./persist";

export interface SettingsState {
  readSettings: ReadSettings;
  translationConfig: TranslationConfig;
  aiConfig: AIConfig;
  settingsUpdatedAt: number;

  updateReadSettings: (updates: Partial<ReadSettings>) => void;
  updateTranslationConfig: (updates: Partial<TranslationConfig>) => void;
  updateAIConfig: (
    updates: Partial<Pick<AIConfig, "temperature" | "maxTokens" | "slidingWindowSize">>,
  ) => void;
  addEndpoint: (endpoint: AIEndpoint) => void;
  updateEndpoint: (id: string, updates: Partial<AIEndpoint>) => void;
  removeEndpoint: (id: string) => void;
  setActiveEndpoint: (id: string) => void;
  setActiveModel: (model: string) => void;
  getActiveEndpoint: () => AIEndpoint | undefined;
  fetchModels: (endpointId: string) => Promise<string[]>;
  setTranslationLang: (lang: TranslationTargetLang) => void;
  resetToDefaults: () => void;
}

const defaultReadSettings: ReadSettings = {
  fontSize: 16,
  lineHeight: 1.6,
  fontTheme: "classic",
  viewMode: "paginated",
  pageMargin: 40,
  paragraphSpacing: 16,
};

const defaultTranslationConfig: TranslationConfig = {
  provider: { id: "ai", name: "AI 翻译" },
  targetLang: "zh-CN",
};

const defaultEndpoint: AIEndpoint = {
  id: "default",
  name: "OpenAI",
  provider: "openai",
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  models: [],
  modelsFetched: false,
};

const defaultAIConfig: AIConfig = {
  endpoints: [defaultEndpoint],
  activeEndpointId: "default",
  activeModel: "",
  temperature: 0.7,
  maxTokens: 4096,
  slidingWindowSize: 8,
};

async function fetchModelsFromEndpoint(endpoint: AIEndpoint): Promise<string[]> {
  if (!endpoint.apiKey) return [];

  try {
    switch (endpoint.provider) {
      case "anthropic":
        return [
          "claude-sonnet-4-20250514",
          "claude-opus-4-20250514",
          "claude-3-7-sonnet-20250219",
          "claude-3-5-sonnet-20241022",
          "claude-3-5-haiku-20241022",
        ];
      case "google":
        return [
          "gemini-2.5-pro",
          "gemini-2.5-flash",
          "gemini-2.0-flash",
          "gemini-1.5-pro",
          "gemini-1.5-flash",
        ];
      case "deepseek":
        return ["deepseek-chat", "deepseek-reasoner"];
      default: {
        const baseUrl = endpoint.baseUrl.replace(/\/+$/, "");
        const response = await fetch(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${endpoint.apiKey}` },
        });
        if (!response.ok) return [];
        const data = await response.json();
        return (data.data || []).map((m: { id: string }) => m.id).sort();
      }
    }
  } catch {
    return [];
  }
}

export const useSettingsStore = create<SettingsState>()(
  withPersist("settings", (set, get) => ({
    readSettings: defaultReadSettings,
    translationConfig: defaultTranslationConfig,
    aiConfig: defaultAIConfig,
    settingsUpdatedAt: 0,

    updateReadSettings: (updates) =>
      set((state) => ({
        readSettings: { ...state.readSettings, ...updates },
        settingsUpdatedAt: Date.now(),
      })),

    updateTranslationConfig: (updates) =>
      set((state) => ({
        translationConfig: { ...state.translationConfig, ...updates },
        settingsUpdatedAt: Date.now(),
      })),

    updateAIConfig: (updates) =>
      set((state) => ({
        aiConfig: { ...state.aiConfig, ...updates },
      })),

    addEndpoint: (endpoint) =>
      set((state) => ({
        aiConfig: {
          ...state.aiConfig,
          endpoints: [...state.aiConfig.endpoints, endpoint],
        },
      })),

    updateEndpoint: (id, updates) =>
      set((state) => ({
        aiConfig: {
          ...state.aiConfig,
          endpoints: state.aiConfig.endpoints.map((ep) =>
            ep.id === id ? { ...ep, ...updates } : ep,
          ),
        },
      })),

    removeEndpoint: (id) =>
      set((state) => {
        const newEndpoints = state.aiConfig.endpoints.filter((ep) => ep.id !== id);
        const newActiveId =
          state.aiConfig.activeEndpointId === id
            ? newEndpoints[0]?.id || ""
            : state.aiConfig.activeEndpointId;
        return {
          aiConfig: {
            ...state.aiConfig,
            endpoints: newEndpoints,
            activeEndpointId: newActiveId,
            activeModel: state.aiConfig.activeEndpointId === id ? "" : state.aiConfig.activeModel,
          },
        };
      }),

    setActiveEndpoint: (id) =>
      set((state) => ({
        aiConfig: {
          ...state.aiConfig,
          activeEndpointId: id,
          activeModel: "",
        },
      })),

    setActiveModel: (model) =>
      set((state) => ({
        aiConfig: { ...state.aiConfig, activeModel: model },
      })),

    getActiveEndpoint: () => {
      const state = get();
      return state.aiConfig.endpoints.find((ep) => ep.id === state.aiConfig.activeEndpointId);
    },

    fetchModels: async (endpointId) => {
      const state = get();
      const endpoint = state.aiConfig.endpoints.find((ep) => ep.id === endpointId);
      if (!endpoint) return [];

      set((s) => ({
        aiConfig: {
          ...s.aiConfig,
          endpoints: s.aiConfig.endpoints.map((ep) =>
            ep.id === endpointId ? { ...ep, modelsFetching: true } : ep,
          ),
        },
      }));

      try {
        const models = await fetchModelsFromEndpoint(endpoint);
        set((s) => ({
          aiConfig: {
            ...s.aiConfig,
            endpoints: s.aiConfig.endpoints.map((ep) =>
              ep.id === endpointId
                ? { ...ep, models, modelsFetched: true, modelsFetching: false }
                : ep,
            ),
          },
        }));
        return models;
      } catch (err) {
        console.error("Failed to fetch models:", err);
        set((s) => ({
          aiConfig: {
            ...s.aiConfig,
            endpoints: s.aiConfig.endpoints.map((ep) =>
              ep.id === endpointId ? { ...ep, modelsFetching: false } : ep,
            ),
          },
        }));
        return [];
      }
    },

    setTranslationLang: (lang) =>
      set((state) => ({
        translationConfig: { ...state.translationConfig, targetLang: lang },
      })),

    resetToDefaults: () =>
      set({
        readSettings: defaultReadSettings,
        translationConfig: defaultTranslationConfig,
        aiConfig: defaultAIConfig,
      }),
  })),
);
