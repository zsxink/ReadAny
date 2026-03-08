/**
 * MobileNotebookPanel — slide-in panel for viewing and editing notes/highlights
 * Mobile-optimized: full-height, touch-friendly, bottom-safe-area aware
 */
import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  NotebookPen,
  Highlighter,
  Save,
  Trash2,
  Edit3,
  ChevronDown,
  ChevronRight,
  Download,
} from "lucide-react";
import { cn } from "@readany/core/utils";
import { useNotebookStore } from "@readany/core/stores/notebook-store";
import { useAnnotationStore } from "@readany/core/stores/annotation-store";
import type { Highlight, HighlightColor } from "@readany/core/types";
import { HIGHLIGHT_COLOR_HEX } from "@readany/core/types";
import { annotationExporter, type ExportFormat } from "@readany/core/export";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MobileNotebookPanelProps {
  bookId: string;
  bookTitle: string;
  open: boolean;
  onClose: () => void;
  onGoToCfi?: (cfi: string) => void;
  onAddAnnotation?: (cfi: string, color: string, note?: string) => void;
  onDeleteAnnotation?: (cfi: string) => void;
}

export function MobileNotebookPanel({
  bookId,
  bookTitle,
  open,
  onClose,
  onGoToCfi,
  onAddAnnotation,
  onDeleteAnnotation,
}: MobileNotebookPanelProps) {
  const { t } = useTranslation();

  const {
    pendingNote,
    editingHighlight,
    clearPending,
    saveDraft,
    getDraft,
    clearDraft,
  } = useNotebookStore();

  const {
    highlights,
    addHighlight,
    updateHighlight,
    removeHighlight,
  } = useAnnotationStore();

  const [noteContent, setNoteContent] = useState("");
  const [expandedSections, setExpandedSections] = useState({
    highlights: true,
    notes: true,
  });
  const [showExportMenu, setShowExportMenu] = useState(false);

  const bookHighlights = highlights.filter((h) => h.bookId === bookId);
  const highlightsWithNotes = bookHighlights.filter((h) => h.note);
  const highlightsWithoutNotes = bookHighlights.filter((h) => !h.note);

  useEffect(() => {
    if (pendingNote) {
      const draft = getDraft(pendingNote.text);
      setNoteContent(draft || pendingNote.existingNote || "");
    } else if (editingHighlight) {
      setNoteContent(editingHighlight.note || "");
    }
  }, [pendingNote, editingHighlight, getDraft]);

  useEffect(() => {
    if (pendingNote && noteContent) {
      saveDraft(pendingNote.text, noteContent);
    }
  }, [noteContent, pendingNote, saveDraft]);

  const handleSave = useCallback(() => {
    if (pendingNote) {
      const highlightId = crypto.randomUUID();
      const color = "yellow" as HighlightColor;
      addHighlight({
        id: highlightId,
        bookId,
        cfi: pendingNote.cfi,
        text: pendingNote.text,
        color,
        note: noteContent.trim() || undefined,
        chapterTitle: pendingNote.chapterTitle,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      onAddAnnotation?.(pendingNote.cfi, color, noteContent.trim() || undefined);
      clearDraft(pendingNote.text);
      clearPending();
    } else if (editingHighlight) {
      updateHighlight(editingHighlight.id, {
        note: noteContent.trim() || undefined,
        updatedAt: Date.now(),
      });
      clearPending();
    }
    setNoteContent("");
  }, [pendingNote, editingHighlight, bookId, noteContent, addHighlight, updateHighlight, onAddAnnotation, clearDraft, clearPending]);

  const handleCancel = useCallback(() => {
    clearPending();
    setNoteContent("");
  }, [clearPending]);

  const handleDeleteNote = useCallback(() => {
    if (editingHighlight) {
      updateHighlight(editingHighlight.id, {
        note: undefined,
        updatedAt: Date.now(),
      });
      if (editingHighlight.cfi) {
        onDeleteAnnotation?.(editingHighlight.cfi);
        onAddAnnotation?.(editingHighlight.cfi, editingHighlight.color);
      }
      clearPending();
      setNoteContent("");
    }
  }, [editingHighlight, updateHighlight, onDeleteAnnotation, onAddAnnotation, clearPending]);

  const handleHighlightClick = useCallback((highlight: Highlight) => {
    if (onGoToCfi && highlight.cfi) {
      onGoToCfi(highlight.cfi);
      onClose();
    }
  }, [onGoToCfi, onClose]);

  const handleEditHighlightNote = useCallback((highlight: Highlight) => {
    useNotebookStore.getState().startEditNote(highlight);
  }, []);

  const handleDeleteNoteOnly = useCallback((highlight: Highlight) => {
    updateHighlight(highlight.id, {
      note: undefined,
      updatedAt: Date.now(),
    });
    if (highlight.cfi) {
      onDeleteAnnotation?.(highlight.cfi);
      onAddAnnotation?.(highlight.cfi, highlight.color);
    }
  }, [updateHighlight, onDeleteAnnotation, onAddAnnotation]);

  const handleDeleteHighlight = useCallback((highlight: Highlight) => {
    removeHighlight(highlight.id);
    if (highlight.cfi) {
      onDeleteAnnotation?.(highlight.cfi);
    }
  }, [removeHighlight, onDeleteAnnotation]);

  const toggleSection = useCallback((section: "highlights" | "notes") => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  }, []);

  const handleExport = useCallback((format: ExportFormat) => {
    const book = {
      id: bookId,
      filePath: "",
      format: "epub" as const,
      addedAt: Date.now(),
      updatedAt: Date.now(),
      progress: 0,
      isVectorized: false,
      vectorizeProgress: 0,
      tags: [] as string[],
      meta: { title: bookTitle, author: "" },
    };
    const content = annotationExporter.export(
      bookHighlights as Highlight[],
      [],
      book,
      { format },
    );
    if (format === "notion") {
      annotationExporter.copyToClipboard(content);
    } else {
      const ext = format === "json" ? "json" : "md";
      annotationExporter.downloadAsFile(content, `${bookTitle}-${format}.${ext}`, format);
    }
    setShowExportMenu(false);
  }, [bookHighlights, bookId, bookTitle]);

  const isEditing = pendingNote || editingHighlight;
  const editingText = pendingNote?.text || editingHighlight?.text || "";

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background animate-in slide-in-from-bottom duration-300"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/40 px-3">
          <span className="text-sm font-medium text-foreground">
            {t("notebook.title")}
          </span>
          <div className="flex items-center gap-1">
            <div className="relative">
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-muted"
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={bookHighlights.length === 0}
              >
                <Download className="h-4 w-4" />
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-8 z-10 min-w-[140px] rounded-lg border border-border bg-popover p-1 shadow-lg">
                  {(["markdown", "json", "obsidian", "notion"] as ExportFormat[]).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm active:bg-muted"
                      onClick={() => handleExport(fmt)}
                    >
                      {t(`notes.export${fmt.charAt(0).toUpperCase() + fmt.slice(1)}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-muted"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isEditing && (
            <div className="border-b border-border/40 p-3">
              <div className="mb-3 rounded-md bg-muted/50 p-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <Highlighter className="h-3 w-3" />
                  <span>{t("notebook.selectedText")}</span>
                </div>
                <p className="text-sm text-foreground line-clamp-3">
                  "{editingText}"
                </p>
                {(pendingNote?.chapterTitle || editingHighlight?.chapterTitle) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {pendingNote?.chapterTitle || editingHighlight?.chapterTitle}
                  </p>
                )}
              </div>

              <textarea
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder={t("notebook.addNote")}
                className="min-h-[120px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                autoFocus
              />

              <div className="mt-3 flex items-center justify-between">
                <div>
                  {editingHighlight?.note && (
                    <button
                      type="button"
                      className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-destructive active:bg-destructive/10"
                      onClick={handleDeleteNote}
                    >
                      <Trash2 className="h-3 w-3" />
                      {t("notebook.deleteNote")}
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-md px-3 py-1.5 text-xs text-muted-foreground active:bg-muted"
                    onClick={handleCancel}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground active:scale-95"
                    onClick={handleSave}
                  >
                    <Save className="h-3 w-3" />
                    {t("common.save")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {highlightsWithNotes.length > 0 && (
            <div className="border-b border-border/40">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left active:bg-muted/50"
                onClick={() => toggleSection("notes")}
              >
                {expandedSections.notes ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <NotebookPen className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {t("notebook.notesSection")}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({highlightsWithNotes.length})
                </span>
              </button>
              {expandedSections.notes && (
                <div className="px-3 pb-2">
                  {highlightsWithNotes.map((highlight) => (
                    <HighlightNoteItem
                      key={highlight.id}
                      highlight={highlight}
                      onClick={() => handleHighlightClick(highlight)}
                      onEdit={() => handleEditHighlightNote(highlight)}
                      onDeleteNote={() => handleDeleteNoteOnly(highlight)}
                      isActive={editingHighlight?.id === highlight.id}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {highlightsWithoutNotes.length > 0 && (
            <div className="border-b border-border/40">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left active:bg-muted/50"
                onClick={() => toggleSection("highlights")}
              >
                {expandedSections.highlights ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <Highlighter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {t("notebook.highlightsSection")}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({highlightsWithoutNotes.length})
                </span>
              </button>
              {expandedSections.highlights && (
                <div className="px-3 pb-2">
                  {highlightsWithoutNotes.map((highlight) => (
                    <HighlightItem
                      key={highlight.id}
                      highlight={highlight}
                      onClick={() => handleHighlightClick(highlight)}
                      onAddNote={() => handleEditHighlightNote(highlight)}
                      onDelete={() => handleDeleteHighlight(highlight)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {bookHighlights.length === 0 && !isEditing && (
            <div className="flex h-48 flex-col items-center justify-center p-6 text-center">
              <NotebookPen className="mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                {t("notebook.empty")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                {t("notebook.emptyHint")}
              </p>
            </div>
          )}
        </div>

        {/* Bottom safe area */}
        <div style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }} />
      </div>
  );
}

function HighlightNoteItem({
  highlight,
  onClick,
  onEdit,
  onDeleteNote,
  isActive,
}: {
  highlight: Highlight;
  onClick: () => void;
  onEdit: () => void;
  onDeleteNote: () => void;
  isActive?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "group mt-2 rounded-md border border-border/40 p-2.5 transition-colors cursor-pointer",
        isActive ? "bg-muted" : "active:bg-muted/50",
      )}
    >
      <div className="flex items-start gap-2" onClick={onClick}>
        <div
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: HIGHLIGHT_COLOR_HEX[highlight.color] }}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground line-clamp-2">
            "{highlight.text}"
          </p>
          {highlight.note && (
            <div className="mt-1.5 text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1.5 prose prose-xs dark:prose-invert max-w-none break-words overflow-hidden [overflow-wrap:anywhere]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {highlight.note}
              </ReactMarkdown>
            </div>
          )}
          {highlight.chapterTitle && (
            <p className="mt-1 text-xs text-muted-foreground/70">
              {highlight.chapterTitle}
            </p>
          )}
        </div>
      </div>
      <div className="mt-2 flex justify-end gap-1">
        <button
          type="button"
          className="rounded p-1.5 text-muted-foreground active:bg-muted active:text-primary"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          title={t("notebook.editNote")}
        >
          <Edit3 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="rounded p-1.5 text-muted-foreground active:bg-muted active:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteNote();
          }}
          title={t("notebook.deleteNote")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function HighlightItem({
  highlight,
  onClick,
  onAddNote,
  onDelete,
}: {
  highlight: Highlight;
  onClick: () => void;
  onAddNote: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="group mt-2 flex items-start gap-2 rounded-md p-2.5 transition-colors cursor-pointer active:bg-muted/50"
      onClick={onClick}
    >
      <div
        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: HIGHLIGHT_COLOR_HEX[highlight.color] }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground line-clamp-2">
          "{highlight.text}"
        </p>
        {highlight.chapterTitle && (
          <p className="mt-1 text-xs text-muted-foreground/70">
            {highlight.chapterTitle}
          </p>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-1">
        <button
          type="button"
          className="rounded p-1.5 text-muted-foreground active:bg-muted active:text-primary"
          onClick={(e) => {
            e.stopPropagation();
            onAddNote();
          }}
          title={t("notebook.addNoteBtn")}
        >
          <NotebookPen className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="rounded p-1.5 text-muted-foreground active:bg-muted active:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title={t("notebook.deleteHighlightBtn")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
