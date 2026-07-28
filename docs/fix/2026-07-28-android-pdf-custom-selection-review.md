# Android PDF 自定义触摸选区 —— 方案与实现复核报告

> 复核对象：分支 `fix/android-pdf-custom-selection`（HEAD `ad7027b3`）
> 复核日期：2026-07-28
> 复核方式：项目代码逐行核对 + pdf.js 5.5.207（pdfjs-dist）源码/官方 CSS + W3C/CSSOM 规范与 MDN + pdf.js 官方 issue/bugzilla 佐证
> 最终要求：**PDF 文字图层位置、大小与视图层（canvas）一致；可以复制。**
>
> **独立复核更新（2026-07-28）：初版“移动 6px 即拖选”会劫持普通滚动/翻页，
> 不能直接发布。当前实现已改为 Android 专属的 500ms 长按选区。§8 为最新结论，
> 与 §2/§3 中描述初版 6px 方案的内容冲突时，以 §8 为准。**

---

## 0. 结论

**“程序化构造 Range”方向成立，但初版 6px 拖选方案不成立；修正后的长按方案在
代码与静态验证层面满足「对齐 + 可复制」，发布前仍需 Android 真机验收。**

- 文字层与 canvas 对齐：本方案**不改动任何几何**，逐字 span 的 `transform`/`position:absolute` 全部保留，`stabilizeTextLayerGeometry()` 的显式数值公式与 pdf.js 官方 calc 公式**数学等价**（已逐项对照官方 `pdf_viewer.css`）。自定义选区只**读** `getBoundingClientRect()`，不写几何。
- 可以复制：复制链路为「500ms 长按 → 程序化 `addRange` → `selectionchange` → 模板 `emitSelection` → `postToRN('selection', {text})` → RN `SelectionPopover` → `Clipboard.setStringAsync(selection.text)`」，**不依赖 Android WebView 原生选区/原生复制菜单**，绕开根因成立。
- 不影响普通手势：手指在 500ms 内移动超过 10px 会取消待选状态且不
  `preventDefault()`，原滚动/翻页继续；只有长按已激活选区后才锁定导航并阻止滚动。
- 平台范围：自定义触摸分支只在 Android UA 下挂载；iOS、桌面及其他触屏平台继续
  使用原生选区，EPUB 路径不进入 PDF `render()`。

独立 sub agent 发现 **2 个 P1**（滚动/翻页劫持、平台门控过宽）和 **2 个 P2**
（多指误入、轻触清空已有选区）；当前源码已逐项修复。复制文本提取、坐标精度和
span 几何缓存也已落实。

**Android 真机验证仍是必要前提**（本环境无法跑 WebView），验证清单见 §6。

---

## 1. 方案可行性复核（对照三方库源码 / 官方文档）

### 1.1 根因声称的外部佐证

方案根因：Android WebView 原生长按选区引擎无法在「`transform` 缩放 + `position:absolute`」的逐字 span 上发起选区。

- 公开渠道未找到 Chromium bug 单逐字确认这一句话；但 **pdf.js 官方明确承认** textLayer 的 absolute 定位结构在 Chrome 上导致选区问题，且官方 workaround 就是移动 `.endOfContent` 元素（与本项目 `moveEndOfContent` 同源）：
  > "The current text layer approach based on absolutely positioned elements by default **causes flickering with text selection**, and we have **browser-specific workarounds** to solve that. In Chrome, the workaround involves moving the .endOfContent element…"
  > —— Bugzilla [1960251](https://bugzilla.mozilla.org/show_bug.cgi?id=1960251)，pdf.js 提交 *"[chrome] Fix text selection with .markedContent"*（2025-04）
- 该提交还记载了 Chrome 在 "per-character mode"（点拖）与 "per-word mode"（双击拖）下锚定 `.markedContent` 边界不同导致的 **selectionchange → 移动 endOfContent → 再 selectionchange 死循环** 问题；官方修复是"回退到第一个非空元素"。本项目 `moveEndOfContent()`（pdf.js:453-458）已包含同款 `range.endOffset === 0` 回退逻辑 ✅。
- 移动端 pdf.js 选区不可靠有多方报告（ngx-extended-pdf-viewer #116 等）；「**用坐标命中程序化构造选区**」是业界成熟绕过方案（readpaper 等对 pdf.js 文本层的重写即此思路）。
- 结论：根因方向可信，且即使根因描述留有余地，「不依赖原生选区」的方案在工程上也是**确定性更强**的做法。措辞建议：根因宜表述为「不可靠/无法稳定发起」而非绝对「无法」。

### 1.2 关键技术前提逐项验证

| 方案依赖的前提 | 验证依据 | 结论 |
|---|---|---|
| `getBoundingClientRect()` 返回 **transform 之后** 的视口坐标包围盒 | CSSOM View Module（`dom-element-getboundingclientrect`）：返回元素 border-box 的并集（相对视口）；CSS Transforms 应用于视觉渲染盒。触摸监听挂在 iframe 内 `textContainer`，`touch.clientX/Y` 与 rect 同属 iframe 视口坐标系 | ✅ 成立，坐标系一致 |
| 程序化 `selection.addRange()` 触发 `selectionchange` | W3C Selection API：document 的 selection 任何变化（含程序化）均异步派发 `selectionchange`。模板 `attachSelectionListener`（reader.template.html:2583）据此工作 | ✅ 成立 |
| 程序化选区会渲染 `::selection` 高亮 | UA 对 selection 的标准绘制行为；foliate-js 内联 CSS 已有 `.textLayer ::selection { background: rgba(0,100,255,0.3) }`（pdf.js:66-68） | ✅ 成立 |
| 文字 span 未被 `user-select:none` 覆盖 | 内联 CSS 仅 `span[role="img"]` 与 `.endOfContent` 设 `user-select:none`（pdf.js:65,70-77）；pdf.js 5.5.207 `#appendText` 给文字 span 设的是 `role="presentation"`（pdf.mjs:14234） | ✅ 普通文字可选 |
| pdf.js 5.5.207 span 结构（`--font-height`/`--scale-x`/`--rotate`、EOL 插 `<br>`） | pdf.mjs:14231/14291/14295（CSS 变量）、14263-14267（`<br>`） | ✅ 与本项目代码假设一致 |
| `selectionchange` 管线对程序化选区照常 post 给 RN | 模板 `selectionchange` handler 300ms 防抖后 `emitSelection`（template:2583-2599），不区分选区来源；iOS 专用 hack 有 `isIOSLike` 门控（template:2564），不干扰 Android | ✅ 方案 §5「很可能已可用」判断正确，模板无需改 |

### 1.3 对齐地基：④ 的公式与官方 calc 公式等价性（最终要求 1 的核心）

pdf.js 5.5.207 官方 `pdf_viewer.css`：

```css
.textLayer { --min-font-size:1; --text-scale-factor:calc(var(--total-scale-factor) * var(--min-font-size)); --min-font-size-inv:calc(1 / var(--min-font-size)); }
.textLayer > :not(.markedContent), … {
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}
```

本项目 `stabilizeTextLayerGeometry()`（pdf.js:197-218）逐 span 改写为显式数字：

- `fontSize = fontHeight * totalScaleFactor * minimumFontSize` —— 与官方 `calc(text-scale-factor * font-height)` **完全等价**；
- `transform = rotate(rotate) scaleX(scaleX) scale(1/minimumFontSize)` —— 与官方 **完全等价**。

区别仅在于把 CSS Values 4 的 calc 类型乘除（旧 Android WebView 对 `calc(1 / var())` 除法支持不佳）提前算成数值；`minimumFontSize` 用 1px 探针在 iframe 内实测（规避 WebView 最小字号钳制，pdf.js 官方同款 trick）。**对齐地基可靠，本方案未触碰它** ✅。

---

## 2. 代码实现符合度复核（逐条对照方案 §3）

| 方案条款 | 实现位置（pdf.js） | 符合度 |
|---|---|---|
| §3.1 `isIOS()` 极简判定，自定义选区仅非 iOS touch | `isIOS()`（133-142），与模板 `isIOSLike` 判定一致；`if (!isIOS())` 门控（604） | ✅ |
| §3.2 `pointToPosition`：命中 span 按 x 比例算偏移、clamp | 609-649；`Math.round((x-rect.left)/rect.width*len)` + clamp（628-634） | ✅ |
| §3.2 跳过空文本、`role="img"`、`endOfContent` | 614/615/619 行；另跳过 `rect` 全零（含 `display:contents` 的 `.markedContent` span） | ✅ |
| §3.2 无命中取最近 span、按左右钳 0/len | 637-646（中心点距离最近） | ✅ |
| §3.3 `touchstart` 记录 anchor、不 preventDefault | 665-676（`passive:false` 但未调用 preventDefault） | ✅ |
| §3.3 `touchmove` 超阈值(6px)进入选词、preventDefault、构造归一化 Range、addRange | 678-705；`normalizeBoundaryOrder` 用 `compareDocumentPosition` 处理跨 span（652-659） | ✅ |
| §3.3 `touchend` 定稿加 `.selecting` / 单击清选区 | `finishCustomSelection`（707-722），touchend+touchcancel 均挂 | ✅ |
| §3.4 监听挂 `{ signal }` 随重渲染卸载 | 全部 `addEventListener` 带 `signal`（`__readanyPdfTextSelectionAbortController`，403-406） | ✅ |
| §4.1 reader.html 只经构建脚本生成 | `node scripts/build-reader.js` 重跑，产物与 HEAD 哈希一致（`790748bc…`，幂等）；本次 lint 修复后已重建 | ✅ |
| §4.2 不动 span transform/absolute | diff 确认仅新增代码，`stabilizeTextLayerGeometry` 与 CSS 未改 | ✅ |
| §4.3 手势让位保留 | `onpointerdown` 触摸不进平移（515-554，`isTouch` 分支）；模板下拉书签手势在 `.textLayer` 内 `suppressed`（template:2431,2440,2446） | ✅ |
| §4.4 仅 PDF render() 内、非 iOS touch、不影响 EPUB | 仅 `render()` 内挂载，EPUB 路径无此代码 | ✅ |

### 手势/事件冲突矩阵（推演验证）

| 场景 | 链路推演 | 结论 |
|---|---|---|
| 拖选松手 | touchmove 阶段选区已存在 → 模板 capture 阶段 `touchmove` 立即 `markSelectionInteraction(true)` → tap 检测作废；touchend 不翻页 | ✅ |
| 轻点文字（未拖） | 无 addRange，无选区；`finishCustomSelection` 清选区；tap 正常（中间弹工具条/边缘翻页） | ✅ |
| 已有定稿选区，再点文字 | tap 检测因 `__readany_selection_interaction` 抑制；`finishCustomSelection` 清选区 → `selectionCleared` 收起工具条 | ✅ |
| 下拉书签手势 | touchstart 在 `.textLayer` 内 → `suppressed:true`，不抢手势；capture 先跑但不 preventDefault | ✅ |
| pointerup vs touchend 顺序 | `resetEndOfContent`（pointerup）只复位 endOfContent/摘 `.selecting` 类，**不清选区**；touchend 再按需加回类 | ✅ |
| iOS / 桌面 | iOS 走原生 + 模板 iOS hack；桌面走鼠标原生选区，自定义逻辑不挂 | ✅ |

---

## 3. 发现的偏差与风险（按严重度排序）

### P1 ｜ 方案 §3.4 描述与实现不符：复制文本提取并未「复用 `getSelectedText`」

- **实际链路**：RN 复制按钮用的是 `emitSelection` 里的 `getRangeTextWithoutRuby(range, sel.toString())`（template:2682-2692），其 `fragment.textContent` **不会把 `<br>` 转成换行**，也**不做** `pdfjsLib.normalizeUnicode` / 去 NULL（`\0`）占位符处理。
- `getSelectedText(selection, textContainer)`（pdf.js:235-313，带按行排序 + 换行 + 归一化）只在 WebView 内 `copy` 事件（`handleCopy`）使用——Android 上 RN 复制**不经过它**。
- **影响**：功能上「能复制」✅；但**多行选区复制出的文本行与行粘连无换行**，且可能残留 `\0`（pdf.js 文本层常见占位符，本项目 `removeNullCharacters` 就是为它写的）。EPUB 不受影响（本就单段流式）。
- **建议修复**（二选一）：
  a. 模板 `emitSelection` 对 PDF 文档改调 `getSelectedText`（需把 pdf.js 内函数暴露到 `doc` 上，如 `doc.__readanyGetSelectedText = (sel) => getSelectedText(sel, textContainer)`，模板检测调用）；
  b. 最低成本：`getRangeTextWithoutRuby` 里把 fragment 的 `<br>` 替换为 `\n` 文本节点再取 textContent，并对 PDF 结果过一遍 `normalizeUnicode`/去 `\0`。
- 注：此问题在上一分支（原生选区）同样存在，不是本次引入的回归，但本次方案文档把它写错了，应趁此修正。

### P2 ｜ 字符偏移按 span 宽度线性比例，精度为近似

- `offset = round((x-rect.left)/rect.width * len)` 假设字符等宽：**中文等宽字体很准**；英文比例字体（i/l vs w/m 宽度差大）会有 ±1 字符级误差；`--rotate ≠ 0` 的旋转文字、RTL 文本（`#page` 强制 `direction:ltr`）偏移方向会错。
- 属方案固有近似（方案 §3.2 本就如此设计），日常中文书籍影响小。**可选优化**：用 `doc.caretRangeFromPoint(x, y)`（Chromium/Android WebView 支持，MDN 标注非标准但长期可用；内部按字体度量精确命中，天然处理 transform/旋转），命中失败再回退当前算法。

### P2 ｜ 拖选性能：每帧全量 span 遍历 + 潜在强制同步布局

- 每次 `touchmove` 遍历整页 span（数百~数千个）并逐个 `getBoundingClientRect()`；同时每帧 `addRange` → `selectionchange` → `moveEndOfContent` 的 `insertBefore` 会弄脏布局，下一帧 rect 查询触发 reflow。
- 低端 Android 设备上长页面可能掉帧。**可选优化**：进入选词时缓存一次 `span → rect` 快照（选词期间几何不变），或按行做简单空间分桶。

### P3 ｜ 已知固有限制（建议写进文档，不算缺陷）

1. **无跨页选区**：每页独立 iframe，选区天然限制在单页内（原生选区同样无法跨 iframe）。
2. **发起方式与原生不同**：本实现是「按下即拖即选」（6px 阈值），而非 Android 习惯的「长按发起」。当前交互下自洽（PDF 翻页为点按边缘、页面无滚动、双指缩放已禁、下拉书签已 suppressed），但需在真机确认手感；若想要「长按后才进入选词」，可在 touchstart 加 ~300ms 定时器门控，超时前移动视为页面手势。
3. 根因措辞建议改为「不可靠/无法稳定发起」（见 §1.1）。

### P3 ｜ biome 两处风格问题（**本次复核已修复**）

- `Infinity` → `Number.POSITIVE_INFINITY`（lint/style/useNumberNamespace）；
- `touchcancel` 监听注册超行宽的格式问题。
- 修复后 `npx biome check packages/foliate-js/pdf.js` 通过，reader.html 已重新构建（2001KB）。**这两处改动尚未提交**，随复核报告一并留给开发者 commit。

---

## 4. 最终要求逐条核对

| 要求 | 机制 | 状态 |
|---|---|---|
| 文字层位置/大小与视图层一致 | 几何完全由 ④ `stabilizeTextLayerGeometry` 保证，与官方 calc 公式数学等价；本方案只读 rect 不写几何；diff 确认未动 transform/absolute | ✅ 代码层面成立（真机目视为最终确认） |
| 可以复制 | 程序化 addRange → selectionchange → `emitSelection` → `postToRN('selection', {text})` → `SelectionPopover` 复制 → `Clipboard.setStringAsync(selection.text)`（SelectionPopover.tsx:155），全程不依赖 Android 原生选区/复制菜单 | ✅ 链路完整（文本质量见 P1） |

---

## 5. 构建与静态验证记录

- `node scripts/build-reader.js`：通过（2001KB）；复核开始时产物与 HEAD 哈希一致（`790748bc…`），证明提交内 reader.html 确由当前源码构建、未手改。
- `npx biome check packages/foliate-js/pdf.js`：修复后 0 错误。
- pdfjs-dist 实际安装版本：`5.5.207`（node_modules/pdfjs-dist/package.json），与 package.json 一致。
- 工作区改动：`packages/foliate-js/pdf.js`（lint 修复）、`packages/app-expo/assets/reader/reader.html`（重建），**未提交**。

## 6. Android 真机验证清单（必须）

1. PDF 页内按下拖动 → 选区高亮**立即**出现且与字形**严丝合缝**（重点：中文整行、行首行尾、标点）；
2. 松手 300ms 后工具条弹出 → 复制 → 粘贴检查文本（多行是否粘连、有无 `\0` 乱码 —— 对应 P1）；
3. 单击文字 → 工具条弹出/选区清除；单击左右边缘 → 正常翻页（不互相干扰）；
4. 下拉书签手势在文字区不触发（保持 suppressed）；
5. 双指缩放禁用、页面无橡皮筋；
6. 大页面（>2000 span）拖选流畅度（对应 P2 性能）；
7. iOS 回归：PDF 长按选词、EPUB 选词行为不变。

---

## 7. 修复落实（2026-07-28，复核当日完成）

以下修复已实施并通过静态验证，**均未提交**，待真机验证后随本分支一并 commit。

### 7.1 P1 已修：PDF 复制文本改走 `getSelectedText` 高质量提取

- `packages/foliate-js/pdf.js`：`render()` 内新增
  `doc.__readanyPdfGetSelectedText = (selection) => getSelectedText(selection, textContainer)`，
  挂在本页 iframe doc 上（重渲染随新闭包覆盖，无泄漏）。**不受 isIOS 门控**——iOS/桌面的 PDF 原生选区复制同样受益。
- `reader.template.html`：`emitSelection` 优先调用该提取器（按视觉行排序、行间补换行、`normalizeUnicode`、去 `\0` 占位符），提取失败或为空时回退原 `getRangeTextWithoutRuby`；EPUB 文档无此属性，行为完全不变。
- 效果：多行选区复制文本**行间有换行、无 `\0` 乱码、Unicode 已归一**，方案 §3.4 的描述自此与实现真正一致。

### 7.2 P2 已修（精度）：`pointToPosition` 优先 `caretRangeFromPoint` 精确命中

- 每次坐标换算先尝试 `doc.caretRangeFromPoint(x, y)`（Chromium 按真实字体度量 hit-test，**天然处理 transform/旋转/RTL/比例字体**）；仅当返回节点是 textLayer 内的文本节点（且不在 `.endOfContent` 内）才采用，否则回退原几何近似算法。
- 兜底完备：API 不存在（可选链）、返回元素节点、命中 textLayer 外（如 annotationLayer 链接文本）均安全回退；中英文混排、旋转文字的偏移精度自此与原生相当。

### 7.3 P2 已修（性能）：span 几何快照缓存

- 几何回退路径改为首次调用时建立 `{ textNode, textContent, rect }` 快照，整个拖选手势复用（选词中页面几何不变，endOfContent 为 absolute 移动不影响 span 布局），手势结束（touchend/touchcancel）清空。
- 消除「每次 touchmove 遍历全页 span 并逐个 `getBoundingClientRect()`（叠加 moveEndOfContent 弄脏布局后的强制 reflow）」的每帧开销。

### 7.4 验证记录

- `npx biome check packages/foliate-js/pdf.js`：0 错误。
- `node scripts/build-reader.js`：通过（2002KB）；产物确认包含 `__readanyPdfGetSelectedText`（暴露+消费两处）、`caretRangeFromPoint`；4 个 `<script>` 块全部通过语法解析。
- 工作区未提交改动：`packages/foliate-js/pdf.js`、`packages/app-expo/assets/reader/reader.template.html`、`packages/app-expo/assets/reader/reader.html`（重建）。

### 7.5 真机验证清单补充

- §6-2 复制文本：确认多行**有换行**、无 `\0`；
- §6-1 选区精度：英文比例字体、斜体/旋转文字（如有）的落点偏移应明显优于线性比例；
- §6-6 流畅度：快照生效后长页面拖选应无卡顿。

---

## 8. 独立 sub agent 复核与最终修正（最新）

### 8.1 独立复核发现

初版实现不能断言“不影响现有功能”，存在以下明确问题：

| 级别 | 问题 | 影响 |
|---|---|---|
| P1 | 所有从 `.textLayer` 开始的单指移动超过 6px 后立即 `preventDefault()` 并创建 Range | 普通横向翻页、纵向滚动可能被劫持成文字选择 |
| P1 | 门控为 `if (!isIOS())`，而不是 Android 判断 | Windows/ChromeOS/Linux 等非 iOS 触屏环境也会被改变 |
| P2 | 不检查 `touches.length` | 多指手势可能误入选择流程 |
| P2 | 未进入拖选的轻触也执行 `removeAllRanges()` | 可能清空已有原生选区 |

复制链路和 `pdfjs-dist` 版本统一没有发现阻断问题。根覆盖、四个实际依赖声明、
pnpm/npm 锁文件、worker/CMap/字体 URL 及 Expo 构建产物均为 `5.5.207`。

### 8.2 已实施修正

1. 平台门控改为 `isAndroid()`，只匹配 Android UA。
2. 选区改为 500ms 长按激活；激活前移动超过 10px 仅取消定时器，不调用
   `preventDefault()`，普通滚动/翻页保持原行为。
3. 初始触点必须真实命中文字 span；只有拖选焦点允许吸附最近 span，页边和行间
   空白不会发起选区。
4. 仅接受单指；多指开始或中途加入时立即重置本次待选状态。
5. 长按激活后通过现有 `setNavigationLocked(true)` 暂停 paginator 手势，结束、
   取消或重渲染时恢复；不再因普通轻触清空已有 Range。
6. 初始长按优先通过 `Intl.Segmenter` 选择自然词段/CJK 字段，旧 WebView 回退到
   单个 Unicode code point；初始词段边界在手指微小抖动时保持稳定，拖出边界后再
   向前或向后扩展 DOM Range。
7. 保留 `caretRangeFromPoint` 精确命中、span 几何快照和 PDF 专用文本提取器。

### 8.3 当前结论与剩余风险

- EPUB、iOS PDF、桌面 PDF 和其他非 Android 触屏平台不进入自定义触摸分支。
- Android 普通滚动/翻页在长按激活前不被阻止；PDF 下拉书签原本就对
  `.textLayer` 设置 `suppressed`，不与选区竞争。
- 文字层几何未改动，canvas/textLayer 对齐风险没有扩大。
- `caretRangeFromPoint`、程序化 `Selection.addRange()`、`selectionchange` 时序、
  `::selection` 高亮以及长按手感仍需要 Android 真机最终确认。静态验证不能替代
  WebView 真实输入栈。

### 8.4 真机验收重点

1. 轻点、快速横滑、快速竖滑 PDF 正文均不产生选区，翻页/滚动与修复前一致。
2. 长按文字约 500ms 后出现自然词段高亮；保持按下拖动可向前、向后扩展。
3. 长按页边、行间空白不产生选区；双指手势不误选。
4. 松手后弹出工具条，复制多行文本有换行、无 `\0`。
5. 选区期间不翻页；复制或取消后导航锁释放。
6. EPUB 选择、iOS PDF 原生选择、桌面鼠标选择无回归。
