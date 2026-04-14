import { evictBlobCache } from "@/components/reader/ReaderView";
/**
 * TabBar — draggable tab bar (sageread style: compact h-8, Home icon pinned left, drag region)
 * No react-router navigation — tab switching is purely state-driven.
 */
import { type Tab, useAppStore } from "@/stores/app-store";
import { useLibraryStore } from "@/stores/library-store";
import { useReaderStore } from "@/stores/reader-store";
import { BookOpen, Home, MessageSquare, NotebookPen, X } from "lucide-react";
import { useEffect, useState } from "react";

function useIsWindows() {
  const [isWin, setIsWin] = useState(false);
  useEffect(() => {
    setIsWin(!navigator.userAgent.toLowerCase().includes("mac") && "__TAURI_INTERNALS__" in window);
  }, []);
  return isWin;
}

function WindowControls() {
  const isWin = useIsWindows();
  if (!isWin) return null;

  const handleMinimize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  };
  const handleMaximize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.isMaximized().then((m) => m ? win.unmaximize() : win.maximize());
  };
  const handleClose = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  };

  return (
    <div className="flex h-full shrink-0 items-center gap-0" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <button
        type="button"
        className="flex h-full w-11 items-center justify-center text-neutral-500 transition-colors hover:bg-neutral-200/60"
        onClick={handleMinimize}
      >
        <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor"><rect width="10" height="1"/></svg>
      </button>
      <button
        type="button"
        className="flex h-full w-11 items-center justify-center text-neutral-500 transition-colors hover:bg-neutral-200/60"
        onClick={handleMaximize}
      >
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="0.6" y="0.6" width="7.8" height="7.8"/></svg>
      </button>
      <button
        type="button"
        className="flex h-full w-11 items-center justify-center text-neutral-500 transition-colors hover:bg-red-500 hover:text-white"
        onClick={handleClose}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

const TAB_ICONS: Record<string, React.ElementType> = {
  home: Home,
  reader: BookOpen,
  chat: MessageSquare,
  notes: NotebookPen,
};

function useTrafficLightPadding() {
  const [padding, setPadding] = useState(68);

  useEffect(() => {
    const checkFullscreen = async () => {
      const isMac = navigator.userAgent.toLowerCase().includes("mac");
      if (!isMac) {
        setPadding(8);
        return;
      }

      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const fullscreen = await win.isFullscreen();
        setPadding(fullscreen ? 8 : 68);

        const unlisten = await win.onResized(async () => {
          const fs = await win.isFullscreen();
          setPadding(fs ? 8 : 68);
        });

        return unlisten;
      } catch {
        setPadding(68);
      }
    };

    checkFullscreen();
  }, []);

  return padding;
}

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, removeTab } = useAppStore();
  const removeReaderTab = useReaderStore((s) => s.removeTab);
  const books = useLibraryStore((s) => s.books);
  const trafficLightPadding = useTrafficLightPadding();

  const readerTabs = tabs.filter((t) => t.type !== "home");

  const handleTabClose = (tabId: string) => {
    // Evict blob cache for this book before removing tab
    const closingTab = tabs.find((t) => t.id === tabId);
    if (closingTab?.bookId) {
      const book = books.find((b) => b.id === closingTab.bookId);
      if (book?.filePath) {
        evictBlobCache(book.filePath);
      }
    }

    removeTab(tabId);
    removeReaderTab(tabId);

    // After removing, check if all non-home tabs are gone
    const remainingNonHome = tabs.filter((t) => t.type !== "home" && t.id !== tabId);
    if (remainingNonHome.length === 0) {
      setActiveTab("home");
    }
    // If closed tab was active, app-store.removeTab already sets activeTabId to last tab
  };

  return (
    <div
      className="flex h-8 shrink-0 select-none items-center border-neutral-200 bg-muted"
      data-tauri-drag-region
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* macOS traffic light spacing + Home icon */}
      <div className="flex h-full shrink-0 items-center" style={{ paddingLeft: trafficLightPadding }}>
        <button
          type="button"
          className="flex items-center justify-center rounded-md p-1 text-neutral-500 transition-colors hover:bg-neutral-200/60 hover:text-neutral-800"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onClick={() => setActiveTab("home")}
        >
          <Home className="h-[18px] w-[18px]" />
        </button>
      </div>

      {/* Tabs */}
      <div
        className="flex h-full flex-1 items-center gap-0.5 overflow-x-auto px-1"
        data-tauri-drag-region
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        {readerTabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onActivate={() => setActiveTab(tab.id)}
            onClose={() => handleTabClose(tab.id)}
          />
        ))}
      </div>

      {/* Windows window controls */}
      <WindowControls />
    </div>
  );
}

function TabItem({
  tab,
  isActive,
  onActivate,
  onClose,
}: {
  tab: Tab;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  const Icon = TAB_ICONS[tab.type] ?? BookOpen;

  return (
    <div
      className={`group flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs transition-all ${
        isActive
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      onClick={onActivate}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="max-w-[120px] truncate">{tab.title}</span>
      <button
        type="button"
        className="ml-0.5 hidden h-4 w-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-neutral-200/80 hover:text-foreground group-hover:flex"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
