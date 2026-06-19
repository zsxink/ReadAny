# 2026-06-19 Android 构建失败修复

## 问题

`v1.3.4.0` tag 触发的 Release CI，`build-android` job 连续失败（8次）。

## 根因分析

### 第一层错误：Metro bundler 找不到模块

```
Error: Unable to resolve module ../../../modules/volume-key-paging
from .../src/screens/reader/useVolumeButtonPaging.ts
```

`useVolumeButtonPaging.ts` 中的 import 路径硬编码为：

```ts
import VolumeKeyPaging from "../../../modules/volume-key-paging";
```

但模块实际已被移动到 `native-modules/volume-key-paging/`，路径不匹配。

### 第二层错误（早期尝试中出现）：Kotlin 编译失败

```
Unresolved reference 'volumekeypaging'
```

`MainActivity.kt`（Expo prebuild 生成）中引用的 native module 包名找不到，说明 autolinking 也存在问题。

### 根本原因

历史提交记录显示 `volume-key-paging` 模块经历了多次位置迁移：

1. 最初在 `modules/` → 被 `.gitignore` 排除（`/android/` 规则误伤）
2. 移到 `native-modules/` → 规避了 gitignore 问题
3. 但 `useVolumeButtonPaging.ts` 的 import 路径没有同步更新

## 修复方案

```diff
- import VolumeKeyPaging from "../../../modules/volume-key-paging";
+ import VolumeKeyPaging from "@readany/volume-key-paging";
```

使用包名而非相对路径引用，理由：

1. `package.json` 已声明 `"@readany/volume-key-paging": "file:./native-modules/volume-key-paging"`
2. 包名引用不依赖目录结构，后续再迁移位置不受影响
3. Metro bundler 能正确通过 node_modules 解析 `file:` 依赖

## 版本一致性说明

CI 有 `Verify version consistency` 步骤（`scripts/bump-version.js --check`），校验以下文件版本号是否一致：

- `packages/app/package.json`
- `packages/app/src-tauri/tauri.conf.json`
- `packages/app/src-tauri/Cargo.toml`
- `packages/app-expo/package.json`

该检查**只验证文件间一致**，不验证与 git tag 是否匹配，因此 `1.3.4` tag 为 `v1.3.4.1` 不会触发该步骤失败。

## 提交记录

- **Commit**: `8b47b81` — `fix(android): use package name import for volume-key-paging`
- **Tag**: `v1.3.4.1`

## 验证

推送后 CI 触发，`build-android` job 通过。
