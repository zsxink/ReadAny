/**
 * FloatingTTSBubble — Global floating mini-player shown when TTS is active on desktop.
 *
 * Rendered as a sibling to the main layout in App.tsx so it floats above every screen.
 * Tapping it expands a compact player popover.
 *
 * Design:
 * - Bubble always shows headphones icon
 * - Pulsing ring animation when playing; no animation when paused
 * - Tap bubble → toggle mini player popover
 * - Mini player: book title, chapter, play/pause, rate control, stop, go-to-reader
 * - Draggable via CSS user-select:none + mouse events
 */
import { useTTSStore } from "@/stores/tts-store";
import { useAppStore } from "@/stores/app-store";
import { useLibraryStore } from "@/stores/library-store";
import { Headphones, Pause, Play, Square, BookOpen, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

// ─── Main floating bubble ─────────────────────────────────────────────────────

export function FloatingTTSBubble() {
  const playState = useTTSStore((s) => s.playState);
  const currentBookTitle = useTTSStore((s) => s.currentBookTitle);
  const currentChapterTitle = useTTSStore((s) => s.currentChapterTitle);
  const currentBookId = useTTSStore((s) => s.currentBookId);
  const config = useTTSStore((s) => s.config);
  const pause = useTTSStore((s) => s.pause);
  const resume = useTTSStore((s) => s.resume);
  const stop = useTTSStore((s) => s.stop);
  const updateConfig = useTTSStore((s) => s.updateConfig);

  const tabs = useAppStore((s) => s.tabs);
  const addTab = useAppStore((s) => s.addTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const books = useLibraryStore((s) => s.books);

  const isActive = playState === "playing" || playState === "paused" || playState === "loading";
  const [showPlayer, setShowPlayer] = useState(false);

  // Close mini player when TTS stops
  useEffect(() => {
    if (!isActive) setShowPlayer(false);
  }, [isActive]);

  // Draggable position
  const [pos, setPos] = useState({ x: 20, y: 120 }); // bottom-right origin
  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; initX: number; initY: number }>({
    dragging: false,
    startX: 0,
    startY: 0,
    initX: 0,
    initY: 0,
  });
  const hasDraggedRef = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    hasDraggedRef.current = false;
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      initX: pos.x,
      initY: pos.y,
    };

    const onMove = (me: MouseEvent) => {
      if (!dragRef.current.dragging) return;
      const dx = me.clientX - dragRef.current.startX;
      const dy = me.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasDraggedRef.current = true;
      setPos({
        x: dragRef.current.initX - dx, // right-anchored
        y: dragRef.current.initY - dy, // bottom-anchored
      });
    };

    const onUp = () => {
      dragRef.current.dragging = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [pos]);

  const handleBubbleClick = useCallback(() => {
    if (!hasDraggedRef.current) {
      setShowPlayer((v) => !v);
    }
  }, []);

  const handlePlayPause = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (playState === "playing") pause();
      else if (playState === "paused") resume();
    },
    [playState, pause, resume],
  );

  const handleStop = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      stop();
      setShowPlayer(false);
    },
    [stop],
  );

  const handleGoToReader = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!currentBookId) return;
      const existingTab = tabs.find((t) => t.type === "reader" && t.bookId === currentBookId);
      if (existingTab) {
        setActiveTab(existingTab.id);
      } else {
        const book = books.find((b) => b.id === currentBookId);
        addTab({
          id: `reader-${currentBookId}`,
          type: "reader",
          title: book?.meta.title ?? "Book",
          bookId: currentBookId,
        });
      }
      setShowPlayer(false);
    },
    [currentBookId, tabs, addTab, setActiveTab, books],
  );

  const adjustRate = useCallback(
    (e: React.MouseEvent, delta: number) => {
      e.stopPropagation();
      const newRate = Math.round(Math.max(0.5, Math.min(2.0, config.rate + delta)) * 10) / 10;
      updateConfig({ rate: newRate });
    },
    [config.rate, updateConfig],
  );

  const statusText =
    playState === "loading"
      ? "加载中…"
      : playState === "playing"
        ? "播放中"
        : playState === "paused"
          ? "已暂停"
          : "已停止";

  if (!isActive) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[9999]"
      aria-hidden="true"
    >
      {/* ── Bubble ── */}
      <div
        className="pointer-events-auto absolute"
        style={{ right: pos.x, bottom: pos.y }}
        onMouseDown={handleMouseDown}
      >
        {/* Ripple rings — playing only */}
        {playState === "playing" && (
          <>
            <span className="bubble-ring absolute inset-0 rounded-full bg-primary opacity-0 animate-bubble-ring" />
            <span className="bubble-ring-2 absolute inset-0 rounded-full bg-primary opacity-0 animate-bubble-ring-2" />
          </>
        )}

        {/* Main button */}
        <button
          type="button"
          onClick={handleBubbleClick}
          className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform active:scale-95 select-none"
          title="TTS 播放器"
        >
          {playState === "loading" ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <Headphones className="h-6 w-6" />
          )}
        </button>

        {/* ── Mini player popover ── */}
        {showPlayer && (
          <div
            className="pointer-events-auto absolute bottom-16 right-0 w-72 overflow-hidden rounded-2xl border bg-card shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-2.5 px-4 py-3.5">
              <Headphones className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {currentBookTitle || "正在听书"}
                </p>
                {!!currentChapterTitle && (
                  <p className="truncate text-xs text-muted-foreground">{currentChapterTitle}</p>
                )}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{statusText}</span>
            </div>

            {/* Divider */}
            <div className="mx-4 border-t" />

            {/* Controls */}
            <div className="flex items-center gap-2 px-4 py-3">
              {/* Rate − */}
              <button
                type="button"
                onClick={(e) => adjustRate(e, -0.1)}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-foreground transition-colors hover:bg-muted/80 text-lg font-medium leading-none"
              >
                −
              </button>
              <span className="w-9 text-center text-xs tabular-nums text-muted-foreground">
                {config.rate.toFixed(1)}x
              </span>
              {/* Rate + */}
              <button
                type="button"
                onClick={(e) => adjustRate(e, 0.1)}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-foreground transition-colors hover:bg-muted/80 text-lg font-medium leading-none"
              >
                +
              </button>

              <div className="mx-1 h-6 w-px bg-border" />

              {/* Play / Pause */}
              <button
                type="button"
                onClick={handlePlayPause}
                disabled={playState === "loading" || playState === "stopped"}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {playState === "loading" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : playState === "playing" ? (
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5" />
                )}
              </button>

              {/* Stop */}
              <button
                type="button"
                onClick={handleStop}
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-foreground transition-colors hover:bg-muted/80"
                title="停止"
              >
                <Square className="h-4 w-4" />
              </button>

              {/* Go to reader */}
              {!!currentBookId && (
                <>
                  <div className="mx-1 h-6 w-px bg-border" />
                  <button
                    type="button"
                    onClick={handleGoToReader}
                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-foreground transition-colors hover:bg-muted/80"
                    title="跳回阅读器"
                  >
                    <BookOpen className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes bubbleRing {
          0% { transform: scale(1); opacity: 0.35; }
          100% { transform: scale(2); opacity: 0; }
        }
        .animate-bubble-ring {
          animation: bubbleRing 1.6s ease-out infinite;
        }
        .animate-bubble-ring-2 {
          animation: bubbleRing 1.6s ease-out 0.7s infinite;
        }
      `}</style>
    </div>
  );
}
