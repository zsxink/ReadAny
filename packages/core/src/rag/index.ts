export type { TextSegment, ChapterData } from "./rag-types";

export { chunkContent, estimateTokens } from "./chunker";
export type { ChunkerConfig } from "./chunker";

export { EmbeddingService } from "./embedding-service";
export type { EmbeddingConfig } from "./embedding-service";

export {
  getEmbeddingModels,
  getDefaultModel,
  getEmbedding,
  getEmbeddings,
  cosineSimilarity,
} from "./embedding";

export {
  search,
  configureSearch,
  invalidateChunkCache,
  clearChunkCache,
} from "./search";

export { vectorizeBook } from "./vectorize";
export type { VectorizeCallback } from "./vectorize";

export { triggerVectorizeBook } from "./vectorize-trigger";
export type {
  VectorizeStatusCallback,
  VectorizeTriggerConfig,
  VectorizeTriggerCallbacks,
} from "./vectorize-trigger";
