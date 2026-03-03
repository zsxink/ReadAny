/**
 * Vectorize Trigger — app-layer adapter that bridges platform-specific
 * concerns (Zustand stores, book file extraction) with the core vectorization pipeline.
 *
 * Re-exports the core types for convenience.
 */
import {
  triggerVectorizeBook as coreTriggerVectorizeBook,
  type VectorizeStatusCallback,
  type VectorizeTriggerConfig,
} from "@readany/core/rag";
import { useLibraryStore } from "@/stores/library-store";
import { useVectorModelStore } from "@/stores/vector-model-store";
import { extractBookChapters } from "./book-extractor";

export type { VectorizeStatusCallback };

/**
 * App-level wrapper: reads store state, extracts chapters from the book file,
 * then delegates to the core pipeline.
 */
export async function triggerVectorizeBook(
  bookId: string,
  filePath: string,
  onProgress?: VectorizeStatusCallback,
): Promise<void> {
  const vmState = useVectorModelStore.getState();

  // Build platform-agnostic config from Zustand store
  const config: VectorizeTriggerConfig = {
    vectorModelEnabled: vmState.vectorModelEnabled,
    vectorModelMode: vmState.vectorModelMode,
    selectedBuiltinModelId: vmState.selectedBuiltinModelId,
    remoteModel: (() => {
      const selected = vmState.getSelectedVectorModel();
      if (!selected) return null;
      return {
        url: selected.url,
        apiKey: selected.apiKey,
        modelId: selected.modelId,
      };
    })(),
  };

  // Build callbacks that write back to Zustand store
  const callbacks = {
    onBookUpdate: useLibraryStore.getState().updateBook,
  };

  // Extract chapters from the book file (platform-specific: Tauri + foliate-js)
  const chapters = await extractBookChapters(filePath);

  // Delegate to core
  await coreTriggerVectorizeBook(
    bookId,
    chapters,
    config,
    callbacks,
    onProgress,
  );
}
