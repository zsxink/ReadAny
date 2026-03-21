/**
 * AppLayout — SageRead-style three-column tab-driven layout.
 *
 * Structure: TabBar (top) → Sidebar (left, home pages only) → Content (right).
 *
 * Key design: ALL opened reader tabs stay mounted in the DOM simultaneously.
 * Non-active tabs are hidden via `display:none` so renderers are never destroyed
 * on tab switch. Only closing a tab truly unmounts the ReaderView.
 *
 * Idle Tab Reclaim: Reader tabs inactive for IDLE_TIMEOUT_MS are "hibernated" —
 * their <ReaderView> is unmounted to release renderer / canvas memory.
 * When the user switches back to a hibernated tab, it is re-mounted and the
 * reader restores to the previously recorded CFI position automatically.
 *
 * Home-type pages (home/chat/notes/skills/stats) share the left sidebar.
 * Reader pages are full-width (no sidebar).
 */
import { ChatPage as ChatPageComponent } from "@/components/chat/ChatPage";
import { CommandPalette } from "@/components/command-palette/CommandPalette";
import { HomePage } from "@/components/home/HomePage";
import { NotesPage } from "@/components/notes/NotesPage";
import { OnboardingModal } from "@/components/onboarding/OnboardingModal";
import { ReaderView, evictBlobCache } from "@/components/reader/ReaderView";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { ReadingStatsPanel } from "@/components/stats/ReadingStatsPanel";
import SkillsPage from "@/pages/Skills";
import { useAppStore } from "@/stores/app-store";
import { useLibraryStore } from "@/stores/library-store";
import { useReaderStore } from "@/stores/reader-store";
import { useSettingsStore } from "@readany/core/stores/settings-store";
import { BookOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HomeSidebar } from "./Sidebar";
import { TabBar } from "./TabBar";

/** All home sub-views — each stays mounted and uses display:none to toggle. */
const HOME_VIEWS: { id: string; Component: React.ComponentType }[] = [
  { id: "home", Component: HomePage },
  { id: "chat", Component: ChatPageComponent },
  { id: "notes", Component: NotesPage },
  { id: "skills", Component: SkillsPage },
  { id: "stats", Component: ReadingStatsPanel },
];

/** Idle timeout before a background reader tab is hibernated (30 minutes). */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** How often we check for idle tabs (every 2 minutes). */
const IDLE_CHECK_INTERVAL_MS = 2 * 60 * 1000;

export function AppLayout() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const showSettings = useAppStore((s) => s.showSettings);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const initTab = useReaderStore((s) => s.initTab);
  const readerStoreTabs = useReaderStore((s) => s.tabs);
  const books = useLibraryStore((s) => s.books);
  const { hasCompletedOnboarding: _hasCompletedOnboarding, _hasHydrated } = useSettingsStore();
  const { t } = useTranslation();

  // Command palette state
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const toggleCommandPalette = useCallback(() => {
    setCommandPaletteOpen((prev) => !prev);
  }, []);

  // Global keyboard shortcut: Cmd+Shift+P / Ctrl+Shift+P
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        toggleCommandPalette();
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [toggleCommandPalette]);

  const readerTabs = tabs.filter((t) => t.type === "reader" && t.bookId);
  const isReaderActive = readerTabs.some((t) => t.id === activeTabId);

  // Determine which home sub-view is active
  const homeViewKey = isReaderActive ? null : (activeTabId ?? "home");

  // Track which reader tabs we've already initialized
  const initializedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const tab of readerTabs) {
      if (tab.bookId && !initializedRef.current.has(tab.id) && !readerStoreTabs[tab.id]) {
        initializedRef.current.add(tab.id);
        initTab(tab.id, tab.bookId);
      }
    }
    // Clean up removed tabs from tracking
    const currentIds = new Set(readerTabs.map((t) => t.id));
    for (const id of initializedRef.current) {
      if (!currentIds.has(id)) {
        initializedRef.current.delete(id);
      }
    }
  }, [readerTabs, initTab, readerStoreTabs]);

  // --- Idle Tab Hibernate ---
  // Set of tab IDs whose ReaderView has been unmounted to reclaim memory.
  // When the user switches back, the tab is removed from this set and re-mounted.
  const [hibernatedTabs, setHibernatedTabs] = useState<Set<string>>(new Set());

  // Periodic idle check — every IDLE_CHECK_INTERVAL_MS, scan non-active reader tabs
  // and hibernate any that have been idle longer than IDLE_TIMEOUT_MS.
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      const currentTabs = useAppStore.getState().tabs;
      const currentActiveId = useAppStore.getState().activeTabId;

      const toHibernate: string[] = [];
      for (const tab of currentTabs) {
        if (tab.type !== "reader" || tab.id === currentActiveId) continue;
        const lastActive = tab.lastActiveAt ?? 0;
        if (now - lastActive >= IDLE_TIMEOUT_MS) {
          toHibernate.push(tab.id);
        }
      }

      if (toHibernate.length > 0) {
        // Evict blob cache for hibernated books
        for (const tabId of toHibernate) {
          const tab = currentTabs.find((t) => t.id === tabId);
          if (tab?.bookId) {
            const book = books.find((b) => b.id === tab.bookId);
            if (book?.filePath) {
              evictBlobCache(book.filePath);
            }
          }
        }

        setHibernatedTabs((prev) => {
          const next = new Set(prev);
          for (const id of toHibernate) next.add(id);
          return next;
        });

        console.log(`[AppLayout] Hibernated ${toHibernate.length} idle tab(s):`, toHibernate);
      }
    };

    const interval = setInterval(check, IDLE_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [books]);

  // Wake up a hibernated tab when it becomes active
  useEffect(() => {
    if (!activeTabId) return;
    setHibernatedTabs((prev) => {
      if (!prev.has(activeTabId)) return prev;
      const next = new Set(prev);
      next.delete(activeTabId);
      console.log(`[AppLayout] Waking up hibernated tab: ${activeTabId}`);
      return next;
    });
  }, [activeTabId]);

  // Clean hibernatedTabs when tabs are removed
  useEffect(() => {
    const currentIds = new Set(readerTabs.map((t) => t.id));
    setHibernatedTabs((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of prev) {
        if (!currentIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [readerTabs]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-muted">
      {_hasHydrated && <OnboardingModal />}
      <TabBar />
      <main className="relative flex-1 overflow-hidden">
        {/* === Home layer (sidebar + content card) === */}
        <div
          className="flex h-full w-full overflow-hidden"
          style={{ display: !isReaderActive ? "flex" : "none" }}
        >
          <HomeSidebar />
          <div className="h-full flex-1 overflow-hidden pr-1 pb-1">
            <div className="relative flex h-full flex-col overflow-hidden rounded-xl border bg-background shadow-around">
              {/* All home sub-views stay mounted; toggle via display:none */}
              {HOME_VIEWS.map(({ id, Component }) => (
                <div
                  key={id}
                  className="h-full w-full"
                  style={{ display: homeViewKey === id ? "block" : "none" }}
                >
                  <Component />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* === Reader layers — one per open reader tab === */}
        {readerTabs.map((tab) => {
          const isHibernated = hibernatedTabs.has(tab.id);
          const isActive = activeTabId === tab.id;

          return (
            <div
              key={tab.id}
              className="absolute inset-0 overflow-hidden"
              style={{ display: isActive ? "block" : "none" }}
            >
              {isHibernated ? (
                <HibernatedPlaceholder
                  tabId={tab.id}
                  title={tab.title}
                  progress={readerStoreTabs[tab.id]?.progress}
                  t={t}
                />
              ) : (
                <ReaderView bookId={tab.bookId!} tabId={tab.id} />
              )}
            </div>
          );
        })}
      </main>
      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
    </div>
  );
}

/** Placeholder shown for hibernated (idle-reclaimed) reader tabs. */
function HibernatedPlaceholder({
  tabId,
  title,
  progress,
  t,
}: {
  tabId: string;
  title: string;
  progress?: number;
  t: (key: string) => string;
}) {
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-background">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <BookOpen className="h-8 w-8 text-muted-foreground" />
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <h3 className="max-w-xs truncate text-sm font-medium text-foreground">{title}</h3>
        {progress != null && progress > 0 && (
          <p className="text-xs text-muted-foreground">{Math.round(progress * 100)}%</p>
        )}
        <p className="text-xs text-muted-foreground">
          {t("reader.hibernated") || "Tab was hibernated to save memory"}
        </p>
      </div>
      <button
        type="button"
        className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
        onClick={() => {
          // setActiveTab will trigger the wake-up effect and remove from hibernatedTabs
          setActiveTab(tabId);
        }}
      >
        {t("reader.resumeReading") || "Resume Reading"}
      </button>
    </div>
  );
}
