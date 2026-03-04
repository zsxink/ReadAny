/**
 * TagManageSheet — Bottom sheet for managing tags on a book
 * Allows toggling existing tags and creating new ones
 */
import type { Book } from "@readany/core/types";
import { Check, Plus, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface TagManageSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  book: Book | null;
  allTags: string[];
  onAddTag: (tag: string) => void;
  onAddTagToBook: (bookId: string, tag: string) => void;
  onRemoveTagFromBook: (bookId: string, tag: string) => void;
}

export function TagManageSheet({
  open,
  onOpenChange,
  book,
  allTags,
  onAddTag,
  onAddTagToBook,
  onRemoveTagFromBook,
}: TagManageSheetProps) {
  const { t } = useTranslation();
  const [newTagInput, setNewTagInput] = useState("");

  if (!book) return null;

  const handleCreateAndAssign = () => {
    const trimmed = newTagInput.trim();
    if (!trimmed) return;
    onAddTag(trimmed);
    onAddTagToBook(book.id, trimmed);
    setNewTagInput("");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showClose={false} className="max-h-[70dvh]">
        <SheetHeader>
          <SheetTitle className="text-base">{t("home.manageTags")}</SheetTitle>
        </SheetHeader>

        <div className="mt-2 flex-1 overflow-y-auto">
          {/* Existing tags */}
          {allTags.length > 0 ? (
            <div className="space-y-1">
              {allTags.map((tag) => {
                const hasTag = book.tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 active:bg-muted transition-colors"
                    onClick={() => {
                      if (hasTag) onRemoveTagFromBook(book.id, tag);
                      else onAddTagToBook(book.id, tag);
                    }}
                  >
                    <div
                      className={`flex h-5 w-5 items-center justify-center rounded border-2 transition-colors ${
                        hasTag
                          ? "border-primary bg-primary"
                          : "border-neutral-300"
                      }`}
                    >
                      {hasTag && <Check className="h-3 w-3 text-white" />}
                    </div>
                    <span className="text-sm">{tag}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t("sidebar.noTags")}
            </p>
          )}

          {/* New tag input */}
          <div className="mt-3 border-t pt-3">
            <div className="flex items-center gap-2">
              <div className="flex flex-1 items-center gap-2 rounded-lg bg-muted px-3 py-2">
                <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  type="text"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  placeholder={t("sidebar.tagPlaceholder")}
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateAndAssign();
                  }}
                />
                {newTagInput && (
                  <button
                    type="button"
                    className="shrink-0"
                    onClick={() => setNewTagInput("")}
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
              {newTagInput.trim() && (
                <button
                  type="button"
                  className="shrink-0 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground active:opacity-80"
                  onClick={handleCreateAndAssign}
                >
                  {t("common.add")}
                </button>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
