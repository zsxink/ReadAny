/**
 * @readany/core — Shared platform-agnostic business logic
 */

// Types
export * from "./types";

// Utils
export {
  cn,
  debounce,
  throttle,
  eventBus,
  convertToMessageV2,
  mergeMessagesWithStreaming,
} from "./utils";
export type { EventMap } from "./utils";

// Services (platform abstraction)
export type {
  IPlatformService,
  IDatabase,
  IWebSocket,
  FilePickerOptions,
  WebSocketOptions,
  UpdateInfo,
} from "./services";
export { setPlatformService, getPlatformService } from "./services";

// i18n
export { default as i18n, initI18nLanguage, changeAndPersistLanguage } from "./i18n";
