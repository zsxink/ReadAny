/**
 * Vectorize Trigger — high-level service that orchestrates book vectorization.
 * Connects: chapter data → chunking → embedding → database indexing → state update.
 *
 * Platform-agnostic: all platform-specific concerns (stores, file I/O) are
 * injected via VectorizeTriggerConfig and VectorizeTriggerCallbacks.
 *
 * Supports both built-in (Transformers.js via Web Worker) and remote (OpenAI-compatible API) embedding models.
 */
import { eventBus } from "../utils/event-bus";
import type { VectorizeProgress } from "../types";
import { BUILTIN_EMBEDDING_MODELS } from "../ai/builtin-embedding-models";
import {
  generateLocalEmbeddings,
  loadEmbeddingPipeline,
} from "../ai/local-embedding-service";
import { insertChunks, deleteChunks } from "../db/database";
import { chunkContent } from "./chunker";
import { invalidateChunkCache } from "./search";
import type { ChapterData } from "./rag-types";

export type VectorizeStatusCallback = (
  progress: VectorizeProgress,
) => void;

/** Configuration describing the vector model to use */
export interface VectorizeTriggerConfig {
  vectorModelEnabled: boolean;
  vectorModelMode: "builtin" | "remote";
  selectedBuiltinModelId: string | null;
  remoteModel: {
    url: string;
    apiKey: string;
    modelId: string;
  } | null;
}

/** Callbacks for platform-specific side effects (e.g. updating UI store) */
export interface VectorizeTriggerCallbacks {
  /** Called to update the book's vectorization state in the UI layer */
  onBookUpdate: (
    bookId: string,
    update: { isVectorized: boolean; vectorizeProgress: number },
  ) => void;
}

/** Yield to the event loop so UI can repaint */
const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Trigger full vectorization for a book.
 * 1. Chunks chapter text into manageable pieces
 * 2. Generates embeddings (local via Worker or remote API)
 * 3. Stores chunks + embeddings in SQLite
 * 4. Notifies via callbacks and eventBus
 *
 * @param bookId - The book identifier
 * @param chapters - Pre-extracted chapter data (platform does the extraction)
 * @param config - Vector model configuration
 * @param callbacks - Platform-specific side-effect callbacks
 * @param onProgress - Optional progress reporting callback
 */
export async function triggerVectorizeBook(
  bookId: string,
  chapters: ChapterData[],
  config: VectorizeTriggerConfig,
  callbacks: VectorizeTriggerCallbacks,
  onProgress?: VectorizeStatusCallback,
): Promise<void> {
  if (!config.vectorModelEnabled) {
    throw new Error(
      "Vector model is not enabled. Please enable it in Settings → Vector Model.",
    );
  }

  if (chapters.length === 0) {
    throw new Error("No content could be extracted from the book.");
  }

  const progress: VectorizeProgress = {
    bookId,
    totalChunks: 0,
    processedChunks: 0,
    status: "chunking",
  };

  try {
    // Update book state: vectorizing
    callbacks.onBookUpdate(bookId, {
      isVectorized: false,
      vectorizeProgress: 0,
    });
    eventBus.emit("vectorize:started", { bookId });
    onProgress?.(progress);
    await yieldToUI();

    // Phase 1: Chunk chapters
    const allChunks: Array<{
      id: string;
      bookId: string;
      chapterIndex: number;
      chapterTitle: string;
      content: string;
      tokenCount: number;
      startCfi: string;
      endCfi: string;
      embedding?: number[];
    }> = [];

    for (const chapter of chapters) {
      const chunks = chunkContent(
        chapter.content,
        bookId,
        chapter.index,
        chapter.title,
        {
          targetTokens: 300,
          minTokens: 50,
          overlapRatio: 0.2,
        },
        chapter.segments,
      );
      allChunks.push(...chunks);
    }

    if (allChunks.length === 0) {
      throw new Error("No chunks were generated from the book content.");
    }

    progress.totalChunks = allChunks.length;
    progress.status = "embedding";
    progress.processedChunks = 0;
    onProgress?.(progress);
    await yieldToUI();

    // Phase 2: Generate embeddings
    if (config.vectorModelMode === "builtin") {
      await generateBuiltinEmbeddings(
        allChunks,
        config.selectedBuiltinModelId,
        progress,
        onProgress,
      );
    } else {
      await generateRemoteEmbeddings(
        allChunks,
        config,
        progress,
        onProgress,
      );
    }

    // Phase 3: Store in database (batch insert for performance)
    progress.status = "indexing";
    onProgress?.(progress);
    await yieldToUI();

    await deleteChunks(bookId);
    // Insert in batches of 50 to avoid huge single transaction
    const insertBatchSize = 50;
    for (let i = 0; i < allChunks.length; i += insertBatchSize) {
      await insertChunks(allChunks.slice(i, i + insertBatchSize));
    }

    // Invalidate search cache so next query picks up new embeddings
    invalidateChunkCache(bookId);

    // Phase 4: Update state
    progress.status = "completed";
    onProgress?.(progress);

    callbacks.onBookUpdate(bookId, {
      isVectorized: true,
      vectorizeProgress: 1,
    });
    eventBus.emit("vectorize:completed", {
      bookId,
      chunksCount: allChunks.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    progress.status = "error";
    progress.error = message;
    onProgress?.(progress);

    callbacks.onBookUpdate(bookId, {
      isVectorized: false,
      vectorizeProgress: 0,
    });
    eventBus.emit("vectorize:error", { bookId, error: message });
    throw err;
  }
}

/** Generate embeddings using a built-in Transformers.js model (via Web Worker) */
async function generateBuiltinEmbeddings(
  chunks: Array<{ content: string; embedding?: number[] }>,
  builtinModelId: string | null,
  progress: VectorizeProgress,
  onProgress?: VectorizeStatusCallback,
) {
  if (!builtinModelId) {
    throw new Error(
      "No built-in model selected. Please select one in Settings → Vector Model.",
    );
  }

  const model = BUILTIN_EMBEDDING_MODELS.find((m) => m.id === builtinModelId);
  if (!model) throw new Error(`Unknown built-in model: ${builtinModelId}`);

  // Ensure the model is loaded in the Worker
  await loadEmbeddingPipeline(builtinModelId);

  // Process in batches — Worker handles the heavy lifting off main thread
  const batchSize = 16;
  let globalProcessed = 0;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map((c) => c.content);
    const batchOffset = i;

    // generateLocalEmbeddings now runs in Worker with per-item progress
    const embeddings = await generateLocalEmbeddings(
      builtinModelId,
      texts,
      (done, _total) => {
        globalProcessed = batchOffset + done;
        progress.processedChunks = globalProcessed;
        eventBus.emit("vectorize:progress", {
          bookId: progress.bookId,
          progress: globalProcessed / progress.totalChunks,
          status: "embedding",
        });
        onProgress?.(progress);
      },
    );

    for (let j = 0; j < batch.length; j++) {
      batch[j].embedding = embeddings[j];
    }

    await yieldToUI();
  }
}

/** Generate embeddings using a remote API endpoint */
async function generateRemoteEmbeddings(
  chunks: Array<{ content: string; embedding?: number[] }>,
  config: VectorizeTriggerConfig,
  progress: VectorizeProgress,
  onProgress?: VectorizeStatusCallback,
) {
  const selectedModel = config.remoteModel;
  if (!selectedModel) {
    throw new Error(
      "No remote vector model selected. Please configure one in Settings → Vector Model.",
    );
  }

  const isOllama = selectedModel.url.endsWith("/api/embed");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (selectedModel.apiKey.trim()) {
    headers.Authorization = `Bearer ${selectedModel.apiKey}`;
  }

  const batchSize = 20;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map((c) => c.content);

    const requestBody = isOllama
      ? { model: selectedModel.modelId, input: texts }
      : {
          input: texts,
          model: selectedModel.modelId,
          encoding_format: "float",
        };

    const res = await fetch(selectedModel.url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Embedding API error (${res.status}): ${errorText}`);
    }

    const json = await res.json();
    const embeddings: number[][] = isOllama
      ? (json?.embeddings ?? [])
      : (
          (json?.data ?? []) as Array<{
            embedding: number[];
            index: number;
          }>
        )
          .sort((a: any, b: any) => a.index - b.index)
          .map((d: any) => d.embedding);

    for (let j = 0; j < batch.length; j++) {
      batch[j].embedding = embeddings[j] ?? [];
    }

    progress.processedChunks = Math.min(i + batchSize, chunks.length);
    eventBus.emit("vectorize:progress", {
      bookId: progress.bookId,
      progress: progress.processedChunks / progress.totalChunks,
      status: "embedding",
    });
    onProgress?.(progress);
    await yieldToUI();
  }
}
