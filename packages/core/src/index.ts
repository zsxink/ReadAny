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

// Import services
export { WebDavImportService } from "./import/webdav-import-service";
export {
  DEFAULT_WEBDAV_IMPORT_REMOTE_ROOT,
  WEBDAV_IMPORT_SUPPORTED_EXTENSIONS,
  getWebDavImportExtension,
  isImportableWebDavBookName,
  normalizeWebDavImportPath,
  normalizeWebDavImportRoot,
} from "./import/webdav-import-types";
export type {
  WebDavImportEntry,
  WebDavImportListing,
  WebDavImportSource,
  WebDavImportSourceKind,
} from "./import/webdav-import-types";
