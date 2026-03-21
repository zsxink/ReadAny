export type { ToolDefinition, ToolParameter } from "./tool-types";

export {
  createChatModel,
  createChatModelFromEndpoint,
  resolveActiveEndpoint,
  setStreamingFetch,
} from "./llm-provider";
export type { LLMOptions } from "./llm-provider";

export { processMessages } from "./message-pipeline";
export type { ProcessedMessage } from "./message-pipeline";

export { generateSemanticContext, detectOperationType } from "./semantic-context";
export type { OperationType } from "./semantic-context";

export { StreamingChat, createMessageId, createThreadId } from "./streaming";
export type { StreamingOptions } from "./streaming";

export { buildSystemPrompt } from "./system-prompt";

export { BUILTIN_EMBEDDING_MODELS } from "./builtin-embedding-models";
export type { BuiltinEmbeddingModel } from "./builtin-embedding-models";

export {
  loadEmbeddingPipeline,
  generateLocalEmbeddings,
  disposeEmbeddingPipeline,
  setEmbeddingWorkerFactory,
} from "./local-embedding-service";

export { getAvailableTools } from "./tools";

export { getContextTools } from "./context-tools";

export { readingContextService, getReadingContextSnapshot } from "./reading-context-service";
