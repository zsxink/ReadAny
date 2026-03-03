# ReadAny 移动端重构方案 — 详细设计文档

## 一、目标

将 ReadAny 从纯桌面应用重构为支持 **桌面 + 移动端（iOS / Android）** 的跨平台应用。核心思路：抽离平台无关的公共逻辑为共享包，桌面端和移动端各自实现平台特定部分。

参考项目：同目录下的 `readest`（已实现桌面 + 移动端 + Web 三端）。

---

## 二、现状分析

### 2.1 项目架构总览

```
ReadAny/ (pnpm monorepo)
├── packages/
│   ├── app/                 # 唯一应用（Vite + React + Tauri 2）
│   │   ├── src/             # 前端源码
│   │   │   ├── components/  # 74 个 UI 组件
│   │   │   ├── hooks/       # 11 个自定义 Hooks
│   │   │   ├── lib/         # 61 个业务逻辑文件
│   │   │   ├── stores/      # 12 个 Zustand Store
│   │   │   ├── types/       # 10 个类型定义
│   │   │   ├── i18n/        # 中英文国际化
│   │   │   └── pages/       # 7 个页面
│   │   └── src-tauri/       # Rust 后端
│   └── foliate-js/          # 电子书渲染引擎
```

### 2.2 Tauri 依赖分析

**好消息：Tauri 依赖高度集中，88.5% 的 lib/ 代码是平台无关的。**

#### lib/ 目录（61 个文件）

| 分类 | 文件数 | 占比 |
|------|--------|------|
| **完全平台无关** | **54** | **88.5%** |
| 有 Tauri 直接依赖 | 7 | 11.5% |

**有 Tauri 依赖的 7 个文件：**

| 文件 | Tauri 包 | 用途 | 导入方式 |
|------|----------|------|----------|
| `db/database.ts` | `@tauri-apps/plugin-sql` | SQLite 数据库 | 动态 import |
| `db/migrations.ts` | `@tauri-apps/plugin-sql` | 数据库迁移 | 动态 import |
| `reader/book-cache.ts` | `@tauri-apps/api/core`, `@tauri-apps/plugin-fs` | 文件路径转 URL、读取文件 | 动态 import |
| `rag/book-extractor.ts` | `@tauri-apps/plugin-fs` | 读取书籍文件 | 动态 import |
| `tts/tts-service.ts` | `@tauri-apps/plugin-http` | DashScope TTS HTTP 请求 | 动态 import |
| `tts/edge-tts.ts` | `@tauri-apps/plugin-websocket` | Edge TTS WebSocket（需自定义 headers） | 动态 import |
| `updater.ts` | `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process` | 应用更新 | 静态 import |

#### stores/ 目录（12 个文件）

| 文件 | 直接依赖 | 间接依赖 |
|------|----------|----------|
| `library-store.ts` | ✅ `plugin-fs`, `api/path`, `api/core` | ✅ `plugin-sql` |
| `persist.ts` | ✅ `plugin-fs` | — |
| `annotation-store.ts` | — | ✅ 通过 `db/database.ts` |
| `chat-store.ts` | — | ✅ 通过 `db/database.ts` |
| `reading-session-store.ts` | — | ✅ 通过 `db/database.ts` |
| `settings-store.ts` | — | ✅ 通过 `persist.ts` |
| `tts-store.ts` | — | ✅ 通过 `persist.ts` + `tts-service.ts` |
| `vector-model-store.ts` | — | ✅ 通过 `persist.ts` |
| `app-store.ts` | — | — (**纯净**) |
| `chat-reader-store.ts` | — | — (**纯净**) |
| `notebook-store.ts` | — | — (**纯净**) |
| `reader-store.ts` | — | — (**纯净**) |

#### components/ 目录（74 个文件）

| 文件 | Tauri 包 | 用途 |
|------|----------|------|
| `reader/ReaderView.tsx` | `api/core`, `plugin-fs` | 本地文件加载 |
| `settings/AboutSettings.tsx` | `api/app` | 获取版本号 |
| `home/HomePage.tsx` | `plugin-dialog` | 文件选择 |
| `home/ImportDropZone.tsx` | `plugin-dialog` | 文件选择 |
| **其余 70 个文件** | **无** | **平台无关** |

#### hooks/ 和 types/

- **hooks/**：11 个文件，0 个直接依赖 Tauri，3 个间接依赖（通过 stores/db）
- **types/**：10 个文件，**全部平台无关**

### 2.3 涉及的 Tauri 包汇总

| Tauri 包 | 使用文件数 | 移动端兼容性 |
|----------|-----------|-------------|
| `@tauri-apps/plugin-sql` | 2 | ✅ Tauri 2 移动端原生支持 |
| `@tauri-apps/plugin-fs` | 4 | ✅ 支持但路径规则不同 |
| `@tauri-apps/api/core` | 2 | ✅ `convertFileSrc` 可用 |
| `@tauri-apps/api/path` | 1 | ✅ 支持但目录结构不同 |
| `@tauri-apps/api/app` | 1 | ✅ 支持 |
| `@tauri-apps/plugin-http` | 1 | ✅ 支持 |
| `@tauri-apps/plugin-websocket` | 1 | ✅ 支持 |
| `@tauri-apps/plugin-dialog` | 2 | ⚠️ 移动端需替代方案 |
| `@tauri-apps/plugin-updater` | 1 | ❌ 移动端走应用商店 |
| `@tauri-apps/plugin-process` | 1 | ❌ 移动端不需要 |

---

## 三、Readest 架构参考

Readest 的核心设计模式值得借鉴：

### 3.1 平台服务抽象层（AppService 模式）

```
AppService (接口)
    ├── BaseAppService (共享基类 ~33KB)
    │   ├── NativeAppService (Tauri 实现 ~20KB)
    │   └── WebAppService (Web 实现 ~11KB)
```

通过 `environment.ts` 工厂函数在运行时选择实现，注入 React Context。

### 3.2 Rust 条件编译

```rust
#[cfg(desktop)]   // 桌面端：更新器、单实例、窗口状态
#[cfg(mobile)]    // 移动端：入口点、原生桥接
#[cfg(target_os = "android")]  // Android 专属
#[cfg(target_os = "ios")]      // iOS 专属
```

### 3.3 自定义 Tauri 插件

- `tauri-plugin-native-bridge` — 原生桥接（Safe Area、屏幕亮度、IAP 等）
- `tauri-plugin-native-tts` — 原生 TTS

---

## 四、目标架构

```
ReadAny/ (pnpm monorepo)
├── packages/
│   ├── core/                      # 🆕 @readany/core — 共享包
│   │   ├── src/
│   │   │   ├── types/               # 类型定义（10 个文件，全量迁移）
│   │   │   ├── i18n/                # 国际化（全量迁移）
│   │   │   ├── utils/               # 工具函数
│   │   │   ├── ai/                  # AI 核心（14 个文件，全量迁移）
│   │   │   ├── rag/                 # RAG（6 个文件，5 个直接迁移）
│   │   │   ├── translation/         # 翻译（4 个文件，全量迁移）
│   │   │   ├── tts/                 # TTS 接口 + Edge TTS 基础逻辑
│   │   │   ├── reader/              # 阅读器核心逻辑（无 Tauri 部分）
│   │   │   ├── stats/               # 阅读统计
│   │   │   ├── export/              # 导出
│   │   │   ├── db/                  # 数据库 Schema + 查询构建器（抽象层）
│   │   │   ├── stores/              # Zustand stores（依赖注入 platform service）
│   │   │   ├── hooks/               # 可复用 Hooks
│   │   │   └── services/            # 🆕 平台服务接口定义
│   │   │       ├── platform.ts      # IPlatformService 接口
│   │   │       ├── tts-client.ts    # ITTSClient 接口
│   │   │       └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── ui/                          # 🆕 @readany/ui — 共享 UI 组件（可选）
│   │   └── src/                     # shadcn/ui 基础组件（12 个）
│   │
│   ├── foliate-js/                  # 电子书引擎（不变）
│   │
│   ├── app-desktop/                 # 原 app/，重命名
│   │   ├── src/
│   │   │   ├── components/          # 桌面端特有 UI
│   │   │   ├── services/
│   │   │   │   └── desktop-platform.ts  # 🆕 IPlatformService 桌面实现
│   │   │   └── App.tsx
│   │   └── src-tauri/               # Rust 桌面后端
│   │
│   └── app-mobile/                  # 🆕 移动端应用
│       ├── src/
│       │   ├── components/          # 移动端适配 UI（触控、Safe Area）
│       │   ├── services/
│       │   │   └── mobile-platform.ts   # 🆕 IPlatformService 移动端实现
│       │   └── App.tsx
│       └── src-tauri/               # Rust 移动后端
│           ├── src/
│           │   ├── lib.rs           # #[cfg(mobile)] 入口
│           │   ├── android/
│           │   └── ios/
│           ├── plugins/
│           │   ├── native-bridge/   # 原生桥接插件
│           │   └── native-tts/      # 原生 TTS 插件
│           └── gen/
│               ├── android/
│               └── apple/
```

---

## 五、平台服务接口设计

### 5.1 IPlatformService（核心接口）

```typescript
// packages/core/src/services/platform.ts

export interface IPlatformService {
  // ---- 平台信息 ----
  readonly platformType: 'desktop' | 'mobile' | 'web';
  readonly isMobile: boolean;
  readonly isDesktop: boolean;

  // ---- 文件系统 ----
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  writeTextFile(path: string, content: string): Promise<void>;
  readTextFile(path: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  getAppDataDir(): Promise<string>;
  joinPath(...parts: string[]): Promise<string>;
  convertFileSrc(path: string): string;

  // ---- 文件选择 ----
  pickFile(options?: FilePickerOptions): Promise<string | null>;

  // ---- 数据库 ----
  loadDatabase(path: string): Promise<IDatabase>;

  // ---- 网络（需要自定义 headers 的场景） ----
  fetch(url: string, options?: RequestInit): Promise<Response>;
  createWebSocket(url: string, options?: WebSocketOptions): Promise<IWebSocket>;

  // ---- 应用信息 ----
  getAppVersion(): Promise<string>;

  // ---- 更新（桌面端特有，移动端返回 noop） ----
  checkUpdate?(): Promise<UpdateInfo | null>;
  installUpdate?(): Promise<void>;
}

export interface IDatabase {
  execute(sql: string, params?: unknown[]): Promise<void>;
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export interface IWebSocket {
  send(data: string | ArrayBuffer): void;
  close(): void;
  onMessage(handler: (data: string | ArrayBuffer) => void): void;
  onClose(handler: () => void): void;
  onError(handler: (error: unknown) => void): void;
}
```

### 5.2 桌面端实现

```typescript
// packages/app-desktop/src/services/desktop-platform.ts

import type { IPlatformService, IDatabase, IWebSocket } from '@readany/core';

export class DesktopPlatformService implements IPlatformService {
  platformType = 'desktop' as const;
  isMobile = false;
  isDesktop = true;

  async readFile(path: string) {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    return readFile(path);
  }

  async loadDatabase(path: string) {
    const { default: Database } = await import('@tauri-apps/plugin-sql');
    const db = await Database.load(path);
    return {
      execute: (sql, params) => db.execute(sql, params ?? []),
      select: (sql, params) => db.select(sql, params ?? []),
      close: () => db.close(),
    } as IDatabase;
  }

  async createWebSocket(url: string, options?: WebSocketOptions) {
    const WS = await import('@tauri-apps/plugin-websocket');
    const ws = await WS.default.connect(url, { headers: options?.headers });
    // ... 包装为 IWebSocket
  }

  // ... 其余方法
}
```

### 5.3 移动端实现

```typescript
// packages/app-mobile/src/services/mobile-platform.ts

import type { IPlatformService } from '@readany/core';

export class MobilePlatformService implements IPlatformService {
  platformType = 'mobile' as const;
  isMobile = true;
  isDesktop = false;

  async readFile(path: string) {
    // Tauri 2 mobile 也支持 plugin-fs，但路径规则不同
    const { readFile } = await import('@tauri-apps/plugin-fs');
    return readFile(path);
  }

  async pickFile(options?: FilePickerOptions) {
    // 移动端使用原生文件选择器（通过 native-bridge 插件）
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string | null>('plugin:native-bridge|pick_file', options);
  }

  // checkUpdate 不实现（移动端走应用商店）
  checkUpdate = undefined;
  installUpdate = undefined;

  // ... 其余方法
}
```

---

## 六、迁移清单

### Phase 1：基础设施（1-2 天）

创建 `packages/core` 包骨架，迁移零依赖模块。

| 操作 | 源路径 | 目标路径 |
|------|--------|----------|
| 迁移 | `app/src/types/*` (10 个文件) | `core/src/types/` |
| 迁移 | `app/src/i18n/*` | `core/src/i18n/` |
| 迁移 | `app/src/lib/utils.ts` | `core/src/utils/utils.ts` |
| 迁移 | `app/src/lib/utils/debounce.ts` | `core/src/utils/debounce.ts` |
| 迁移 | `app/src/lib/utils/throttle.ts` | `core/src/utils/throttle.ts` |
| 迁移 | `app/src/lib/event-bus.ts` | `core/src/utils/event-bus.ts` |
| 迁移 | `app/src/lib/chat-utils.ts` | `core/src/utils/chat-utils.ts` |
| 新建 | — | `core/src/services/platform.ts` (IPlatformService 接口) |
| 新建 | — | `core/package.json`, `core/tsconfig.json` |

**验证点**：桌面端应用 import 从 `@readany/core` 正常编译运行。

### Phase 2：AI / RAG / 翻译模块（2-3 天）

这些模块完全平台无关，可以整体搬迁。

| 操作 | 源路径 | 目标路径 | 文件数 |
|------|--------|----------|--------|
| 迁移 | `app/src/lib/ai/*` | `core/src/ai/` | 14 |
| 迁移 | `app/src/lib/rag/chunker.ts` | `core/src/rag/chunker.ts` | 1 |
| 迁移 | `app/src/lib/rag/embedding-service.ts` | `core/src/rag/embedding-service.ts` | 1 |
| 迁移 | `app/src/lib/rag/embedding.ts` | `core/src/rag/embedding.ts` | 1 |
| 迁移 | `app/src/lib/rag/search.ts` | `core/src/rag/search.ts` | 1 |
| 迁移 | `app/src/lib/rag/vectorize-trigger.ts` | `core/src/rag/vectorize-trigger.ts` | 1 |
| 迁移 | `app/src/lib/rag/vectorize.ts` | `core/src/rag/vectorize.ts` | 1 |
| 迁移 | `app/src/lib/translation/*` | `core/src/translation/` | 4 |
| 迁移 | `app/src/lib/stats/*` | `core/src/stats/` | 1 |
| 迁移 | `app/src/lib/export/*` | `core/src/export/` | 1 |
| 迁移 | `app/src/lib/sync/*` | `core/src/sync/` | 1 |

**需要适配的文件**：
- `rag/book-extractor.ts` — 内部用了 `@tauri-apps/plugin-fs` 读取文件，需改为通过 `IPlatformService.readFile()` 注入

**验证点**：AI 对话、RAG 向量化、翻译功能正常。

### Phase 3：数据库抽象层（3-5 天）

这是最关键的一步，需要将 `db/database.ts`（1135 行）中的 Tauri SQL 调用替换为 `IDatabase` 接口。

| 操作 | 说明 |
|------|------|
| 新建 | `core/src/db/types.ts` — `IDatabase` 接口定义 |
| 重构 | `core/src/db/database.ts` — 所有查询函数接收 `IDatabase` 实例而非直接调用 Tauri SQL |
| 迁移 | `app/src/lib/db/schema.sql` → `core/src/db/schema.sql` |
| 迁移 | `app/src/lib/db/migrations.ts` → `core/src/db/migrations.ts`（改用 IDatabase） |
| 保留 | 桌面端 `app-desktop` 中创建 `TauriDatabase` 实现 `IDatabase` |

**关键改造示例**：

```typescript
// 改造前（直接依赖 Tauri）
export async function getBooks(): Promise<Book[]> {
  const Database = (await import("@tauri-apps/plugin-sql")).default;
  const db = await Database.load("sqlite:readany.db");
  return db.select("SELECT * FROM books");
}

// 改造后（依赖注入）
export function createBookRepository(db: IDatabase) {
  return {
    async getBooks(): Promise<Book[]> {
      return db.select("SELECT * FROM books");
    },
    // ...
  };
}
```

**验证点**：所有数据库 CRUD 操作正常，数据迁移正常。

### Phase 4：TTS 抽象层 + Reader 模块（2-3 天）

| 操作 | 说明 |
|------|------|
| 新建 | `core/src/services/tts-client.ts` — `ITTSClient` 接口 |
| 重构 | TTS 核心逻辑迁移到 core，Edge TTS / DashScope TTS 中的 Tauri HTTP/WS 调用改为通过 `IPlatformService` |
| 迁移 | `lib/reader/` 中的 6 个平台无关文件 → `core/src/reader/` |
| 保留 | `lib/reader/book-cache.ts` 留在各端实现（依赖 `convertFileSrc` + `readFile`） |

**移动端额外实现**：
- 原生 TTS 插件（iOS: AVSpeechSynthesizer, Android: TextToSpeech）

### Phase 5：Stores 迁移（2-3 天）

| Store | 处理方式 |
|-------|----------|
| `app-store.ts` | ✅ 直接迁移到 core（纯净） |
| `chat-reader-store.ts` | ✅ 直接迁移到 core（纯净） |
| `notebook-store.ts` | ✅ 直接迁移到 core（纯净） |
| `reader-store.ts` | ✅ 直接迁移到 core（纯净） |
| `settings-store.ts` | 🔧 重构 `persist.ts`，使用 `IPlatformService` 替代直接的 Tauri FS 调用 |
| `vector-model-store.ts` | 🔧 同上 |
| `tts-store.ts` | 🔧 同上 + 使用 `ITTSClient` 抽象 |
| `annotation-store.ts` | 🔧 改用 `IDatabase` |
| `chat-store.ts` | 🔧 改用 `IDatabase` |
| `reading-session-store.ts` | 🔧 改用 `IDatabase` |
| `library-store.ts` | 🔧 最复杂：改用 `IPlatformService`（FS + Path + DB） |
| `persist.ts` | 🔧 核心重构：改用 `IPlatformService.writeTextFile/readTextFile` |

**关键改造：persist.ts**

```typescript
// 改造前
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';

// 改造后
import { getPlatformService } from '@readany/core';

export function createPersistMiddleware() {
  const platform = getPlatformService();
  return {
    save: (key, data) => platform.writeTextFile(`${key}.json`, JSON.stringify(data)),
    load: (key) => platform.readTextFile(`${key}.json`).then(JSON.parse),
  };
}
```

### Phase 6：Hooks 迁移（1 天）

| Hook | 处理方式 |
|------|----------|
| `use-debounce.ts` | ✅ 直接迁移（纯 React） |
| `use-drag.ts` | ✅ 直接迁移（纯 React） |
| `use-keyboard.ts` | ✅ 直接迁移（纯 React） |
| `use-throttled-value.ts` | ✅ 直接迁移（纯 React） |
| `reader/useFoliateView.ts` | ✅ 直接迁移（纯类型） |
| `reader/useFoliateEvents.ts` | ✅ 直接迁移（纯 React） |
| `reader/usePagination.ts` | ✅ 直接迁移（纯 React） |
| `reader/useBookShortcuts.ts` | ⚠️ 桌面端保留（移动端无键盘快捷键） |
| `use-reading-session.ts` | 🔧 间接依赖 stores，stores 迁移后自动跟随 |
| `use-streaming-chat.ts` | 🔧 间接依赖 db，db 抽象后自动跟随 |
| `useTranslator.ts` | 🔧 间接依赖 stores，stores 迁移后自动跟随 |

### Phase 7：创建移动端应用（5-7 天）

| 步骤 | 说明 |
|------|------|
| 1 | `pnpm create tauri-app` 创建 `app-mobile` 包，启用 iOS + Android |
| 2 | 实现 `MobilePlatformService` |
| 3 | 编写 Rust `lib.rs`，添加 `#[cfg(mobile)]` 条件编译 |
| 4 | 创建 `tauri-plugin-native-bridge`（Kotlin + Swift） |
| 5 | 创建 `tauri-plugin-native-tts`（Kotlin + Swift） |
| 6 | 适配移动端 UI：触控手势、Safe Area、响应式布局 |
| 7 | 测试 foliate-js 在 WebView 中的兼容性 |

---

## 七、Rust 后端改造

### 7.1 桌面端 `lib.rs`（改动小）

```rust
// packages/app-desktop/src-tauri/src/lib.rs
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::init())      // 仅桌面
        .plugin(tauri_plugin_process::init())       // 仅桌面
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running");
}
```

### 7.2 移动端 `lib.rs`（新建）

```rust
// packages/app-mobile/src-tauri/src/lib.rs

#[cfg(target_os = "android")]
mod android;

#[cfg(target_os = "ios")]
mod ios;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_websocket::init());

    // 移动端专用插件
    #[cfg(mobile)]
    let builder = builder
        .plugin(tauri_plugin_native_bridge::init())
        .plugin(tauri_plugin_native_tts::init());

    builder.run(tauri::generate_context!()).expect("error while running");
}
```

---

## 八、技术决策：继续使用 Tauri 2，不急于 Fork

### 8.1 决策背景

Readest fork 了 Tauri 核心 + 2 个插件。经深入分析，fork 的具体原因：

| Fork 项 | 原因 | 对 ReadAny 的影响 |
|---------|------|-------------------|
| **`BackgroundThrottlingPolicy`** | WebView 切后台被系统节流，TTS 播放中断 | ✅ ReadAny 也有 TTS，会遇到同样问题 |
| **`background_color` / `Color`** | 防止深色主题窗口创建时白色闪烁 | ⚠️ 体验优化，非阻塞 |
| **`deep-link` 插件** | 自定义 URL scheme + 单实例文件传递 | ❌ 暂不需要 |
| **`single-instance` 插件** | 双击 .epub 文件传参给已运行实例 | ❌ 暂不需要 |

**核心结论：Readest fork Tauri 的最关键原因是后台 TTS 不中断，其他都是锦上添花。**

### 8.2 不换技术栈的理由

| 替代方案 | 代价 | 问题 |
|---------|------|------|
| **React Native** | 前端全部重写 | 丢失 foliate-js 生态，WebView 渲染电子书还是得嵌 |
| **Flutter** | 全部重写 | 前端 + Rust 后端全废，代价最大 |
| **Capacitor/Ionic** | 迁移成本中等 | 没有 Rust 后端能力，SQLite 性能差 |
| **继续 Tauri 2** | **最低改动** | 已有 88% 代码平台无关，Readest 已验证可行性 |

ReadAny 的核心资产是 **TypeScript 业务逻辑（AI/RAG/TTS/翻译）+ Rust 后端 + foliate-js**，换任何其他技术栈都意味着丢弃大量已有代码。

### 8.3 不立刻 Fork Tauri 的理由

| 问题 | Readest 的做法 | ReadAny 先这样做 |
|------|---------------|-----------------|
| **后台 TTS 中断** | Fork Tauri 加 `BackgroundThrottlingPolicy` | 移动端先用**原生 TTS 插件**（iOS AVSpeechSynthesizer / Android TextToSpeech），不走 WebView |
| **窗口白色闪烁** | Fork Tauri 加 `background_color` | 用 CSS `html { background: #000 }` + Tauri `backgroundColor` 配置项（v2.1+ 已部分支持） |
| **文件关联打开** | Fork deep-link + single-instance | 先不做文件关联，用 app 内导入 |

### 8.4 渐进式策略

```
Phase A: 不 fork，用标准 Tauri 2 跑通移动端基础功能
         └── 验证 foliate-js WebView 兼容性
         └── 验证 SQLite plugin-sql 在移动端表现
         └── 用原生 TTS 替代 WebView TTS

Phase B: 遇到真正无法绕过的问题时，针对性 fork
         └── 比如后台 TTS 必须用 WebView 方案 → 才 fork Tauri 加 throttling
         └── 大概率可以通过原生 TTS 插件完全绕过

Phase C: 跟踪 Tauri 上游进展
         └── Tauri v2.x 持续在加移动端功能
         └── 一些 Readest fork 的功能可能会进入上游
```

### 8.5 Readest 移动端成熟度参考

Readest 的移动端已经是**生产级别**（Google Play + App Store 已上架），表明 Tauri 2 移动端路线是完全可行的：
- 完整的 IAP 内购（StoreKit + Google Billing）
- 2 个自研原生插件（各含 Kotlin + Swift 实现）
- 50+ 文件含移动端适配代码
- CI/CD 完善（Fastlane + GitHub Actions）
- 仅 8 个边缘 FIXME

---

## 九、风险评估与应对（含技术栈风险）

| 风险 | 严重度 | 应对方案 |
|------|--------|----------|
| **Hugging Face Transformers 移动端性能差** | 高 | 移动端默认使用云端嵌入 API，降级方案：关闭本地 RAG |
| **LangChain 包体积大** | 中 | Tree-shaking + 按需 dynamic import，移动端可精简 AI 功能 |
| **foliate-js iframe 在 mobile WebView 中的兼容性** | 高 | 提前测试，必要时 fork 修改（参考 Readest 的做法） |
| **Tauri 2 Mobile 的 Bug / 不成熟** | 中 | 跟踪 Tauri 2 的 Release，必要时 fork Tauri（参考 Readest） |
| **Edge TTS WebSocket 在移动端的连接稳定性** | 中 | 增加原生 TTS 作为 fallback |
| **数据库路径差异（iOS 沙盒 / Android 外部存储）** | 低 | 通过 `IPlatformService.getAppDataDir()` 统一处理 |
| **重构期间桌面端回归 Bug** | 中 | 每个 Phase 完成后运行全量功能测试 |

---

## 十、依赖关系图

```
                    ┌─────────────────┐
                    │  @readany/core │
                    │                 │
                    │  types/         │ ← 零依赖
                    │  i18n/          │ ← 零依赖
                    │  utils/         │ ← 零依赖
                    │  ai/            │ ← 依赖 types, langchain
                    │  rag/           │ ← 依赖 types, ai, IPlatformService(readFile)
                    │  translation/   │ ← 依赖 types
                    │  tts/           │ ← 依赖 IPlatformService(fetch, ws)
                    │  reader/        │ ← 依赖 types
                    │  db/            │ ← 依赖 IDatabase
                    │  stores/        │ ← 依赖 db, IPlatformService
                    │  hooks/         │ ← 依赖 stores
                    │  services/      │ ← 接口定义（无实现）
                    └────────┬────────┘
                             │
                ┌────────────┼────────────┐
                │            │            │
        ┌───────▼──────┐   ...   ┌───────▼──────┐
        │ app-desktop  │         │  app-mobile  │
        │              │         │              │
        │ Desktop      │         │ Mobile       │
        │ Platform     │         │ Platform     │
        │ Service      │         │ Service      │
        │ (Tauri       │         │ (Tauri       │
        │  Desktop)    │         │  Mobile +    │
        │              │         │  Native      │
        │ Desktop UI   │         │  Plugins)    │
        │ Components   │         │              │
        │              │         │ Mobile UI    │
        │ Rust Backend │         │ Components   │
        │ (updater,    │         │              │
        │  window-     │         │ Rust Backend │
        │  state)      │         │ (native-     │
        └──────────────┘         │  bridge,     │
                                 │  native-tts) │
                                 └──────────────┘
```

---

## 十一、时间估算

| Phase | 内容 | 预估时间 | 累计 |
|-------|------|----------|------|
| 1 | 基础设施 + 零依赖模块 | 1-2 天 | 1-2 天 |
| 2 | AI / RAG / 翻译模块 | 2-3 天 | 3-5 天 |
| 3 | 数据库抽象层 | 3-5 天 | 6-10 天 |
| 4 | TTS 抽象层 + Reader | 2-3 天 | 8-13 天 |
| 5 | Stores 迁移 | 2-3 天 | 10-16 天 |
| 6 | Hooks 迁移 | 1 天 | 11-17 天 |
| 7 | Components 迁移 | 2-3 天 | 13-20 天 |
| 8 | 创建移动端应用 | 5-7 天 | 18-27 天 |

**总计预估：18-27 个工作日**（约 4-6 周）

---

## 十二、pnpm workspace 配置变更

```yaml
# pnpm-workspace.yaml
packages:
  - "packages/*"
```

```json
// packages/core/package.json
{
  "name": "@readany/core",
  "version": "1.0.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "zustand": "^5.x",
    "i18next": "^24.x",
    "react-i18next": "^15.x",
    "@langchain/openai": "...",
    "@langchain/anthropic": "...",
    "@langchain/langgraph": "...",
    "zod": "..."
  },
  "peerDependencies": {
    "react": "^19.0.0"
  }
}
```

桌面端/移动端通过 workspace 协议引用：

```json
// packages/app-desktop/package.json
{
  "dependencies": {
    "@readany/core": "workspace:*",
    "@tauri-apps/api": "^2.x",
    "@tauri-apps/plugin-sql": "^2.x",
    "@tauri-apps/plugin-fs": "^2.x"
  }
}
```
