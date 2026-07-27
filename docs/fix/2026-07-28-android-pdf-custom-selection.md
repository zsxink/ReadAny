# Android PDF 文字选区修复方案（自定义触摸选区）

> 分支：`fix/android-pdf-custom-selection`（基于 `fix/android-pdf-text-selection`）
> 目标：让 Android WebView 下的 PDF **能选词、能复制**，且不破坏「文字层与视图层（canvas）像素对齐」这一前提。

## 1. 背景与根因（已确认）

PDF 阅读为三层结构：

- **视图层（canvas）**：`#canvas` 内的位图，渲染可见字形。
- **文字层（`.textLayer`）**：每个字一个 `<span style="position:absolute; transform: rotate() scaleX() scale()">`，透明文字，按 viewport 坐标**精确叠在 canvas 上**，供搜索/选区/无障碍使用。
- **标注层（`.annotationLayer`）**：链接、高亮等。

**根因**：Android WebView 的原生长按选区引擎，**无法在「被 `transform` 缩放 + `position:absolute`」的文本上发起选区**（iOS 的 WKWebView 不受此限，所以 PDF 在 iOS 正常；EPUB 文字是静止时无 transform 的文档流，所以全平台正常）。

`fix/android-pdf-text-selection` 的 4 个提交：
- ① 手势让位（触摸不进平移、`touchmove` 不 `preventDefault`、下拉书签手势在 textLayer 内 suppressed、关 WebView 缩放/overscroll）——**正确，保留**。
- ④ `stabilizeTextLayerGeometry()` 把 `--min-font-size`/`--font-height` 的 CSS 变量 calc 换成**显式数字**，使文字层几何与 canvas **完全一致**——**正确，保留，且是自定义选区的地基**。
- ② 结构/CSS 稳定；③ pdf.js 升 5.5.207（仅换行，transform 规则保留）。
- **它们都没移除逐字 `transform`/`position:absolute`**，所以原生选区在 Android 上从「发起」第一步就起不来，几何再稳也没用。

## 2. 方案核心

**不依赖 Android 原生选区，改为「用触摸坐标程序化构造选区」**：

1. 在 PDF 文字层上监听 `touchstart`/`touchmove`，利用各 span 的 `getBoundingClientRect()`（经 ④ 稳定后**与 canvas 对齐**）算出触摸点覆盖的 span 与字符偏移；
2. 手工构造 `Range` → `doc.getSelection().addRange(range)`；
3. 原生 `::selection` 高亮（pdf.js 已有样式）自动出现，且 `selectionchange` 触发 → `reader.template.html` 的 `attachSelectionListener` 把选区 `postToRN('selection', …)` 给 RN → 工具条弹出（复制/翻译等）。

即：**对齐交给 ④ 保住，发起选区的活儿换成自定义的**。

## 3. 实现细节（改 `packages/foliate-js/pdf.js` 的 `render()`）

在 `render()` 内、文本层渲染完成后，用已有的 `{ signal }`（`doc.__readanyPdfTextSelectionAbortController.signal`）挂载监听，复用 `stabilizeTextLayerGeometry` 之后的几何。

### 3.1 平台判定
- 在 pdf.js 内加一个极简 `isIOS()`（参照模板里 `isIOSLike` 的 UA 判断），因为 pdf.js 收不到平台参数。
- 自定义触摸选区**仅对非 iOS 的 touch 指针生效**；iOS 继续走原生，桌面走原生鼠标选区。

### 3.2 坐标 → 字符位置
新增 `pointToPosition(point)`：
- 遍历 `textContainer.querySelectorAll('span')`；对每个 span `rect = span.getBoundingClientRect()`（已与 canvas 对齐）。
- 找到包含 `(clientX, clientY)` 的 span；在该 span 文本节点内按 x 比例算字符偏移：
  `offset = clamp(round((clientX - rect.left) / rect.width * textContent.length), 0, len)`。
- 跳过空文本、`role="img"`、`endOfContent`。
- 若没有 span 包含该点，取最近 span，按左右侧把 offset 钳到 0 或 len。
- 返回 `{ node: span.firstChild, offset }`。

### 3.3 手势流程
- **`touchstart`**（在 `textContainer` 上，`passive:false` 以便必要时 `preventDefault`）：若触摸目标落在 `.textLayer` 内（`closest('.textLayer')`），记录 `anchor = pointToPosition(touch)`；先不 `preventDefault`，允许其它位置滚动。
- **`touchmove`**（在 `textContainer` 上，`passive:false`）：若 textLayer 内触摸移动超过阈值（≈6px）→ `selecting = true`；`e.preventDefault()` 阻止页面滚动/橡皮筋；`focusPoint = pointToPosition(touch)`；构造 `range.setStart(anchor.node, anchor.offset)`、`range.setEnd(focusPoint.node, focusPoint.offset)`（顺序自动归一化）；`doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range)`。多行拖选时，DOM 顺序的两个点之间的所有 span 会被 Range 自动覆盖。
- **`touchend`**：若 `selecting` 且 `getSelection().toString().length > 0` → 定稿，保留选区并给 `textContainer` 加 `.selecting` 类（沿用现有行为，关掉标注层 pointer-events）；若未进入 `selecting`（只是点一下）→ `getSelection()?.removeAllRanges()` 清除选区。

### 3.4 复用与清理
- 文本内容的提取直接复用已有的 `getSelectedText(selection, textContainer)`（经 `selectionchange` 管线传给 RN）。
- 监听用 `{ signal }` 挂载，重渲染时随 AbortController 自动卸载（与现有 `selectionchange` 监听一致）。

## 4. 关键约束（必须遵守）

1. **绝不直接手改 `reader.html`**——它是 `scripts/build-reader.js` 把 `reader.template.html` + `foliate-js/*.js` 经 esbuild 打包生成的产物。改完源码必须重打包：
   ```
   cd packages/app-expo && node scripts/build-reader.js
   # 或：pnpm run build:reader
   ```
2. **保留三层对齐**：不要移除 span 的 `transform`/`position:absolute`（那会破坏与 canvas 的对齐，正是本方案要避免的）。自定义选区通过读取 `getBoundingClientRect()` 在「带 transform」的前提下工作。
3. **保留 ① 的手势让位**：触摸不进平移、下拉手势在 textLayer 内 suppressed，不要回退。
4. 自定义选区只挂在 PDF 的 `render()` 内、且限定非 iOS 的 touch，不影响 EPUB。

## 5. 需改动文件

- `packages/foliate-js/pdf.js`：在 `render()` 内新增自定义触摸选区逻辑（主改动）。
- `packages/app-expo/assets/reader/reader.template.html`：按需微调 `attachSelectionListener` 对**程序化选区**的响应（很可能已可用，因为 `selectionchange` 会照常触发；仅当程序化选区未被正确 post 给 RN 时才改）。
- `reader.html`：**只通过构建脚本重新生成，不手改**。

## 6. 构建与验证

- 改完源码后：`cd packages/app-expo && node scripts/build-reader.js`。
- 校验 `reader.html` 已重新生成且包含新的选区代码；若 esbuild 报语法错会直接失败。
- 跑 `pnpm -C packages/foliate-js` 的 lint/类型检查（如有）。
- **注意**：Android 真机验证需出包，本环境无法跑；sub-agent 至少保证打包通过、逻辑自洽，并明确标注「需真机验证」。

## 7. 验收标准

- Android 上长按/拖动 PDF 文字 → 出现选区高亮 + 工具条（复制可用）。
- 选区高亮与 canvas 显示的字形**严丝合缝**（对齐未被破坏）。
- iOS / EPUB 选区行为不受影响。
