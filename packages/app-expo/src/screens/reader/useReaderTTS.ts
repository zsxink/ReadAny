/**
 * useReaderTTS — encapsulates all TTS (text-to-speech) logic for ReaderScreen.
 *
 * Responsibilities:
 *  - TTS state: segments, prev/future pages, chunk offset, source kind, continuous mode
 *  - Cover URI resolution
 *  - All TTS callbacks: start page/selection/from-cfi, play/pause/replay, jump, load-more
 *  - All TTS-related useEffects: highlight sync, location tracking, lyric recovery, etc.
 *  - Cleanup on unmount (clear continuous callback, clear highlight)
 */

import { useTTSStore } from "@/stores";
import { normalizeTTSConfig, splitNarrationText, type TTSConfig } from "@readany/core/tts";
import { getPlatformService } from "@readany/core/services";
import { eventBus } from "@readany/core/utils/event-bus";
import type { VisibleTTSSegment } from "@/hooks/use-reader-bridge";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collectMissingTTSDebugSentences,
  findTTSDebugSentenceIndex,
  logTTSDebugSegments,
  logTTSDebugSentenceList,
  logTTSDebugText,
  normalizeTTSDebugSegments,
  normalizeTTSDebugText,
} from "./tts-debug-utils";

export type TTSSegment = VisibleTTSSegment;

// ─── Types for the bridge ref the hook needs ───────────────────────────────
export type TTSBridgeRef = {
  getVisibleText: () => Promise<string>;
  getVisibleTTSSegments: (alignCfi?: string | null) => Promise<TTSSegment[]>;
  getChapterParagraphs: () => Promise<Array<{ id: string; text: string; tagName: string }>>;
  getTTSSegmentContext: (
    cfi: string,
    before?: number,
    after?: number,
  ) => Promise<{ before: TTSSegment[]; after: TTSSegment[] }>;
  goToCFI: (cfi: string) => void;
  setTTSHighlight: (cfi: string | null, color?: string, force?: boolean) => void;
  flashHighlight: (cfi: string, color?: string, duration?: number) => void;
};

// ─── Hook inputs ────────────────────────────────────────────────────────────
export interface UseReaderTTSOptions {
  bookId: string;
  bookTitle: string;
  currentChapter: string;
  currentCfi: string;
  webViewReady: boolean;
  showTTS: boolean;
  setShowTTS: (v: boolean) => void;
  setShowControls: (v: boolean) => void;
  bridgeRef: React.RefObject<TTSBridgeRef | null>;
  toc: Array<{ title: string; href?: string }>;
  bookCoverUrl?: string;
  colors: { primary: string };
  goToHref: (href: string) => void;
}

// ─── Hook outputs ───────────────────────────────────────────────────────────
export interface UseReaderTTSResult {
  // State
  ttsCoverUri: string | undefined;
  ttsLastText: string;
  ttsSegments: TTSSegment[];
  ttsPrevPageSegments: TTSSegment[];
  ttsFutureSegments: TTSSegment[];
  ttsChunkOffset: number;
  ttsSourceKind: "page" | "selection";
  ttsContinuousEnabled: boolean;
  ttsSourceLabel: string;

  // Derived
  allLyricSegments: TTSSegment[];
  ttsDisplaySegments: TTSSegment[];
  currentTTSSegment: TTSSegment | null;
  resolvedTTSSegmentCfi: string | null;
  ttsHighlightColor: string;
  localTTSChunkIndex: number;

  // Handlers
  handleToggleTTS: () => Promise<void>;
  handleTTSReplay: () => Promise<void>;
  handleTTSPlayPause: () => Promise<void>;
  handleAdjustTTSRate: (delta: number) => void;
  handleAdjustTTSPitch: (delta: number) => void;
  handleUpdateTTSConfig: (updates: Partial<TTSConfig>) => void;
  handleToggleTTSContinuous: () => void;
  handleJumpToTTSSegment: (offsetFromCurrent: number) => void;
  handleJumpToTTSLyricSegment: (
    segment: { text: string; cfi?: string | null },
    offsetFromCurrent: number,
  ) => void;
  handleLoadMoreAboveTTSLyrics: () => Promise<void>;
  handleLoadMoreBelowTTSLyrics: () => Promise<void>;
  handleTTSPrevChapter: () => void;
  handleTTSNextChapter: () => void;
  startSelectionTTS: (text: string, selectionCfi?: string | null) => void;
  handleTTSStop: () => void;
  handleTTSReturnToReading: () => void;
  // Exposed refs for onRelocate integration
  pendingTTSContinueCallbackRef: React.RefObject<(() => void) | null>;
  pendingTTSContinueSafetyTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
}

const TTS_CONTEXT_CACHE_LIMIT = 24;
const TTS_CONTEXT_WINDOW = 12;

export function useReaderTTS({
  bookId,
  bookTitle,
  currentChapter,
  currentCfi,
  webViewReady,
  showTTS,
  setShowTTS,
  setShowControls,
  bridgeRef,
  toc,
  bookCoverUrl,
  colors,
  goToHref,
}: UseReaderTTSOptions): UseReaderTTSResult {
  // ─── TTS Store ─────────────────────────────────────────────────────────────
  const ttsPlay = useTTSStore((s) => s.play);
  const ttsPause = useTTSStore((s) => s.pause);
  const ttsResume = useTTSStore((s) => s.resume);
  const ttsStop = useTTSStore((s) => s.stop);
  const ttsPlayState = useTTSStore((s) => s.playState);
  const ttsCurrentText = useTTSStore((s) => s.currentText);
  const ttsCurrentSegmentText = useTTSStore((s) => s.currentSegmentText);
  const ttsConfig = useTTSStore((s) => s.config);
  const ttsUpdateConfig = useTTSStore((s) => s.updateConfig);
  const ttsSetOnEnd = useTTSStore((s) => s.setOnEnd);
  const ttsSetCurrentBook = useTTSStore((s) => s.setCurrentBook);
  const ttsSetCurrentLocation = useTTSStore((s) => s.setCurrentLocation);
  const ttsCurrentLocationCfi = useTTSStore((s) => s.currentLocationCfi);
  const ttsCurrentBookId = useTTSStore((s) => s.currentBookId);
  const ttsCurrentChunkIndex = useTTSStore((s) => s.currentChunkIndex);
  const ttsTotalChunks = useTTSStore((s) => s.totalChunks);
  const ttsJumpToChunk = useTTSStore((s) => s.jumpToChunk);

  // ─── TTS State ──────────────────────────────────────────────────────────────
  const [ttsCoverUri, setTtsCoverUri] = useState<string | undefined>(undefined);
  const [ttsLastText, setTtsLastText] = useState("");
  const [ttsSegments, setTtsSegments] = useState<TTSSegment[]>([]);
  const [ttsPrevPageSegments, setTtsPrevPageSegments] = useState<TTSSegment[]>([]);
  const [ttsFutureSegments, setTtsFutureSegments] = useState<TTSSegment[]>([]);
  const [ttsChunkOffset, setTtsChunkOffset] = useState(0);
  const [ttsSourceKind, setTtsSourceKind] = useState<"page" | "selection">("page");
  const [ttsContinuousEnabled, setTtsContinuousEnabled] = useState(true);

  // ─── TTS Refs ───────────────────────────────────────────────────────────────
  const ttsSegmentsRef = useRef<TTSSegment[]>([]);
  const ttsLastTextRef = useRef("");
  const ttsFutureSegmentsRef = useRef<TTSSegment[]>([]);
  const ttsPrevPageSegmentsRef = useRef<TTSSegment[]>([]);
  const ttsChunkOffsetRef = useRef(0);
  const ttsLoadMoreAboveRef = useRef<string | null>(null);
  const ttsLoadMoreBelowRef = useRef<string | null>(null);
  const ttsExhaustedAboveAnchorsRef = useRef(new Set<string>());
  const ttsExhaustedBelowAnchorsRef = useRef(new Set<string>());
  const lastTTSLyricPrimeSignatureRef = useRef<string | null>(null);
  const didForceReapplyTTSHighlightRef = useRef(false);
  const ttsLyricPrimeRequestIdRef = useRef(0);
  const lastFollowedTTSCfiRef = useRef<string | null>(null);
  const ttsRecoveringLyricsRef = useRef<string | null>(null);
  const ttsContextCacheRef = useRef<Map<string, { before: TTSSegment[]; after: TTSSegment[] }>>(
    new Map(),
  );
  const ttsContextInflightRef = useRef<
    Map<string, Promise<{ before: TTSSegment[]; after: TTSSegment[] }>>
  >(new Map());
  const ttsContinuousRef = useRef(false);
  const pendingTTSContinueCallbackRef = useRef<(() => void) | null>(null);
  const pendingTTSContinueSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPageTTSFromCfiRef = useRef<
    ((targetCfi: string, targetText?: string) => Promise<void>) | null
  >(null);
  const ttsHandlingPageEndRef = useRef(false);
  const ttsLastStopHandledSignatureRef = useRef<string | null>(null);
  const ttsStartChapterRef = useRef<string>("");
  const previousReaderBookIdRef = useRef<string | null>(null);

  const ttsHighlightColor = "rgba(96, 165, 250, 0.35)";

  // ─── Cover URI resolution ───────────────────────────────────────────────────
  useEffect(() => {
    const raw = bookCoverUrl;
    if (!raw) {
      setTtsCoverUri(undefined);
      return;
    }
    if (raw.startsWith("http") || raw.startsWith("blob") || raw.startsWith("file")) {
      setTtsCoverUri(raw);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();
        const absPath = await platform.joinPath(appData, raw);
        if (!cancelled) {
          setTtsCoverUri(absPath);
        }
      } catch {
        if (!cancelled) {
          setTtsCoverUri(undefined);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bookCoverUrl]);

  // ─── Reset context caches when bookId changes ───────────────────────────────
  useEffect(() => {
    const previousBookId = previousReaderBookIdRef.current;
    previousReaderBookIdRef.current = bookId;
    const switchedBook = !!previousBookId && previousBookId !== bookId;

    ttsContextCacheRef.current.clear();
    ttsContextInflightRef.current.clear();
    setTtsLastText("");
    setTtsSegments([]);
    setTtsPrevPageSegments([]);
    setTtsFutureSegments([]);
    setTtsChunkOffset(0);
    setTtsSourceKind("page");
    ttsSegmentsRef.current = [];
    ttsPrevPageSegmentsRef.current = [];
    ttsFutureSegmentsRef.current = [];
    ttsLastTextRef.current = "";
    ttsChunkOffsetRef.current = 0;
    ttsLoadMoreAboveRef.current = null;
    ttsLoadMoreBelowRef.current = null;
    ttsExhaustedAboveAnchorsRef.current.clear();
    ttsExhaustedBelowAnchorsRef.current.clear();
    lastTTSLyricPrimeSignatureRef.current = null;
    didForceReapplyTTSHighlightRef.current = false;
    ttsLyricPrimeRequestIdRef.current += 1;
    lastFollowedTTSCfiRef.current = null;
    ttsRecoveringLyricsRef.current = null;
    ttsContinuousRef.current = false;
    ttsHandlingPageEndRef.current = false;
    ttsLastStopHandledSignatureRef.current = null;
    ttsStartChapterRef.current = "";
    pendingTTSContinueCallbackRef.current = null;
    if (pendingTTSContinueSafetyTimerRef.current) {
      clearTimeout(pendingTTSContinueSafetyTimerRef.current);
      pendingTTSContinueSafetyTimerRef.current = null;
    }
    if (switchedBook) {
      setShowTTS(false);
      bridgeRef.current?.setTTSHighlight(null);
    }
  }, [bookId, bridgeRef, setShowTTS]);

  // ─── Sync segment refs whenever state changes ───────────────────────────────
  useEffect(() => {
    ttsSegmentsRef.current = ttsSegments;
    ttsPrevPageSegmentsRef.current = ttsPrevPageSegments;
    ttsLastTextRef.current = ttsLastText;
    ttsFutureSegmentsRef.current = ttsFutureSegments;
  }, [ttsFutureSegments, ttsLastText, ttsPrevPageSegments, ttsSegments]);

  useEffect(() => {
    ttsChunkOffsetRef.current = ttsChunkOffset;
  }, [ttsChunkOffset]);

  // ─── Derived values ─────────────────────────────────────────────────────────
  const getTTSSegmentIdentity = useCallback(
    (segment: TTSSegment | null | undefined) =>
      `${segment?.cfi || ""}::${(segment?.text || "").replace(/\s+/g, " ").trim()}`,
    [],
  );

  const allLyricSegments = useMemo(
    () => [...ttsPrevPageSegments, ...ttsSegments, ...ttsFutureSegments],
    [ttsFutureSegments, ttsPrevPageSegments, ttsSegments],
  );
  const ttsDisplaySegments = useMemo(
    () => [...ttsSegments, ...ttsFutureSegments],
    [ttsFutureSegments, ttsSegments],
  );
  const localTTSChunkIndex = Math.max(0, ttsCurrentChunkIndex - ttsChunkOffset);

  const currentTTSSegment = useMemo(() => {
    if (ttsCurrentBookId !== bookId) return null;
    const normalizedCurrentText = (ttsCurrentSegmentText || ttsCurrentText || "")
      .replace(/\s+/g, " ")
      .trim();
    const normalizedSegmentText = (segment?: TTSSegment | null) =>
      (segment?.text || "").replace(/\s+/g, " ").trim();
    const indexSegment =
      ttsSegments.length > 0 && localTTSChunkIndex >= 0 && localTTSChunkIndex < ttsSegments.length
        ? ttsSegments[localTTSChunkIndex] || null
        : null;
    const cfiMatchedSegment = ttsCurrentLocationCfi
      ? allLyricSegments.find((segment) => {
          if (segment.cfi !== ttsCurrentLocationCfi) return false;
          if (
            normalizedCurrentText &&
            (segment.text || "").replace(/\s+/g, " ").trim() !== normalizedCurrentText
          ) {
            return false;
          }
          return true;
        }) ||
        allLyricSegments.find((segment) => segment.cfi === ttsCurrentLocationCfi) ||
        null
      : null;
    const textMatchedSegment =
      normalizedCurrentText.length > 0
        ? allLyricSegments.find(
            (segment) => normalizedSegmentText(segment) === normalizedCurrentText,
          ) || null
        : null;

    if (indexSegment) {
      if (!normalizedCurrentText) return indexSegment;
      if (normalizedSegmentText(indexSegment) === normalizedCurrentText) {
        return indexSegment;
      }
    }
    if (cfiMatchedSegment) return cfiMatchedSegment;
    if (textMatchedSegment) return textMatchedSegment;
    if (indexSegment) return indexSegment;
    return null;
  }, [
    allLyricSegments,
    bookId,
    localTTSChunkIndex,
    ttsCurrentBookId,
    ttsCurrentLocationCfi,
    ttsCurrentSegmentText,
    ttsCurrentText,
    ttsSegments,
  ]);

  const resolvedTTSSegmentCfi = useMemo(() => {
    if (ttsCurrentBookId !== bookId) return null;
    if (currentTTSSegment?.cfi) return currentTTSSegment.cfi;
    return ttsCurrentLocationCfi || null;
  }, [bookId, currentTTSSegment?.cfi, ttsCurrentBookId, ttsCurrentLocationCfi]);

  const ttsSourceLabel =
    ttsSourceKind === "selection" ? "来自选中文本" : "从当前页开始";

  // ─── Utility callbacks ──────────────────────────────────────────────────────
  const syncTTSChunkOffset = useCallback((nextOffset: number) => {
    ttsChunkOffsetRef.current = nextOffset;
    setTtsChunkOffset(nextOffset);
  }, []);

  const dedupeTTSSegments = useCallback(
    (segments: TTSSegment[]) => {
      const seenIdentities = new Set<string>();
      const result: TTSSegment[] = [];
      for (const segment of segments) {
        if (!segment.text.trim()) continue;
        const identity = getTTSSegmentIdentity(segment);
        if (seenIdentities.has(identity)) continue;
        seenIdentities.add(identity);
        result.push(segment);
      }
      return result;
    },
    [getTTSSegmentIdentity],
  );

  const filterDistinctTTSSegments = useCallback(
    (incoming: TTSSegment[], ...existingGroups: TTSSegment[][]) => {
      const blockedIdentities = new Set<string>();
      for (const segment of existingGroups.flat()) {
        blockedIdentities.add(getTTSSegmentIdentity(segment));
      }
      const result: TTSSegment[] = [];
      for (const segment of dedupeTTSSegments(incoming)) {
        const identity = getTTSSegmentIdentity(segment);
        if (blockedIdentities.has(identity)) continue;
        blockedIdentities.add(identity);
        result.push(segment);
      }
      return result;
    },
    [dedupeTTSSegments, getTTSSegmentIdentity],
  );

  const areTTSSegmentListsEqual = useCallback((a: TTSSegment[], b: TTSSegment[]) => {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if ((a[i]?.cfi || null) !== (b[i]?.cfi || null)) return false;
      if ((a[i]?.text || "").trim() !== (b[i]?.text || "").trim()) return false;
    }
    return true;
  }, []);

  const mergeUniqueTTSSegments = useCallback(
    (base: TTSSegment[], incoming: TTSSegment[], direction: "prepend" | "append" = "append") => {
      const ordered = direction === "prepend" ? [...incoming, ...base] : [...base, ...incoming];
      return dedupeTTSSegments(ordered);
    },
    [dedupeTTSSegments],
  );

  // ─── Context cache ──────────────────────────────────────────────────────────
  const getCachedTTSSegmentContext = useCallback(
    async (
      cfi: string | null | undefined,
      before = TTS_CONTEXT_WINDOW,
      after = TTS_CONTEXT_WINDOW,
    ) => {
      if (!cfi || !bridgeRef.current?.getTTSSegmentContext) {
        return { before: [], after: [] };
      }
      const key = `${cfi}|${before}|${after}`;
      const cached = ttsContextCacheRef.current.get(key);
      if (cached) {
        ttsContextCacheRef.current.delete(key);
        ttsContextCacheRef.current.set(key, cached);
        return cached;
      }

      const inflight = ttsContextInflightRef.current.get(key);
      if (inflight) return inflight;

      const request = bridgeRef.current
        .getTTSSegmentContext(cfi, before, after)
        .then((context) => {
          const normalized = {
            before: dedupeTTSSegments(
              (context.before || [])
                .map((segment) => ({ text: segment.text.trim(), cfi: segment.cfi }))
                .filter((segment) => segment.text.length > 0),
            ),
            after: dedupeTTSSegments(
              (context.after || [])
                .map((segment) => ({ text: segment.text.trim(), cfi: segment.cfi }))
                .filter((segment) => segment.text.length > 0),
            ),
          };
          ttsContextCacheRef.current.set(key, normalized);
          while (ttsContextCacheRef.current.size > TTS_CONTEXT_CACHE_LIMIT) {
            const oldestKey = ttsContextCacheRef.current.keys().next().value;
            if (!oldestKey) break;
            ttsContextCacheRef.current.delete(oldestKey);
          }
          return normalized;
        })
        .finally(() => {
          ttsContextInflightRef.current.delete(key);
        });

      ttsContextInflightRef.current.set(key, request);
      return request;
    },
    [bridgeRef, dedupeTTSSegments],
  );

  // ─── getNormalizedVisibleTTSSegments ───────────────────────────────────────
  const getNormalizedVisibleTTSSegments = useCallback(
    async (alignCfi?: string | null) => {
      const segmentCandidates = await bridgeRef.current?.getVisibleTTSSegments(alignCfi);
      const segments =
        segmentCandidates && segmentCandidates.length > 0
          ? segmentCandidates
          : splitNarrationText((await bridgeRef.current?.getVisibleText()) || "").map(
              (segmentText) => ({
                text: segmentText,
                cfi: alignCfi || currentCfi,
              }),
            );

      return segments
        .map((segment) => ({
          text: segment.text.trim(),
          cfi: segment.cfi,
        }))
        .filter((segment) => segment.text.length > 0);
    },
    [bridgeRef, currentCfi],
  );

  // ─── logTTSExtractionDiagnostics ──────────────────────────────────────────
  const logTTSExtractionDiagnostics = useCallback(
    async ({
      reason,
      alignCfi,
      targetCfi,
      targetText,
      rawVisibleSegments,
      playbackSegments,
    }: {
      reason: string;
      alignCfi?: string | null;
      targetCfi?: string | null;
      targetText?: string | null;
      rawVisibleSegments: TTSSegment[];
      playbackSegments: TTSSegment[];
    }) => {
      if (!__DEV__) return;
      if (!bridgeRef.current) return;

      try {
        const [chapterParagraphs, visibleText] = await Promise.all([
          bridgeRef.current.getChapterParagraphs(),
          bridgeRef.current.getVisibleText(),
        ]);
        const chapterText = chapterParagraphs
          .map((paragraph: { id: string; text: string; tagName: string }) =>
            normalizeTTSDebugText(paragraph.text),
          )
          .filter(Boolean)
          .join("\n");
        const normalizedVisibleText = normalizeTTSDebugText(visibleText);
        const pageSentences = splitNarrationText(normalizedVisibleText)
          .map((sentence) => normalizeTTSDebugText(sentence))
          .filter(Boolean);
        const normalizedRawVisibleSegments = normalizeTTSDebugSegments(rawVisibleSegments);
        const normalizedPlaybackSegments = normalizeTTSDebugSegments(playbackSegments);
        const missingFromRaw = collectMissingTTSDebugSentences(
          pageSentences,
          normalizedRawVisibleSegments,
        );
        const missingFromPlayback = collectMissingTTSDebugSentences(
          pageSentences,
          normalizedPlaybackSegments,
        );
        const pageFirstSentence = pageSentences[0] || null;
        const rawFirstSentence = normalizedRawVisibleSegments[0]?.text || null;
        const playbackFirstSentence = normalizedPlaybackSegments[0]?.text || null;

        console.log("[ReaderScreen][TTS][diagnostics] summary", {
          reason,
          chapterTitle: currentChapter,
          currentCfi,
          alignCfi: alignCfi || null,
          targetCfi: targetCfi || null,
          targetTextLength: normalizeTTSDebugText(targetText).length,
          chapterParagraphCount: chapterParagraphs.length,
          chapterTextLength: chapterText.length,
          visibleTextLength: normalizedVisibleText.length,
          pageSentenceCount: pageSentences.length,
          rawVisibleSegmentCount: normalizedRawVisibleSegments.length,
          playbackSegmentCount: normalizedPlaybackSegments.length,
          missingFromRawCount: missingFromRaw.length,
          missingFromPlaybackCount: missingFromPlayback.length,
          pageFirstSentence,
          rawFirstSentence,
          playbackFirstSentence,
          pageFirstIndexInRaw: findTTSDebugSentenceIndex(
            pageFirstSentence,
            normalizedRawVisibleSegments,
          ),
          pageFirstIndexInPlayback: findTTSDebugSentenceIndex(
            pageFirstSentence,
            normalizedPlaybackSegments,
          ),
          rawFirstCfi: normalizedRawVisibleSegments[0]?.cfi || null,
          playbackFirstCfi: normalizedPlaybackSegments[0]?.cfi || null,
          playbackLastCfi:
            normalizedPlaybackSegments[normalizedPlaybackSegments.length - 1]?.cfi || null,
        });

        logTTSDebugText("[ReaderScreen][TTS][diagnostics] chapter-text", chapterText);
        logTTSDebugText("[ReaderScreen][TTS][diagnostics] visible-text", normalizedVisibleText);
        logTTSDebugSentenceList(
          "[ReaderScreen][TTS][diagnostics] visible-sentences",
          pageSentences,
        );
        logTTSDebugSegments(
          "[ReaderScreen][TTS][diagnostics] raw-visible-segments",
          normalizedRawVisibleSegments,
        );
        logTTSDebugSegments(
          "[ReaderScreen][TTS][diagnostics] playback-segments",
          normalizedPlaybackSegments,
        );
        if (missingFromRaw.length > 0) {
          logTTSDebugSentenceList(
            "[ReaderScreen][TTS][diagnostics] missing-from-raw",
            missingFromRaw,
          );
        }
        if (missingFromPlayback.length > 0) {
          logTTSDebugSentenceList(
            "[ReaderScreen][TTS][diagnostics] missing-from-playback",
            missingFromPlayback,
          );
        }
      } catch (error) {
        console.warn("[ReaderScreen][TTS][diagnostics] failed", {
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [bridgeRef, currentCfi, currentChapter],
  );

  // ─── primeTTSLyricContext ──────────────────────────────────────────────────
  const primeTTSLyricContext = useCallback(
    async (
      currentCfi: string | null | undefined,
      firstCfi?: string | null,
      lastCfi?: string | null,
    ) => {
      if (!currentCfi) return;
      const requestId = ttsLyricPrimeRequestIdRef.current + 1;
      ttsLyricPrimeRequestIdRef.current = requestId;
      const [centerContext, leadingContext, trailingContext] = await Promise.all([
        getCachedTTSSegmentContext(currentCfi, TTS_CONTEXT_WINDOW, TTS_CONTEXT_WINDOW),
        firstCfi
          ? getCachedTTSSegmentContext(firstCfi, TTS_CONTEXT_WINDOW, 0)
          : Promise.resolve({ before: [], after: [] }),
        lastCfi
          ? getCachedTTSSegmentContext(lastCfi, 0, TTS_CONTEXT_WINDOW)
          : Promise.resolve({ before: [], after: [] }),
      ]);

      const previous = filterDistinctTTSSegments(
        [...(leadingContext.before || []), ...(centerContext.before || [])],
        ttsSegmentsRef.current,
      ).slice(-(TTS_CONTEXT_WINDOW * 2));

      const future = filterDistinctTTSSegments(
        [...(centerContext.after || []), ...(trailingContext.after || [])],
        previous,
        ttsSegmentsRef.current,
      ).slice(0, TTS_CONTEXT_WINDOW * 2);

      if (ttsLyricPrimeRequestIdRef.current !== requestId) {
        return;
      }

      setTtsPrevPageSegments((prev) => {
        const next = mergeUniqueTTSSegments(prev, previous, "append");
        if (areTTSSegmentListsEqual(prev, next)) {
          ttsPrevPageSegmentsRef.current = prev;
          return prev;
        }
        ttsPrevPageSegmentsRef.current = next;
        return next;
      });
      setTtsFutureSegments((prev) => {
        const next = mergeUniqueTTSSegments(prev, future, "append");
        if (areTTSSegmentListsEqual(prev, next)) {
          ttsFutureSegmentsRef.current = prev;
          return prev;
        }
        ttsFutureSegmentsRef.current = next;
        return next;
      });
    },
    [
      areTTSSegmentListsEqual,
      filterDistinctTTSSegments,
      getCachedTTSSegmentContext,
      mergeUniqueTTSSegments,
    ],
  );

  // ─── recoverTTSLyricsState ────────────────────────────────────────────────
  const recoverTTSLyricsState = useCallback(async () => {
    if (ttsSourceKind !== "page") return false;
    if (ttsCurrentBookId !== bookId) return false;
    const normalizedStoreSegmentText = normalizeTTSDebugText(ttsCurrentSegmentText);
    const alignCfi = currentCfi || ttsCurrentLocationCfi || resolvedTTSSegmentCfi || null;
    let anchorCfi = resolvedTTSSegmentCfi || ttsCurrentLocationCfi || currentCfi || null;

    if (normalizedStoreSegmentText && bridgeRef.current) {
      try {
        const visibleSegments = await getNormalizedVisibleTTSSegments(alignCfi);
        const visibleIndex = visibleSegments.findIndex(
          (segment) => normalizeTTSDebugText(segment.text) === normalizedStoreSegmentText,
        );
        if (visibleIndex >= 0) {
          const visibleSeed = visibleSegments.slice(visibleIndex);
          const matchedVisible = visibleSeed[0] || null;
          anchorCfi = matchedVisible?.cfi || anchorCfi;
          const context = await getCachedTTSSegmentContext(
            anchorCfi,
            TTS_CONTEXT_WINDOW,
            TTS_CONTEXT_WINDOW * 2,
          );
          const previous = filterDistinctTTSSegments(context.before || [], visibleSeed).slice(
            -(TTS_CONTEXT_WINDOW * 2),
          );
          const future = filterDistinctTTSSegments(
            context.after || [],
            previous,
            visibleSeed,
          ).slice(0, TTS_CONTEXT_WINDOW * 2);
          const nextText =
            visibleSeed
              .map((segment) => segment.text)
              .join(" ")
              .trim() || normalizedStoreSegmentText;

          if (__DEV__) {
            console.log("[ReaderScreen][TTS] recover-visible-match", {
              anchorCfi,
              visibleSegmentsLength: visibleSegments.length,
              visibleIndex,
              recoveredSegmentsLength: visibleSeed.length,
              previousLength: previous.length,
              futureLength: future.length,
              normalizedStoreSegmentTextLength: normalizedStoreSegmentText.length,
            });
          }

          setTtsPrevPageSegments(previous);
          setTtsSegments(visibleSeed);
          setTtsFutureSegments(future);
          setTtsLastText(nextText);
          ttsPrevPageSegmentsRef.current = previous;
          ttsSegmentsRef.current = visibleSeed;
          ttsFutureSegmentsRef.current = future;
          ttsLastTextRef.current = nextText;
          syncTTSChunkOffset(ttsCurrentChunkIndex);
          if (anchorCfi) {
            ttsSetCurrentLocation(anchorCfi);
          }
          return true;
        }
      } catch (error) {
        console.warn("[ReaderScreen][TTS] recover-visible-match failed", {
          error: error instanceof Error ? error.message : String(error),
          alignCfi,
          anchorCfi,
        });
      }
    }

    if (!anchorCfi) return false;

    const seedSegments = (() => {
      if (normalizedStoreSegmentText) {
        return [{ text: normalizedStoreSegmentText, cfi: anchorCfi }];
      }
      return splitNarrationText(ttsCurrentText || "")
        .map((text) => text.trim())
        .filter(Boolean)
        .map((text) => ({ text, cfi: anchorCfi }));
    })();

    const requestKey = `${anchorCfi}|${ttsCurrentChunkIndex}|${seedSegments[0]?.text || ""}`;
    if (ttsRecoveringLyricsRef.current === requestKey) return false;
    ttsRecoveringLyricsRef.current = requestKey;

    try {
      const context = await getCachedTTSSegmentContext(
        anchorCfi,
        TTS_CONTEXT_WINDOW,
        TTS_CONTEXT_WINDOW * 2,
      );
      const nextSegments =
        seedSegments.length > 0
          ? dedupeTTSSegments([
              ...seedSegments,
              ...filterDistinctTTSSegments(context.after || [], seedSegments),
            ])
          : dedupeTTSSegments(context.after || []);
      const previous = filterDistinctTTSSegments(context.before || [], nextSegments).slice(
        -(TTS_CONTEXT_WINDOW * 2),
      );

      if (!previous.length && !nextSegments.length) {
        return false;
      }

      const nextText =
        nextSegments
          .map((segment) => segment.text)
          .join(" ")
          .trim() ||
        (ttsCurrentText || "").trim() ||
        ttsLastTextRef.current;

      setTtsPrevPageSegments(previous);
      setTtsSegments(nextSegments);
      setTtsFutureSegments([]);
      setTtsLastText(nextText);
      ttsPrevPageSegmentsRef.current = previous;
      ttsSegmentsRef.current = nextSegments;
      ttsFutureSegmentsRef.current = [];
      ttsLastTextRef.current = nextText;
      syncTTSChunkOffset(ttsCurrentChunkIndex);
      if (__DEV__) {
        console.log("[ReaderScreen][TTS] recover-context-fallback", {
          anchorCfi,
          previousLength: previous.length,
          nextSegmentsLength: nextSegments.length,
          nextTextLength: nextText.length,
          currentChunkIndex: ttsCurrentChunkIndex,
        });
      }
      return true;
    } finally {
      if (ttsRecoveringLyricsRef.current === requestKey) {
        ttsRecoveringLyricsRef.current = null;
      }
    }
  }, [
    bookId,
    bridgeRef,
    currentCfi,
    dedupeTTSSegments,
    filterDistinctTTSSegments,
    getCachedTTSSegmentContext,
    getNormalizedVisibleTTSSegments,
    resolvedTTSSegmentCfi,
    syncTTSChunkOffset,
    ttsCurrentBookId,
    ttsCurrentChunkIndex,
    ttsCurrentLocationCfi,
    ttsCurrentSegmentText,
    ttsCurrentText,
    ttsSetCurrentLocation,
    ttsSourceKind,
  ]);

  // ─── handleTTSPageEnd ─────────────────────────────────────────────────────
  const handleTTSPageEnd = useCallback(() => {
    const shouldContinue = ttsContinuousRef.current && ttsSourceKind === "page";
    console.log("[ReaderScreen][TTS] handle-page-end", {
      shouldContinue,
      continuousRef: ttsContinuousRef.current,
      continuousEnabled: ttsContinuousEnabled,
      sourceKind: ttsSourceKind,
      currentChunkIndex: ttsCurrentChunkIndex,
      totalChunks: ttsTotalChunks,
      currentLocationCfi: ttsCurrentLocationCfi,
      currentSegmentCfi: (currentTTSSegment as TTSSegment | null)?.cfi || null,
      activeSegmentsLength: ttsSegmentsRef.current.length,
      hasRestartFromCfi: !!startPageTTSFromCfiRef.current,
    });
    if (!shouldContinue) return;
    if (ttsHandlingPageEndRef.current) {
      console.log("[ReaderScreen][TTS] handle-page-end skipped: already running");
      return;
    }
    ttsHandlingPageEndRef.current = true;
    const previousSegments = ttsSegmentsRef.current;
    const previousFirstCfi =
      previousSegments[0]?.cfi || (currentTTSSegment as TTSSegment | null)?.cfi || currentCfi || null;
    const previousLastCfi =
      previousSegments[previousSegments.length - 1]?.cfi ||
      (currentTTSSegment as TTSSegment | null)?.cfi ||
      previousFirstCfi;
    const previousText = ttsLastTextRef.current;
    console.log("[ReaderScreen][TTS] page end", {
      previousFirstCfi,
      previousLastCfi,
      previousTextLength: previousText.length,
      previousSegmentCount: previousSegments.length,
    });

    if (previousSegments.length > 0) {
      setTtsPrevPageSegments((prev) => {
        const next = mergeUniqueTTSSegments(prev, previousSegments, "append");
        ttsPrevPageSegmentsRef.current = next;
        return next;
      });
    }
    ttsExhaustedAboveAnchorsRef.current.clear();
    ttsExhaustedBelowAnchorsRef.current.clear();

    if (pendingTTSContinueSafetyTimerRef.current) {
      clearTimeout(pendingTTSContinueSafetyTimerRef.current);
      pendingTTSContinueSafetyTimerRef.current = null;
    }
    pendingTTSContinueCallbackRef.current = null;

    bridgeRef.current?.setTTSHighlight(null);

    void (async () => {
      try {
        if (!ttsContinuousRef.current) return;
        const restartFromCfi = startPageTTSFromCfiRef.current;
        const context = await getCachedTTSSegmentContext(previousLastCfi, 0, TTS_CONTEXT_WINDOW * 2);
        const nextSegment =
          (context.after || []).find((segment) => segment.text.trim().length > 0) || null;
        console.log("[ReaderScreen][TTS] continue from context", {
          previousLastCfi,
          nextCfi: nextSegment?.cfi || null,
          nextTextLength: nextSegment?.text?.length || 0,
          afterCount: context.after?.length || 0,
        });

        if (nextSegment?.cfi && restartFromCfi) {
          await restartFromCfi(nextSegment.cfi, nextSegment.text);
          return;
        }

        ttsContinuousRef.current = false;
        ttsSetOnEnd(null);
        ttsStop();
      } finally {
        ttsHandlingPageEndRef.current = false;
      }
    })();
  }, [
    bridgeRef,
    currentCfi,
    currentTTSSegment,
    getCachedTTSSegmentContext,
    mergeUniqueTTSSegments,
    ttsContinuousEnabled,
    ttsCurrentChunkIndex,
    ttsCurrentLocationCfi,
    ttsSetOnEnd,
    ttsSourceKind,
    ttsStop,
    ttsTotalChunks,
  ]);

  // ─── startPageTTSFromCfi ──────────────────────────────────────────────────
  const startPageTTSFromCfi = useCallback(
    async (targetCfi: string, targetText?: string) => {
      if (!targetCfi || !bridgeRef.current) return;
      const normalizedTargetText = (targetText || "").trim();
      pendingTTSContinueCallbackRef.current = null;
      if (pendingTTSContinueSafetyTimerRef.current) {
        clearTimeout(pendingTTSContinueSafetyTimerRef.current);
        pendingTTSContinueSafetyTimerRef.current = null;
      }
      bridgeRef.current.goToCFI(targetCfi);
      await new Promise((resolve) => setTimeout(resolve, 320));
      const normalizedSegments = await getNormalizedVisibleTTSSegments(targetCfi);
      const context = await getCachedTTSSegmentContext(
        targetCfi,
        TTS_CONTEXT_WINDOW,
        TTS_CONTEXT_WINDOW * 2,
      );
      const exactVisibleIndex = normalizedSegments.findIndex((segment) => {
        if (segment.cfi !== targetCfi) return false;
        if (normalizedTargetText && segment.text.trim() !== normalizedTargetText) return false;
        return true;
      });
      const visibleIndexByCfi =
        exactVisibleIndex >= 0
          ? exactVisibleIndex
          : normalizedSegments.findIndex((segment) => segment.cfi === targetCfi);
      const seedSegment =
        normalizedTargetText.length > 0 ? [{ text: normalizedTargetText, cfi: targetCfi }] : [];
      const visibleSegments =
        visibleIndexByCfi >= 0
          ? normalizedSegments.slice(visibleIndexByCfi)
          : dedupeTTSSegments([
              ...seedSegment,
              ...filterDistinctTTSSegments(context.after || [], seedSegment),
            ]);
      if (!visibleSegments.length) return;
      const previousContext = filterDistinctTTSSegments(context.before || [], visibleSegments);
      const previous = mergeUniqueTTSSegments(
        ttsPrevPageSegmentsRef.current,
        previousContext,
        "append",
      );
      const future = filterDistinctTTSSegments(context.after || [], previous, visibleSegments);
      const nextText = visibleSegments
        .map((segment) => segment.text)
        .join(" ")
        .trim();
      if (__DEV__) {
        console.log("[ReaderScreen][TTS] start-from-cfi", {
          targetCfi,
          normalizedTargetTextLength: normalizedTargetText.length,
          normalizedSegmentsLength: normalizedSegments.length,
          exactVisibleIndex,
          visibleIndexByCfi,
          visibleSegmentsLength: visibleSegments.length,
          previousLength: previous.length,
          futureLength: future.length,
          firstVisibleCfi: visibleSegments[0]?.cfi || null,
          lastVisibleCfi: visibleSegments[visibleSegments.length - 1]?.cfi || null,
          firstVisibleText: normalizeTTSDebugText(visibleSegments[0]?.text),
        });
      }
      void logTTSExtractionDiagnostics({
        reason: "start-from-cfi",
        alignCfi: targetCfi,
        targetCfi,
        targetText: normalizedTargetText,
        rawVisibleSegments: normalizedSegments,
        playbackSegments: visibleSegments,
      });
      setTtsSegments(visibleSegments);
      setTtsPrevPageSegments(previous);
      setTtsFutureSegments(future);
      ttsExhaustedAboveAnchorsRef.current.clear();
      ttsExhaustedBelowAnchorsRef.current.clear();
      ttsLyricPrimeRequestIdRef.current += 1;
      setTtsLastText(nextText);
      ttsSegmentsRef.current = visibleSegments;
      ttsPrevPageSegmentsRef.current = previous;
      ttsLastTextRef.current = nextText;
      ttsFutureSegmentsRef.current = future;
      syncTTSChunkOffset(0);
      ttsSetCurrentLocation(visibleSegments[0]?.cfi || targetCfi);
      ttsContinuousRef.current = ttsSourceKind === "page" && ttsContinuousEnabled;
      ttsSetOnEnd(ttsContinuousRef.current ? handleTTSPageEnd : null);
      ttsPlay(visibleSegments.map((segment) => segment.text));
    },
    [
      bridgeRef,
      dedupeTTSSegments,
      filterDistinctTTSSegments,
      getCachedTTSSegmentContext,
      getNormalizedVisibleTTSSegments,
      handleTTSPageEnd,
      logTTSExtractionDiagnostics,
      mergeUniqueTTSSegments,
      syncTTSChunkOffset,
      ttsContinuousEnabled,
      ttsPlay,
      ttsSetCurrentLocation,
      ttsSetOnEnd,
      ttsSourceKind,
    ],
  );

  useEffect(() => {
    startPageTTSFromCfiRef.current = startPageTTSFromCfi;
  }, [startPageTTSFromCfi]);

  // ─── startPageTTS ─────────────────────────────────────────────────────────
  const startPageTTS = useCallback(
    async (continuous = ttsContinuousEnabled) => {
      const pageAnchorCfi = currentCfi || null;
      const normalizedSegments = await getNormalizedVisibleTTSSegments(pageAnchorCfi);
      const normalized = normalizedSegments
        .map((segment) => segment.text)
        .join(" ")
        .trim();
      if (!normalized) return;
      if (__DEV__) {
        console.log("[ReaderScreen][TTS] start-page", {
          pageAnchorCfi,
          segmentCount: normalizedSegments.length,
          firstCfi: normalizedSegments[0]?.cfi || null,
          lastCfi: normalizedSegments[normalizedSegments.length - 1]?.cfi || null,
          firstText: normalizeTTSDebugText(normalizedSegments[0]?.text),
        });
      }
      void logTTSExtractionDiagnostics({
        reason: "start-page",
        alignCfi: pageAnchorCfi,
        targetCfi: normalizedSegments[0]?.cfi || pageAnchorCfi,
        targetText: normalizedSegments[0]?.text || null,
        rawVisibleSegments: normalizedSegments,
        playbackSegments: normalizedSegments,
      });
      ttsStartChapterRef.current = currentChapter;
      setTtsSourceKind("page");
      setTtsContinuousEnabled(continuous);
      setTtsLastText(normalized);
      setTtsSegments(normalizedSegments);
      setTtsPrevPageSegments([]);
      setTtsFutureSegments([]);
      ttsExhaustedAboveAnchorsRef.current.clear();
      ttsExhaustedBelowAnchorsRef.current.clear();
      ttsLyricPrimeRequestIdRef.current += 1;
      ttsLastTextRef.current = normalized;
      ttsSegmentsRef.current = normalizedSegments;
      ttsPrevPageSegmentsRef.current = [];
      ttsFutureSegmentsRef.current = [];
      syncTTSChunkOffset(0);
      ttsContinuousRef.current = continuous;
      ttsSetOnEnd(continuous ? handleTTSPageEnd : null);
      ttsSetCurrentBook(bookTitle, currentChapter, bookId);
      ttsSetCurrentLocation(normalizedSegments[0]?.cfi || pageAnchorCfi);
      setShowControls(false);
      setShowTTS(true);
      void primeTTSLyricContext(
        normalizedSegments[0]?.cfi || pageAnchorCfi,
        normalizedSegments[0]?.cfi || pageAnchorCfi,
        normalizedSegments[normalizedSegments.length - 1]?.cfi ||
          normalizedSegments[0]?.cfi ||
          pageAnchorCfi,
      );
      ttsPlay(
        normalizedSegments.length > 0
          ? normalizedSegments.map((segment) => segment.text)
          : normalized,
      );
    },
    [
      bookId,
      bookTitle,
      currentChapter,
      currentCfi,
      handleTTSPageEnd,
      logTTSExtractionDiagnostics,
      getNormalizedVisibleTTSSegments,
      primeTTSLyricContext,
      setShowControls,
      setShowTTS,
      syncTTSChunkOffset,
      ttsContinuousEnabled,
      ttsPlay,
      ttsSetCurrentBook,
      ttsSetCurrentLocation,
      ttsSetOnEnd,
    ],
  );

  // ─── startSelectionTTS ────────────────────────────────────────────────────
  const startSelectionTTS = useCallback(
    (text: string, selectionCfi?: string | null) => {
      const normalized = text.trim();
      if (!normalized) return;
      const segments = splitNarrationText(normalized).map((segmentText) => ({
        text: segmentText,
        cfi: selectionCfi || currentCfi,
      }));
      setTtsSourceKind("selection");
      setTtsContinuousEnabled(false);
      setTtsLastText(normalized);
      setTtsSegments(segments);
      setTtsPrevPageSegments([]);
      setTtsFutureSegments([]);
      ttsExhaustedAboveAnchorsRef.current.clear();
      ttsExhaustedBelowAnchorsRef.current.clear();
      ttsLyricPrimeRequestIdRef.current += 1;
      ttsLastTextRef.current = normalized;
      ttsSegmentsRef.current = segments;
      ttsPrevPageSegmentsRef.current = [];
      ttsFutureSegmentsRef.current = [];
      syncTTSChunkOffset(0);
      ttsContinuousRef.current = false;
      ttsSetOnEnd(null);
      ttsSetCurrentLocation(selectionCfi || currentCfi);
      ttsSetCurrentBook(bookTitle, currentChapter, bookId);
      setShowControls(false);
      setShowTTS(true);
      ttsPlay(segments.length > 0 ? segments.map((segment) => segment.text) : normalized);
    },
    [
      bookId,
      bookTitle,
      currentChapter,
      currentCfi,
      setShowControls,
      setShowTTS,
      syncTTSChunkOffset,
      ttsPlay,
      ttsSetCurrentBook,
      ttsSetCurrentLocation,
      ttsSetOnEnd,
    ],
  );

  // ─── Public handlers ──────────────────────────────────────────────────────
  const handleToggleTTS = useCallback(async () => {
    if (showTTS) {
      setShowTTS(false);
      return;
    }

    const hasActiveSession =
      ttsCurrentBookId === bookId &&
      (ttsPlayState !== "stopped" || !!(ttsCurrentText || ttsLastText).trim());
    const isPlaying = ttsPlayState === "playing" || ttsPlayState === "loading";
    const chapterChanged =
      ttsStartChapterRef.current !== "" && ttsStartChapterRef.current !== currentChapter;

    if (hasActiveSession && (isPlaying || !chapterChanged)) {
      setShowControls(false);
      setShowTTS(true);
      return;
    }

    ttsStartChapterRef.current = currentChapter;
    await startPageTTS(ttsContinuousEnabled);
  }, [
    currentChapter,
    bookId,
    setShowControls,
    setShowTTS,
    showTTS,
    startPageTTS,
    ttsContinuousEnabled,
    ttsCurrentBookId,
    ttsCurrentText,
    ttsLastText,
    ttsPlayState,
  ]);

  const handleTTSReplay = useCallback(async () => {
    if (ttsSourceKind === "selection") {
      const text = (ttsCurrentText || ttsLastText).trim();
      if (text) {
        startSelectionTTS(text);
      }
      return;
    }
    await startPageTTS(ttsContinuousEnabled);
  }, [
    startPageTTS,
    startSelectionTTS,
    ttsContinuousEnabled,
    ttsCurrentText,
    ttsLastText,
    ttsSourceKind,
  ]);

  const handleTTSPlayPause = useCallback(async () => {
    if (ttsPlayState === "loading" || ttsPlayState === "playing") {
      ttsPause();
      return;
    }
    if (ttsPlayState === "paused") {
      ttsResume();
      return;
    }

    if (ttsSourceKind === "selection") {
      const text = (ttsCurrentText || ttsLastText).trim();
      if (text) {
        startSelectionTTS(text);
      }
      return;
    }

    await startPageTTS(ttsContinuousEnabled);
  }, [
    startPageTTS,
    startSelectionTTS,
    ttsContinuousEnabled,
    ttsCurrentText,
    ttsLastText,
    ttsPause,
    ttsPlayState,
    ttsResume,
    ttsSourceKind,
  ]);

  const handleAdjustTTSRate = useCallback(
    (delta: number) => {
      const nextRate = Math.max(0.5, Math.min(2, Math.round((ttsConfig.rate + delta) * 10) / 10));
      ttsUpdateConfig({ rate: nextRate });
    },
    [ttsConfig.rate, ttsUpdateConfig],
  );

  const handleAdjustTTSPitch = useCallback(
    (delta: number) => {
      const nextPitch = Math.max(
        0.5,
        Math.min(2, Math.round((ttsConfig.pitch + delta) * 10) / 10),
      );
      ttsUpdateConfig({ pitch: nextPitch });
    },
    [ttsConfig.pitch, ttsUpdateConfig],
  );

  const handleUpdateTTSConfig = useCallback(
    (updates: Partial<TTSConfig>) => {
      const nextConfig = normalizeTTSConfig({ ...ttsConfig, ...updates });
      const hasActiveSession =
        ttsCurrentBookId === bookId &&
        (ttsPlayState === "playing" || ttsPlayState === "paused" || ttsPlayState === "loading");
      const restartSourceKind = ttsSourceKind;
      const restartSelectionText = (ttsCurrentText || ttsLastText).trim();
      const restartCfi =
        currentTTSSegment?.cfi || resolvedTTSSegmentCfi || ttsCurrentLocationCfi || currentCfi;
      const restartText =
        currentTTSSegment?.text || normalizeTTSDebugText(ttsCurrentSegmentText) || undefined;

      console.log("[ReaderScreen][TTS] update-config", {
        updates,
        currentEngine: ttsConfig.engine,
        nextEngine: nextConfig.engine,
        hasActiveSession,
        sourceKind: restartSourceKind,
        restartCfi,
      });

      ttsUpdateConfig(updates);

      if (!hasActiveSession) return;

      setTimeout(() => {
        if (restartSourceKind === "selection") {
          if (restartSelectionText) {
            startSelectionTTS(restartSelectionText, restartCfi || undefined);
          }
          return;
        }

        const restartFromCfi = startPageTTSFromCfiRef.current;
        if (restartFromCfi && restartCfi) {
          void restartFromCfi(restartCfi, restartText);
          return;
        }

        void startPageTTS(ttsContinuousEnabled);
      }, 0);
    },
    [
      bookId,
      currentCfi,
      currentTTSSegment?.cfi,
      currentTTSSegment?.text,
      resolvedTTSSegmentCfi,
      startPageTTS,
      startSelectionTTS,
      ttsConfig,
      ttsContinuousEnabled,
      ttsCurrentBookId,
      ttsCurrentLocationCfi,
      ttsCurrentSegmentText,
      ttsCurrentText,
      ttsLastText,
      ttsPlayState,
      ttsSourceKind,
      ttsUpdateConfig,
    ],
  );

  const handleToggleTTSContinuous = useCallback(() => {
    setTtsContinuousEnabled((prev) => {
      const next = !prev;
      const shouldContinue = next && ttsSourceKind === "page";
      ttsContinuousRef.current = shouldContinue;
      ttsSetOnEnd(shouldContinue ? handleTTSPageEnd : null);
      return next;
    });
  }, [handleTTSPageEnd, ttsSetOnEnd, ttsSourceKind]);

  const handleJumpToTTSSegment = useCallback(
    (offsetFromCurrent = 0) => {
      if (offsetFromCurrent < 0) {
        const prevIndex = ttsPrevPageSegments.length + offsetFromCurrent;
        const safeIdx = Math.max(0, prevIndex);
        const fromPrev = ttsPrevPageSegments.slice(safeIdx);
        const allSegments = [...fromPrev, ...ttsSegments];
        if (allSegments.length === 0) return;
        const newPrev = ttsPrevPageSegments.slice(0, safeIdx);
        const nextText = allSegments.map((segment) => segment.text).join(" ").trim();
        const nextCfi = allSegments[0]?.cfi || currentCfi;
        setTtsPrevPageSegments(newPrev);
        setTtsSegments(allSegments);
        setTtsLastText(nextText);
        ttsExhaustedAboveAnchorsRef.current.clear();
        ttsExhaustedBelowAnchorsRef.current.clear();
        ttsSegmentsRef.current = allSegments;
        ttsPrevPageSegmentsRef.current = newPrev;
        ttsLastTextRef.current = nextText;
        syncTTSChunkOffset(0);
        ttsSetCurrentLocation(nextCfi);
        if (nextCfi) bridgeRef.current?.goToCFI(nextCfi);
        setTimeout(() => ttsPlay(allSegments.map((s) => s.text)), 0);
      } else {
        const safeIdx = Math.max(0, Math.min(offsetFromCurrent, ttsSegments.length - 1));
        const sliced = ttsSegments.slice(safeIdx);
        if (sliced.length === 0) return;
        const newPrev = [...ttsPrevPageSegments, ...ttsSegments.slice(0, safeIdx)];
        const nextText = sliced.map((segment) => segment.text).join(" ").trim();
        const nextCfi = sliced[0]?.cfi || currentCfi;
        setTtsPrevPageSegments(newPrev);
        setTtsSegments(sliced);
        setTtsLastText(nextText);
        ttsExhaustedAboveAnchorsRef.current.clear();
        ttsExhaustedBelowAnchorsRef.current.clear();
        ttsSegmentsRef.current = sliced;
        ttsPrevPageSegmentsRef.current = newPrev;
        ttsLastTextRef.current = nextText;
        syncTTSChunkOffset(0);
        ttsSetCurrentLocation(nextCfi);
        if (nextCfi) bridgeRef.current?.goToCFI(nextCfi);
        setTimeout(() => ttsPlay(sliced.map((s) => s.text)), 0);
      }
    },
    [
      bridgeRef,
      currentCfi,
      syncTTSChunkOffset,
      ttsPlay,
      ttsPrevPageSegments,
      ttsSegments,
      ttsSetCurrentLocation,
    ],
  );

  const handleJumpToTTSLyricSegment = useCallback(
    (segment: { text: string; cfi?: string | null }, offsetFromCurrent: number) => {
      if (offsetFromCurrent >= 0 && offsetFromCurrent < ttsSegments.length) {
        ttsJumpToChunk(offsetFromCurrent);
        if (segment.cfi) {
          bridgeRef.current?.setTTSHighlight(segment.cfi, ttsHighlightColor);
        }
        return;
      }

      if (offsetFromCurrent < 0) {
        const prevIndex = ttsPrevPageSegments.length + offsetFromCurrent;
        const safeIdx = Math.max(0, prevIndex);
        const fromPrev = ttsPrevPageSegments.slice(safeIdx);
        const allSegments = [...fromPrev, ...ttsSegments, ...ttsFutureSegments];
        if (allSegments.length === 0) return;
        const newPrev = ttsPrevPageSegments.slice(0, safeIdx);
        const nextText = allSegments.map((s) => s.text).join(" ").trim();
        const nextCfi = allSegments[0]?.cfi || currentCfi;
        setTtsPrevPageSegments(newPrev);
        setTtsSegments(allSegments);
        setTtsFutureSegments([]);
        setTtsLastText(nextText);
        ttsLyricPrimeRequestIdRef.current += 1;
        ttsSegmentsRef.current = allSegments;
        ttsPrevPageSegmentsRef.current = newPrev;
        ttsLastTextRef.current = nextText;
        ttsFutureSegmentsRef.current = [];
        syncTTSChunkOffset(0);
        ttsSetCurrentLocation(nextCfi);
        if (nextCfi) bridgeRef.current?.goToCFI(nextCfi);
        ttsPlay(allSegments.map((s) => s.text));
        return;
      }

      const futureOffset = offsetFromCurrent - ttsSegments.length;
      if (futureOffset >= 0 && futureOffset < ttsFutureSegments.length) {
        const consumedCurrent = ttsSegments;
        const skippedFuture = ttsFutureSegments.slice(0, futureOffset);
        const remainingFuture = ttsFutureSegments.slice(futureOffset);
        const newPrev = [...ttsPrevPageSegments, ...consumedCurrent, ...skippedFuture];
        const nextText = remainingFuture.map((s) => s.text).join(" ").trim();
        const nextCfi = remainingFuture[0]?.cfi || currentCfi;
        setTtsPrevPageSegments(newPrev);
        setTtsSegments(remainingFuture);
        setTtsFutureSegments([]);
        setTtsLastText(nextText);
        ttsExhaustedAboveAnchorsRef.current.clear();
        ttsExhaustedBelowAnchorsRef.current.clear();
        ttsLyricPrimeRequestIdRef.current += 1;
        ttsSegmentsRef.current = remainingFuture;
        ttsPrevPageSegmentsRef.current = newPrev;
        ttsLastTextRef.current = nextText;
        ttsFutureSegmentsRef.current = [];
        syncTTSChunkOffset(0);
        ttsSetCurrentLocation(nextCfi);
        if (nextCfi) bridgeRef.current?.goToCFI(nextCfi);
        ttsPlay(remainingFuture.map((s) => s.text));
        void primeTTSLyricContext(
          remainingFuture[0]?.cfi || nextCfi,
          remainingFuture[0]?.cfi || nextCfi,
          remainingFuture[remainingFuture.length - 1]?.cfi || nextCfi,
        );
        return;
      }

      if (segment.cfi) {
        void startPageTTSFromCfi(segment.cfi, segment.text);
      }
    },
    [
      bridgeRef,
      currentCfi,
      primeTTSLyricContext,
      startPageTTSFromCfi,
      syncTTSChunkOffset,
      ttsHighlightColor,
      ttsJumpToChunk,
      ttsPlay,
      ttsPrevPageSegments,
      ttsSegments,
      ttsFutureSegments,
      ttsSetCurrentLocation,
    ],
  );

  const handleLoadMoreAboveTTSLyrics = useCallback(async () => {
    const anchorCfi = ttsPrevPageSegments[0]?.cfi || ttsSegments[0]?.cfi || null;
    if (
      !anchorCfi ||
      ttsLoadMoreAboveRef.current === anchorCfi ||
      ttsExhaustedAboveAnchorsRef.current.has(anchorCfi)
    ) {
      return;
    }
    ttsLoadMoreAboveRef.current = anchorCfi;
    try {
      const context = await getCachedTTSSegmentContext(anchorCfi, TTS_CONTEXT_WINDOW, 0);
      if (context.before?.length) {
        const incoming = filterDistinctTTSSegments(
          context.before,
          ttsPrevPageSegments,
          ttsSegments,
        );
        if (incoming.length > 0) {
          ttsExhaustedAboveAnchorsRef.current.delete(anchorCfi);
          setTtsPrevPageSegments((prev) => {
            const next = mergeUniqueTTSSegments(prev, incoming, "prepend");
            ttsPrevPageSegmentsRef.current = next;
            return next;
          });
        } else {
          ttsExhaustedAboveAnchorsRef.current.add(anchorCfi);
        }
      } else {
        ttsExhaustedAboveAnchorsRef.current.add(anchorCfi);
      }
    } finally {
      ttsLoadMoreAboveRef.current = null;
    }
  }, [
    filterDistinctTTSSegments,
    getCachedTTSSegmentContext,
    mergeUniqueTTSSegments,
    ttsPrevPageSegments,
    ttsSegments,
  ]);

  const handleLoadMoreBelowTTSLyrics = useCallback(async () => {
    const anchorCfi =
      ttsFutureSegments[ttsFutureSegments.length - 1]?.cfi ||
      ttsSegments[ttsSegments.length - 1]?.cfi ||
      null;
    if (
      !anchorCfi ||
      ttsLoadMoreBelowRef.current === anchorCfi ||
      ttsExhaustedBelowAnchorsRef.current.has(anchorCfi)
    ) {
      return;
    }
    ttsLoadMoreBelowRef.current = anchorCfi;
    try {
      const context = await getCachedTTSSegmentContext(anchorCfi, 0, TTS_CONTEXT_WINDOW);
      if (context.after?.length) {
        const incoming = filterDistinctTTSSegments(
          context.after,
          ttsPrevPageSegments,
          ttsSegments,
          ttsFutureSegments,
        );
        if (incoming.length > 0) {
          ttsExhaustedBelowAnchorsRef.current.delete(anchorCfi);
          setTtsFutureSegments((prev) => {
            const next = mergeUniqueTTSSegments(prev, incoming, "append");
            ttsFutureSegmentsRef.current = next;
            return next;
          });
        } else {
          ttsExhaustedBelowAnchorsRef.current.add(anchorCfi);
        }
      } else {
        ttsExhaustedBelowAnchorsRef.current.add(anchorCfi);
      }
    } finally {
      ttsLoadMoreBelowRef.current = null;
    }
  }, [
    filterDistinctTTSSegments,
    getCachedTTSSegmentContext,
    mergeUniqueTTSSegments,
    ttsFutureSegments,
    ttsPrevPageSegments,
    ttsSegments,
  ]);

  const handleTTSPrevChapter = useCallback(() => {
    const idx = toc.findIndex((item) => item.title === currentChapter);
    const prevIdx = idx > 0 ? idx - 1 : 0;
    const prevHref = toc[prevIdx]?.href;
    if (prevHref) goToHref(prevHref);
  }, [currentChapter, goToHref, toc]);

  const handleTTSNextChapter = useCallback(() => {
    const idx = toc.findIndex((item) => item.title === currentChapter);
    const nextIdx = idx >= 0 && idx < toc.length - 1 ? idx + 1 : toc.length - 1;
    const nextHref = toc[nextIdx]?.href;
    if (nextHref) goToHref(nextHref);
  }, [currentChapter, goToHref, toc]);

  const handleTTSStop = useCallback(() => {
    ttsContinuousRef.current = false;
    ttsSetOnEnd(null);
    bridgeRef.current?.setTTSHighlight(null);
    lastFollowedTTSCfiRef.current = null;
    setTtsSegments([]);
    ttsSegmentsRef.current = [];
    setTtsPrevPageSegments([]);
    setTtsFutureSegments([]);
    ttsPrevPageSegmentsRef.current = [];
    ttsExhaustedAboveAnchorsRef.current.clear();
    ttsExhaustedBelowAnchorsRef.current.clear();
    ttsLyricPrimeRequestIdRef.current += 1;
    ttsFutureSegmentsRef.current = [];
    syncTTSChunkOffset(0);
    setTtsLastText("");
    ttsLastTextRef.current = "";
    ttsStop();
  }, [bridgeRef, syncTTSChunkOffset, ttsSetOnEnd, ttsStop]);

  const handleTTSReturnToReading = useCallback(() => {
    const targetCfi = resolvedTTSSegmentCfi || ttsCurrentLocationCfi || currentCfi;
    setShowTTS(false);
    if (!targetCfi) return;
    lastFollowedTTSCfiRef.current = targetCfi;
    bridgeRef.current?.goToCFI(targetCfi);
    bridgeRef.current?.flashHighlight(targetCfi, colors.primary, 1200);
    setTimeout(() => {
      bridgeRef.current?.setTTSHighlight(targetCfi, ttsHighlightColor, true);
    }, 120);
  }, [
    bridgeRef,
    colors.primary,
    currentCfi,
    resolvedTTSSegmentCfi,
    setShowTTS,
    ttsCurrentLocationCfi,
    ttsHighlightColor,
  ]);

  // ─── TTS event bus listeners ───────────────────────────────────────────────
  useEffect(() => {
    return eventBus.on(
      "tts:jump-to-current",
      ({ bookId: targetBookId, cfi: targetCfi, respond }) => {
        if (targetBookId !== bookId || !targetCfi) return;
        setShowTTS(false);
        bridgeRef.current?.goToCFI(targetCfi);
        bridgeRef.current?.flashHighlight(targetCfi, colors.primary, 1200);
        respond?.();
      },
    );
  }, [bookId, bridgeRef, colors.primary, setShowTTS]);

  useEffect(() => {
    return eventBus.on("tts:open-lyrics-page", ({ bookId: targetBookId, respond }) => {
      if (targetBookId !== bookId) return;
      setShowTTS(true);
      respond?.();
    });
  }, [bookId, setShowTTS]);

  // ─── TTS highlight sync effects ───────────────────────────────────────────
  useEffect(() => {
    if (!webViewReady) return;
    if (ttsCurrentBookId !== bookId) {
      bridgeRef.current?.setTTSHighlight(null);
      return;
    }
    if (showTTS) {
      bridgeRef.current?.setTTSHighlight(null);
      return;
    }
    if (ttsPlayState !== "playing" && ttsPlayState !== "paused" && ttsPlayState !== "loading") {
      bridgeRef.current?.setTTSHighlight(null);
      return;
    }
    if (ttsSourceKind !== "page") {
      bridgeRef.current?.setTTSHighlight(null);
      return;
    }
    const targetCfi = resolvedTTSSegmentCfi;
    if (!targetCfi) {
      bridgeRef.current?.setTTSHighlight(null);
      return;
    }
    bridgeRef.current?.setTTSHighlight(targetCfi, ttsHighlightColor);
  }, [
    bridgeRef,
    currentCfi,
    resolvedTTSSegmentCfi,
    showTTS,
    ttsHighlightColor,
    ttsCurrentBookId,
    ttsPlayState,
    ttsSourceKind,
    webViewReady,
    bookId,
  ]);

  useEffect(() => {
    if (!webViewReady) {
      didForceReapplyTTSHighlightRef.current = false;
      return;
    }
    if (ttsCurrentBookId !== bookId) {
      didForceReapplyTTSHighlightRef.current = false;
      return;
    }
    if (showTTS) {
      didForceReapplyTTSHighlightRef.current = false;
      return;
    }
    if (didForceReapplyTTSHighlightRef.current) return;
    if (ttsSourceKind !== "page") return;
    if (ttsPlayState !== "playing" && ttsPlayState !== "paused" && ttsPlayState !== "loading")
      return;
    const targetCfi = resolvedTTSSegmentCfi;
    if (!targetCfi) return;
    bridgeRef.current?.setTTSHighlight(targetCfi, ttsHighlightColor, true);
    didForceReapplyTTSHighlightRef.current = true;
  }, [
    bridgeRef,
    currentCfi,
    resolvedTTSSegmentCfi,
    showTTS,
    ttsHighlightColor,
    ttsCurrentBookId,
    ttsPlayState,
    ttsSourceKind,
    webViewReady,
    bookId,
  ]);

  useEffect(() => {
    if (!webViewReady || showTTS) return;
    if (ttsCurrentBookId !== bookId) return;
    if (ttsSourceKind !== "page") return;
    if (ttsPlayState !== "playing" && ttsPlayState !== "paused" && ttsPlayState !== "loading")
      return;
    const targetCfi = resolvedTTSSegmentCfi || currentCfi || null;
    if (!targetCfi) return;
    const timer = setTimeout(() => {
      bridgeRef.current?.setTTSHighlight(targetCfi, ttsHighlightColor, true);
    }, 180);
    return () => clearTimeout(timer);
  }, [
    bridgeRef,
    currentCfi,
    resolvedTTSSegmentCfi,
    showTTS,
    ttsHighlightColor,
    ttsCurrentBookId,
    ttsPlayState,
    ttsSourceKind,
    webViewReady,
    bookId,
  ]);

  useEffect(() => {
    if (!webViewReady) {
      lastFollowedTTSCfiRef.current = null;
      return;
    }
    if (ttsCurrentBookId !== bookId) {
      lastFollowedTTSCfiRef.current = null;
      return;
    }
    if (showTTS || ttsSourceKind !== "page") {
      lastFollowedTTSCfiRef.current = null;
      return;
    }
    if (ttsPlayState !== "playing" && ttsPlayState !== "loading") {
      lastFollowedTTSCfiRef.current = null;
      return;
    }
    const targetCfi = resolvedTTSSegmentCfi;
    if (!targetCfi || lastFollowedTTSCfiRef.current === targetCfi) return;
    lastFollowedTTSCfiRef.current = targetCfi;
    bridgeRef.current?.goToCFI(targetCfi);
  }, [
    bridgeRef,
    resolvedTTSSegmentCfi,
    showTTS,
    ttsCurrentBookId,
    ttsPlayState,
    ttsSourceKind,
    webViewReady,
    bookId,
  ]);

  useEffect(() => {
    if (ttsCurrentBookId !== bookId) return;
    if (ttsSourceKind === "page") {
      const spokenCfi = resolvedTTSSegmentCfi;
      if (__DEV__ && spokenCfi && spokenCfi !== ttsCurrentLocationCfi) {
        console.log("[ReaderScreen][TTS] update-current-location", {
          currentChunkIndex: ttsCurrentChunkIndex,
          ttsChunkOffset,
          localTTSChunkIndex,
          spokenCfi,
          previousLocationCfi: ttsCurrentLocationCfi,
          ttsSegmentsLength: ttsSegments.length,
        });
      }
      if (spokenCfi && spokenCfi !== ttsCurrentLocationCfi) {
        ttsSetCurrentLocation(spokenCfi);
      }
      return;
    }

    if (currentCfi && currentCfi !== ttsCurrentLocationCfi) {
      ttsSetCurrentLocation(currentCfi);
    }
  }, [
    bookId,
    currentCfi,
    localTTSChunkIndex,
    resolvedTTSSegmentCfi,
    ttsChunkOffset,
    ttsCurrentBookId,
    ttsCurrentChunkIndex,
    ttsCurrentLocationCfi,
    ttsPlayState,
    ttsSegments.length,
    ttsSetCurrentLocation,
    ttsSourceKind,
  ]);

  // ─── DEV-only debug effects ───────────────────────────────────────────────
  useEffect(() => {
    if (!__DEV__) return;
    if (ttsSourceKind !== "page") return;
    if (ttsPlayState === "stopped") return;
    console.log("[ReaderScreen][TTS] segment-resolution", {
      currentChunkIndex: ttsCurrentChunkIndex,
      ttsChunkOffset,
      localTTSChunkIndex,
      resolvedTTSSegmentCfi,
      currentSegmentText: normalizeTTSDebugText(currentTTSSegment?.text),
      storeSegmentText: normalizeTTSDebugText(ttsCurrentSegmentText),
      currentLocationCfi: ttsCurrentLocationCfi,
      ttsSegmentsLength: ttsSegments.length,
      prevSegmentsLength: ttsPrevPageSegments.length,
      futureSegmentsLength: ttsFutureSegments.length,
    });
  }, [
    currentTTSSegment?.text,
    localTTSChunkIndex,
    resolvedTTSSegmentCfi,
    ttsChunkOffset,
    ttsCurrentChunkIndex,
    ttsCurrentLocationCfi,
    ttsCurrentSegmentText,
    ttsFutureSegments.length,
    ttsPlayState,
    ttsPrevPageSegments.length,
    ttsSegments.length,
    ttsSourceKind,
  ]);

  useEffect(() => {
    if (!__DEV__) return;
    if (ttsSourceKind !== "page") return;
    if (ttsPlayState === "stopped") return;
    if (ttsSegments.length === 0) return;
    if (localTTSChunkIndex >= 0 && localTTSChunkIndex < ttsSegments.length) return;
    console.log("[ReaderScreen][TTS] chunk-out-of-range", {
      currentChunkIndex: ttsCurrentChunkIndex,
      ttsChunkOffset,
      localTTSChunkIndex,
      ttsSegmentsLength: ttsSegments.length,
      ttsFutureSegmentsLength: ttsFutureSegments.length,
      currentLocationCfi: ttsCurrentLocationCfi,
      currentSegmentTextLength: (ttsCurrentSegmentText || "").length,
    });
  }, [
    localTTSChunkIndex,
    ttsChunkOffset,
    ttsCurrentChunkIndex,
    ttsCurrentLocationCfi,
    ttsCurrentSegmentText,
    ttsFutureSegments.length,
    ttsPlayState,
    ttsSegments.length,
    ttsSourceKind,
  ]);

  // ─── Continuous reading effects ───────────────────────────────────────────
  useEffect(() => {
    const shouldContinue =
      ttsCurrentBookId === bookId &&
      ttsSourceKind === "page" &&
      ttsContinuousEnabled &&
      (ttsPlayState === "playing" || ttsPlayState === "paused" || ttsPlayState === "loading");
    ttsContinuousRef.current = shouldContinue;
    ttsSetOnEnd(shouldContinue ? handleTTSPageEnd : null);
  }, [
    bookId,
    handleTTSPageEnd,
    ttsContinuousEnabled,
    ttsCurrentBookId,
    ttsPlayState,
    ttsSetOnEnd,
    ttsSourceKind,
  ]);

  useEffect(() => {
    const naturalStopSignature =
      ttsSourceKind === "page" &&
      ttsContinuousRef.current &&
      ttsPlayState === "stopped" &&
      ttsTotalChunks > 0 &&
      ttsCurrentChunkIndex >= Math.max(0, ttsTotalChunks - 1)
        ? `${ttsCurrentChunkIndex}:${resolvedTTSSegmentCfi || ""}:${ttsTotalChunks}`
        : null;

    if (!naturalStopSignature) {
      ttsLastStopHandledSignatureRef.current = null;
      return;
    }
    if (ttsLastStopHandledSignatureRef.current === naturalStopSignature) {
      return;
    }
    ttsLastStopHandledSignatureRef.current = naturalStopSignature;
    console.log("[ReaderScreen][TTS] natural-stop-fallback", {
      signature: naturalStopSignature,
      currentChunkIndex: ttsCurrentChunkIndex,
      totalChunks: ttsTotalChunks,
      resolvedTTSSegmentCfi,
      currentLocationCfi: ttsCurrentLocationCfi,
    });
    handleTTSPageEnd();
  }, [
    handleTTSPageEnd,
    resolvedTTSSegmentCfi,
    ttsCurrentChunkIndex,
    ttsCurrentLocationCfi,
    ttsPlayState,
    ttsSourceKind,
    ttsTotalChunks,
  ]);

  // ─── Lyric recovery effects ───────────────────────────────────────────────
  useEffect(() => {
    if (!showTTS) {
      ttsRecoveringLyricsRef.current = null;
      return;
    }
    if (ttsCurrentBookId !== bookId) return;
    if (ttsSourceKind !== "page") return;
    if (ttsPlayState === "stopped") return;
    if (ttsSegments.length > 0 || ttsPrevPageSegments.length > 0 || ttsFutureSegments.length > 0) {
      return;
    }
    void recoverTTSLyricsState();
  }, [
    bookId,
    recoverTTSLyricsState,
    showTTS,
    ttsCurrentBookId,
    ttsFutureSegments.length,
    ttsPlayState,
    ttsPrevPageSegments.length,
    ttsSegments.length,
    ttsSourceKind,
  ]);

  useEffect(() => {
    if (!webViewReady) return;
    if (ttsCurrentBookId !== bookId) return;
    if (ttsSourceKind !== "page") return;
    if (ttsPlayState === "stopped") return;

    const hasAnySegments =
      ttsSegments.length > 0 || ttsPrevPageSegments.length > 0 || ttsFutureSegments.length > 0;
    const needsRecovery =
      !hasAnySegments ||
      (!currentTTSSegment &&
        (normalizeTTSDebugText(ttsCurrentSegmentText).length > 0 ||
          normalizeTTSDebugText(ttsCurrentLocationCfi).length > 0));

    if (!needsRecovery) return;

    if (__DEV__) {
      console.log("[ReaderScreen][TTS] recover-state-needed", {
        showTTS,
        playState: ttsPlayState,
        currentChunkIndex: ttsCurrentChunkIndex,
        hasAnySegments,
        currentSegmentResolved: !!currentTTSSegment,
        storeSegmentTextLength: normalizeTTSDebugText(ttsCurrentSegmentText).length,
        currentLocationCfi: ttsCurrentLocationCfi,
        ttsSegmentsLength: ttsSegments.length,
        prevSegmentsLength: ttsPrevPageSegments.length,
        futureSegmentsLength: ttsFutureSegments.length,
      });
    }

    void recoverTTSLyricsState();
  }, [
    bookId,
    currentTTSSegment,
    recoverTTSLyricsState,
    showTTS,
    ttsCurrentBookId,
    ttsCurrentChunkIndex,
    ttsCurrentLocationCfi,
    ttsCurrentSegmentText,
    ttsFutureSegments.length,
    ttsPlayState,
    ttsPrevPageSegments.length,
    ttsSegments.length,
    ttsSourceKind,
    webViewReady,
  ]);

  useEffect(() => {
    if (!showTTS) {
      lastTTSLyricPrimeSignatureRef.current = null;
      return;
    }
    if (ttsCurrentBookId !== bookId) return;
    const activeCfi =
      currentTTSSegment?.cfi || resolvedTTSSegmentCfi || ttsSegments[0]?.cfi || null;
    if (!activeCfi) return;
    const firstVisibleCfi = ttsSegments[0]?.cfi || activeCfi;
    const lastVisibleCfi = ttsSegments[ttsSegments.length - 1]?.cfi || activeCfi;
    const signature = `${activeCfi}|${firstVisibleCfi}|${lastVisibleCfi}`;
    if (lastTTSLyricPrimeSignatureRef.current === signature) return;
    lastTTSLyricPrimeSignatureRef.current = signature;
    void primeTTSLyricContext(activeCfi, firstVisibleCfi, lastVisibleCfi);
  }, [
    currentTTSSegment?.cfi,
    bookId,
    primeTTSLyricContext,
    resolvedTTSSegmentCfi,
    showTTS,
    ttsCurrentBookId,
    ttsSegments,
  ]);

  // ─── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      ttsContinuousRef.current = false;
      ttsSetOnEnd(null);
      bridgeRef.current?.setTTSHighlight(null);
    };
  }, [bridgeRef, ttsSetOnEnd]);

  return {
    // State
    ttsCoverUri,
    ttsLastText,
    ttsSegments,
    ttsPrevPageSegments,
    ttsFutureSegments,
    ttsChunkOffset,
    ttsSourceKind,
    ttsContinuousEnabled,
    ttsSourceLabel,

    // Derived
    allLyricSegments,
    ttsDisplaySegments,
    currentTTSSegment,
    resolvedTTSSegmentCfi,
    ttsHighlightColor,
    localTTSChunkIndex,

    // Handlers
    handleToggleTTS,
    handleTTSReplay,
    handleTTSPlayPause,
    handleAdjustTTSRate,
    handleAdjustTTSPitch,
    handleUpdateTTSConfig,
    handleToggleTTSContinuous,
    handleJumpToTTSSegment,
    handleJumpToTTSLyricSegment,
    handleLoadMoreAboveTTSLyrics,
    handleLoadMoreBelowTTSLyrics,
    handleTTSPrevChapter,
    handleTTSNextChapter,
    startSelectionTTS,
    handleTTSStop,
    handleTTSReturnToReading,
    pendingTTSContinueCallbackRef,
    pendingTTSContinueSafetyTimerRef,
  };
}
