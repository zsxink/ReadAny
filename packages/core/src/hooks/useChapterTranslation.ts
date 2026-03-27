/**
 * useChapterTranslation Hook
 *
 * State-machine hook that orchestrates whole-chapter translation:
 * idle → extracting → translating → complete | error
 *
 * Supports progressive injection, cancellation, and visibility toggle.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "../stores/settings-store";
import { isChapterFullyCached, markChapterFullyCached } from "../translation/chapter-cache";
import type {
  ChapterParagraph,
  ChapterTranslationProgress,
  ChapterTranslationResult,
} from "../translation/chapter-translator";
import { translateChapter } from "../translation/chapter-translator";

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export type ChapterTranslationState =
  | { status: "idle" }
  | { status: "extracting" }
  | { status: "translating"; progress: ChapterTranslationProgress }
  | { status: "complete"; originalVisible: boolean; translationVisible: boolean }
  | { status: "error"; message: string };

export interface UseChapterTranslationOptions {
  bookId: string;
  sectionIndex: number;
  /** Whether the reader is ready (DOM loaded) — auto-restore waits for this */
  ready?: boolean;
  /** Extract paragraphs from the current section DOM */
  getParagraphs: () => Promise<ChapterParagraph[]> | ChapterParagraph[];
  /** Inject translated paragraphs into the DOM */
  injectTranslations: (results: ChapterTranslationResult[]) => void;
  /** Remove all injected translations from the DOM */
  removeTranslations: () => void;
}

export function useChapterTranslation(options: UseChapterTranslationOptions) {
  const { bookId, sectionIndex, ready = true, getParagraphs, injectTranslations, removeTranslations } = options;

  const [state, setState] = useState<ChapterTranslationState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const autoRestoreAttemptedRef = useRef<string>("");
  const startTranslationRef = useRef<() => void>(() => {});

  const translationConfig = useSettingsStore((s) => s.translationConfig);
  const aiConfig = useSettingsStore((s) => s.aiConfig);

  // ---- Start Translation ---------------------------------------------------
  /** @param overrideTargetLang — if provided, overrides the settings targetLang for this run */
  const startTranslation = useCallback(
    async (overrideTargetLang?: string) => {
      // Build effective config (resolve AI endpoint)
      const config = { ...translationConfig };
      if (overrideTargetLang) {
        config.targetLang = overrideTargetLang as typeof config.targetLang;
      }
      if (config.provider.id === "ai") {
        const endpointId = config.provider.endpointId || aiConfig.activeEndpointId;
        const endpoint = aiConfig.endpoints.find((e) => e.id === endpointId);
        if (endpoint) {
          config.provider = {
            ...config.provider,
            apiKey: endpoint.apiKey,
            baseUrl: endpoint.baseUrl,
            model: config.provider.model || aiConfig.activeModel,
          };
        }
      }

      setState({ status: "extracting" });

      try {
        const paragraphs = await getParagraphs();

        if (!paragraphs || paragraphs.length === 0) {
          setState({ status: "error", message: "No text to translate" });
          return;
        }

        const abortController = new AbortController();
        abortRef.current = abortController;

        setState({
          status: "translating",
          progress: { totalParagraphs: paragraphs.length, translatedCount: 0 },
        });

        await translateChapter({
          paragraphs,
          sourceLang: "AUTO",
          targetLang: config.targetLang,
          config,
          onProgress: (progress) => {
            setState({ status: "translating", progress });
          },
          onChunkComplete: (results) => {
            injectTranslations(results);
          },
          signal: abortController.signal,
        });

        // Mark chapter fully cached
        markChapterFullyCached(bookId, sectionIndex, config.targetLang).catch(() => {});

        setState({ status: "complete", originalVisible: true, translationVisible: true });
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          // Cancelled — keep whatever was already injected, go to complete
          setState({ status: "complete", originalVisible: true, translationVisible: true });
        } else {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        abortRef.current = null;
      }
    },
    [translationConfig, aiConfig, bookId, sectionIndex, getParagraphs, injectTranslations],
  );

  // Keep ref in sync so auto-restore effect doesn't depend on startTranslation identity
  startTranslationRef.current = startTranslation;

  // ---- Cancel ---------------------------------------------------------------
  const cancelTranslation = useCallback(() => {
    abortRef.current?.abort();
    // State will be set to complete in the catch block above
  }, []);

  // ---- Toggle Original Visibility -------------------------------------------
  const toggleOriginalVisible = useCallback(() => {
    setState((prev) => {
      if (prev.status !== "complete") return prev;
      return { ...prev, originalVisible: !prev.originalVisible };
    });
  }, []);

  // ---- Toggle Translation Visibility ----------------------------------------
  const toggleTranslationVisible = useCallback(() => {
    setState((prev) => {
      if (prev.status !== "complete") return prev;
      return { ...prev, translationVisible: !prev.translationVisible };
    });
  }, []);

  // ---- Reset (e.g. on chapter change) ---------------------------------------
  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    autoRestoreAttemptedRef.current = "";
    removeTranslations();
    setState({ status: "idle" });
  }, [removeTranslations]);

  // ---- Auto-restore cached translations on section load -----------------------
  useEffect(() => {
    const key = `${bookId}_${sectionIndex}_${translationConfig.targetLang}`;
    // Only attempt once per section+lang combo, and only when idle+ready
    if (!ready || state.status !== "idle" || autoRestoreAttemptedRef.current === key) return;
    autoRestoreAttemptedRef.current = key;

    let cancelled = false;
    // Small delay to ensure DOM is fully stable after navigation
    const timer = setTimeout(() => {
      isChapterFullyCached(bookId, sectionIndex, translationConfig.targetLang).then((cached) => {
        if (cached && !cancelled) {
          startTranslationRef.current();
        }
      }).catch(() => {});
    }, 300);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [ready, bookId, sectionIndex, translationConfig.targetLang, state.status]);

  return { state, startTranslation, cancelTranslation, toggleOriginalVisible, toggleTranslationVisible, reset };
}
