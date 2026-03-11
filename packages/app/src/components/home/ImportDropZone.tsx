/**
 * ImportDropZone — empty state with import button and drag-drop
 */
import { useLibraryStore } from "@/stores/library-store";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

export function ImportDropZone() {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const importBooks = useLibraryStore((s) => s.importBooks);

  const handleImportClick = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Books", extensions: ["epub", "pdf", "mobi", "azw", "azw3", "fb2", "fbz"] }],
      } as const);
      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        if (paths.length > 0) {
          await importBooks(paths);
        }
      }
    } catch {
      // User cancelled
    }
  }, [importBooks]);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      // In Tauri, drag-and-drop provides file paths via the dataTransfer
      const files = e.dataTransfer.files;
      const paths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i] as File & { path?: string };
        if (f.path) {
          const ext = f.name.split(".").pop()?.toLowerCase();
          if (ext === "epub" || ext === "pdf" || ext === "mobi" || ext === "azw" || ext === "azw3" || ext === "fb2" || ext === "fbz") {
            paths.push(f.path);
          }
        }
      }
      if (paths.length > 0) {
        await importBooks(paths);
      }
    },
    [importBooks],
  );

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <div className="w-full max-w-md text-center">
        <div
          className={`rounded-2xl border-2 border-dashed p-8 transition-colors ${
            isDragging ? "border-primary bg-primary/5" : "border-border bg-muted/30"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <div className="mx-auto mb-6">
            <img src="/book.svg" alt="" className="h-40 w-40 mx-auto" />
          </div>
          <p className="mb-1 text-base font-medium text-foreground">{t("home.emptyLibrary")}</p>
          <p className="mb-4 text-sm text-muted-foreground">{t("home.dropToUpload")}</p>
          <p className="mb-4 text-xs text-muted-foreground/70">{t("home.supportedFormat")}</p>
          <button
            type="button"
            onClick={handleImportClick}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("home.importBooks")}
          </button>
        </div>
      </div>
    </div>
  );
}
