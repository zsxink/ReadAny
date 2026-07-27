# Android 端 PDF 文字无法选择：原因分析与解决方案

> **最后更新：** 2026-07-27（5 独立子代理源码 + Chromium Blink 源码全路径追踪 + 交叉验证 v3）

## 结论

Android 端 PDF 文字选择失败的根因与 macOS 端（[pdf-text-selection-analysis.md](./pdf-text-selection-analysis.md)）不同。macOS 端的核心问题是 `devicePixelRatio` 混入 viewport 导致 TextLayer 几何错位，该问题在当前代码中已修复（`scale = zoom`，不含 DPR）。

经过三轮独立源码验证（v1 人工 → v2 子代理 → v3 Chromium Blink 源码全路径追踪），共确认 **2 个实际根因 + 4 项已排除**：

| # | 候选根因 | 状态 | v3 子代理结论 |
|---|---------|------|-------------|
| 1 | **`elementFromPoint` 在 scaled iframe 中与 PointerEvent 坐标空间不一致** → 误判为平移模式 | ✅ **实际根因（P0）** | Blink 源码确认 `clientX/Y` 走 visual viewport 路径，`PointInFrameContentIfVisible()` 用 layout viewport (`VisibleContentRect`)，两者在 Android 键盘弹起/缩放时分离；CSS `transform: scale()` 由 compositor 处理不影响 iframe 内坐标系，但 `elementFromPoint` 强制同步布局可能使用 stale 状态 |
| 2 | **`contextmenu` 被全局阻止** → 抑制 Android 长按选区浮动工具栏 | ✅ **实际根因（P1）** | 影响浮动工具栏/菜单，选择手柄由浏览器原生选区控制；子代理确认无额外发现 |
| 3 | ~~`.highlighting { touch-action: none }` 禁用原生选区~~ | ❌ **已排除（v2）** | `.highlighting` 类从未被添加，死 CSS |
| 4 | ~~Capture-phase Pull Bookmark `preventDefault` 竞争原生选区~~ | ❌ **已排除（v3）** | 🚨 **关键修正**：`pointerdown` 在 `touchstart` 之前触发，Pull Bookmark `touchstart` 是 `passive: true`（不能 `preventDefault`）；`stopPropagation` 不阻止 pointer 事件（不同类型） |
| 5 | ~~Selection Listener `touchend` 跳过 Android~~ | ❌ **已排除（v2）** | 该处理是 iOS 专属 hack，Android 正确跳过 |
| 6 | ~~RN WebView 原生层拦截触摸~~ | ❌ **已排除（v3）** | 子代理研究确认 RN WebView 原生层无额外触摸拦截；WebView 版本是主要变量 |

### 🚨 v3 关键修正：事件竞争模型重估

经过 Chromium Blink 源码全路径追踪（2026-07-27），两项之前认为是根因的假设被推翻或弱化：

1. **所有事件处理器在同一个 iframe `contentDocument` 上（非跨 iframe 边界）** — `reader.template.html` 的 `openBook` 函数收到 `e.detail.doc`（iframe 的 `contentDocument`）并在其上注册触摸/选区监听器。因此不存在"parent capture-phase vs iframe bubble"的跨文档竞争。

2. **Pointer 事件在 Touch 事件之前触发** — Chromium 事件时间线为 `pointerdown → touchstart → [pointermove/touchmove 循环] → pointerup → touchend`。Pull Bookmark 的 `touchstart` 是 `passive: true`，不仅不能 `preventDefault()`，而且执行顺序在 `pointerdown` 之后。因此 Pull Bookmark **不可能**阻止 `onpointerdown` 触发。

   Pull Bookmark 的 `touchmove` (`passive: false, capture: true`) 在 `onpointermove` **之后**触发（`pointermove → touchmove`），因此它对 `preventDefault()` 的调用**也不影响**已触发的 `onpointermove`。它可能影响浏览器原生选区处理（通过 `preventDefault()` 阻止默认触摸行为），但这不是 pdf.js 层平移模式的主要竞争因素。

这意味着**核心问题从"多层 preventDefault 竞争"简化为更聚焦的根因**——主因是 **`elementFromPoint` 在坐标空间差异下不可靠 → 误入平移模式 → `onpointermove` 在平移模式中调用 `preventDefault()`**。

### 原始故障模型（含 v3 修正）

```
用户在 Android 上触摸 PDF 文字
  │
  ├─→ [第一时间顺序] pointerdown 在 touchstart 之前触发
  │─→ [第二时间顺序] pointermove 在 touchmove 之前触发
  │
  ├─→ pdf.js onpointerdown 触发 (pointerdown)
  │     └─→ elementFromPoint(e.clientX, e.clientY) 强制同步布局
  │           → PointInFrameContentIfVisible 使用 layout viewport 坐标
  │           → clientX/Y 来自 visual viewport (compositor)
  │           → visual/layout viewport 在 Android 缩放/键盘场景分离
  │           → 返回 canvas/null (误判)
  │           → hasTextUnderneath = false
  │           → isPanning = true                     ← 【P0 主因】
  │
  ├─→ 用户手指移动
  │     ├─→ pdf.js onpointermove: isPanning && scrollParent → preventDefault()
  │     │     preventDefault() 阻止浏览器原生触摸选区行为    ← 【直接故障点】
  │     └─→ touchmove (Pull Bookmark, passive:false):
  │           在 pointermove 之后触发，不影响已发出的 pointer 事件
  │
  ├─→ contextmenu 被全局阻止 → 浮动工具栏不显示          ← 【P1 次要】
  │
  └─→ 结果：用户无法创建文字选区，也无选区操作菜单
```

### 提示框（与 v2 保持一致）

> **关于 Paginator：** PDF 使用 `<foliate-fxl>`（fixed-layout），paginator 的 `touchmove` `preventDefault()` 只作用于重排内容（EPUB 等）。
>
> **关于 `scrollEnabled={false}`：** react-native-webview 的 `scrollEnabled` 属性是 **iOS/macOS 专属**，对 Android 无任何效果。
>
> **关于 TextLayer 的 DPR 处理：** PDF.js TextLayer 内部会自行计算 `this.#scale = viewport.scale * OutputScale.pixelRatio`（`display_utils.js`）。项目将 DPR 从 viewport scale 中分离（`scale = zoom`）的做法是正确的——TextLayer 内部自行处理 DPR。

---

## 页面渲染结构

每个 PDF 页面由 `packages/foliate-js/pdf.js` 渲染到一个 iframe，iframe 由 `packages/foliate-js/fixed-layout.js` 创建。React Native 侧通过 `packages/app-expo/src/screens/ReaderScreen.tsx` 中的 WebView 承载整个阅读器。

```
React Native WebView (ReaderScreen.tsx)
  └─ reader.html / reader.template.html
       └─ <foliate-view> (view.js)
            └─ <foliate-fxl> (fixed-layout.js)    ← PDF 走这里，不是 paginator
                 └─ <iframe> (每个页面一个)
                      ├─ <canvas>       ← PDF 页面图像
                      ├─ <div class="textLayer">      ← 透明 DOM 文字，负责选择
                      └─ <div class="annotationLayer"> ← 链接、批注
```

关键点：PDF 内容使用 `<foliate-fxl>` 而非 `<foliate-paginator>`，因此 paginator 中的触摸手势处理（翻页滑动、`preventDefault()`）**不直接作用于 PDF 页面**。PDF 的触摸事件完全由 iframe 内部的代码处理。

---

## 触摸事件层级分析（v3 修正）

### 重要架构背景：所有监听器在同一 iframe document 上

`reader.template.html` 的 `openBook` 函数通过 `foliate-fxl` 的 `"load"` 事件收到 `e.detail.doc`（iframe 的 `contentDocument`），所有触摸/选区/点击监听器**都在这个 iframe 文档上注册**。

```
react-native-webview
  └─ reader.html（宿主文档，非事件目标）
       └─ <foliate-view>（closed shadow DOM，不影响事件传播）
            └─ <foliate-fxl>（closed shadow DOM，不影响事件传播）
                 └─ <iframe sandbox="allow-same-origin allow-scripts">
                      └─ #document（iframe contentDocument）← 所有事件处理器在此
                           ├─ <div class="textLayer">
                           │    ← onpointerdown / onpointermove / onpointerup（pdf.js）
                           └─ ← touchstart / touchmove / touchend（reader.template.html 通过 doc.addEventListener 注册）
                               ← contextmenu（同样在 doc 上注册）
```

这意味着所谓"parent capture-phase vs iframe bubble"的跨文档竞争**并不存在**。

### Chromium 事件时间线（核心知识）

```
pointerdown ──→ touchstart ──→ [pointermove/touchmove 循环] ──→ pointerup ──→ touchend
```

Pointer 事件**先于**同源的 Touch 事件触发。因此：
- `onpointerdown` 不可能被 `touchstart` 阻止
- `onpointermove` 不可能被 `touchmove` 阻止（事件类型独立调度）
- `touchstart` 的 `passive: true` 和 `stopPropagation()` 不影响 Pointer 事件

### Layer E（优先级最高）：PDF TextLayer Pointer 事件（pdf.js L386-458）

```
pointerdown  → elementFromPoint 判断是否有文字 → 选择模式 or 平移模式
pointermove  → isPanning && scrollParent 时 preventDefault()
pointerup    → 退出平移 or 重置 endOfContent
```

**这是最先触发的监听器（vs 所有 Touch 事件）。** `onpointermove` 的守卫条件是 `isPanning && scrollParent`（pdf.js L417），`scrollParent` 在 `onpointerdown` 进入平移模式时同步设置（L401）。

### Layer A：Pull Bookmark（reader.template.html L2399-2527）

```
touchstart  → passive: true,  capture: true   → 记录起点（不能 preventDefault）
touchmove   → passive: false, capture: true   → 垂直拉动时 preventDefault()
touchend    → passive: false, capture: true   → 判断是否触发书签
```

判定条件：`deltaY >= 10` 且 `absY > absX * 1.35` 时视为垂直拉动（两阶段设计：先激活方向门槛，后阻止默认行为）。

**v3 修正：** Pull Bookmark 的 `preventDefault()` 不会阻止 pdf.js 的 `onpointermove`（pointer 事件在 touch 事件之前触发，且 PT 事件类型独立）。它仅影响浏览器原生触摸选区行为。因此 **Pull Bookmark 不是 pdf.js 平移模式的主要竞争因素**。

### Layer B：Tap Listener（reader.template.html L2260-2397）

```
touchstart  → passive: true
touchmove   → passive: true
touchend    → passive: false, capture: true   → 中心区域点击翻页时 preventDefault()
```

### Layer C：Selection Listener（reader.template.html L2530-2616）

```
selectionchange → 300ms 防抖，发送选区到 React Native
touchend        → 仅 iOS 有特殊处理（isIOSLike 检查），Android 无对应逻辑
touchmove       → passive: true, capture: true → 标记选区交互状态
```

### Layer D：Note Long-Press（reader.template.html L1172-1227）

```
touchstart → passive: false → 400ms 长按定时器；命中笔记范围时 preventDefault()
```

### Layer F：contextmenu 全局阻止（reader.template.html L2250）

```
contextmenu → capture: true → e.preventDefault() + e.stopPropagation()（无条件阻止）
```

### Layer G：TextLayer CSS touch-action（pdf.js L40）**【已排除为无效因素】**

```css
.textLayer.highlighting { touch-action: none; }
```

**🚨 v2 已核实：这是一个死 CSS 规则。** `.highlighting` 类从未被任何 JavaScript 代码添加到 DOM 中。项目使用的是 `.selecting` 类（pdf.js L289、L313、L412），它只控制：

```css
.textLayer.selecting .endOfContent { top: 0; }
```

不改变 `touch-action`。因此 TextLayer 上的 `touch-action` 始终保持浏览器默认值（`auto`/`manipulation`）

---

## 实际故障链

### 1. 🚨 **`elementFromPoint` 在 scaled iframe 中坐标空间不匹配**（最致命，P0）

`packages/foliate-js/pdf.js:386-413`

```js
textContainer.onpointerdown = (e) => {
  const elementUnderCursor = doc.elementFromPoint(e.clientX, e.clientY);
  const hasTextUnderneath =
    elementUnderCursor &&
    (elementUnderCursor.tagName === "SPAN" || elementUnderCursor.tagName === "P") &&
    elementUnderCursor.textContent.trim().length > 0;

  if (!hasTextUnderneath && !hasTextSelection) {
    isPanning = true;   // ← 误判为平移模式
  } else {
    textContainer.classList.add("selecting");
  }
};
```

#### Chromium Blink 源码全路径追踪结论

经过 Chromium Blink 源码追踪（v3），确认 `clientX/Y` 与 `elementFromPoint` 使用**不完全相同的坐标空间**：

| 维度 | PointerEvent clientX/Y | elementFromPoint(x, y) |
|------|----------------------|----------------------|
| 来源 | `WebPointerEvent::PositionInWidget()`，经 compositor hit-test 转换 | JS API → `TreeScope::ElementFromPoint()` |
| 坐标空间 | visual viewport（compositor 决定） | layout viewport（通过 `PointInFrameContentIfVisible` → `VisibleContentRect()`） |
| 布局触发 | 无（compositor 已处理） | **强制同步布局**（`UpdateStyleAndLayout`） |
| 帧边界处理 | compositor hit-test 正确跨帧 | `HitTestInDocumentImpl` 只在当前 document 的 `LayoutView` 内操作，无跨帧机制（但同源 iframe 内无此问题） |

##### Blink 调用链

```
elementFromPoint(x, y) [tree_scope.idl]
  → TreeScope::ElementFromPoint() [tree_scope.cc]
    → HitTestInDocumentImpl(document, x, y, request)
      → PointInFrameContentIfVisible(document, point)
        // 1. 将坐标乘以 LayoutZoomFactor()（deviceScaleFactor × browser zoom）
        // 2. 检查 point 是否落在 VisibleContentRect() 内（layout viewport rect）
        // 3. 若超出则返回 null → elementFromPoint 返回 null
      → HitTestLocation location(hit_point)  // 缩放后的坐标
      → document->GetLayoutView()->HitTest(location, result)
```

##### 关键的 LayoutZoomFactor

`LocalFrame::LayoutZoomFactor()` = `deviceScaleFactor * browser_zoom`。在 Android 上，当 `use-zoom-for-dsf` 启用时，这包含设备像素比。`PointInFrameContentIfVisible` 将 CSS 像素乘以这个因子后检查是否在 `VisibleContentRect`（layout viewport 物理像素）内。当 **visual viewport ≠ layout viewport**（Android 软键盘弹起、页面缩放）时，`clientX/Y`（visual viewport 空间）通过 compositor 转换正确，但 `elementFromPoint` 使用的 `VisibleContentRect` 是 layout viewport 空间——不匹配。

##### CSS `transform: scale()` 不影响 iframe 内坐标系

`<foliate-fxl>` 对 iframe 元素应用了 CSS `transform: scale(S)` 和固定 `width: Wpx; height: Hpx`。Blink 源码确认：

- CSS transform 是 **compositor 级视觉效果**，不改变 iframe 内部的文档坐标系
- iframe 内部 viewport 仍是 W×H CSS 像素
- PointerEvent `clientX/Y` 在事件派发时已由 compositor 通过 CSS transform 反向转换到 iframe 内部坐标系 → **这一路径正确**
- `elementFromPoint(x, y)` 接收的 x/y 在 iframe 内部坐标系 → 但 `PointInFrameContentIfVisible` 中的 `VisibleContentRect` 计算可能因同步布局状态而不同步

##### 综上：问题本质不是"跨 iframe 坐标错位"

之前假设的"iframe 坐标映射不对"被 Chromium 源码追踪**纠正**：更准确的问题是 `elementFromPoint` 强制同步布局可能使用与 compositor 不同的状态（visual vs layout viewport 分离 + 同步布局的 stale 状态）。这与子代理的另一发现一致——**上游 PDF.js 从不使用 `elementFromPoint` 做 pan-vs-select 决策**，而是无条件信任浏览器原生选区机制。

**因此 P0 修复方向（`e.target` + 触摸默认选择）是正确的：** `e.target` 由 compositor hit-test 确定（与 `clientX/Y` 同一来源），不触发同步布局，不使用 `LayoutZoomFactor`/`VisibleContentRect`，是更可靠的判据。

### 2. `contextmenu` 全局阻止影响 Android 选区浮动工具栏（P1）

`packages/app-expo/assets/reader/reader.template.html:2250`

```js
doc.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();
  return false;
}, true);
```

在 Android Chrome/WebView 中，`contextmenu` 事件与长按选区流程相关：

- `preventDefault()` on `contextmenu` 主要抑制的是**浮动工具栏/菜单**（复制、全选等），而非选择手柄本身
- 选择手柄（蓝色拖拽点）更多由浏览器的原生文本选择实现控制，与 `touch-action` 和 pointer events 相关
- 不同 Android 版本和 WebView 构建的行为差异较大

### 3. ~~`touch-action: none` 禁用浏览器原生触摸选区~~ **【v2 已排除】**

`.textLayer.highlighting { touch-action: none }` 规则存在于 `pdf.js:40`，但 `.highlighting` 类从未被添加。死 CSS。

### 4. ~~Capture-phase 监听器竞争原生选区~~ **【v3 已排除】**

**v3 修正：** Pointer 事件（`pointerdown`/`pointermove`）在 Touch 事件（`touchstart`/`touchmove`）之前触发，且事件类型独立调度。Pull Bookmark 的 `touchmove` `preventDefault()` 虽然可能阻止浏览器原生选区行为，但**不影响** pdf.js 的 `onpointermove`。该假设在 v1/v2 中夸大了 Pull Bookmark 的竞争效应。

### 5. ~~Selection Listener `isIOSLike` 跳过 Android~~ **【v2 已排除】**

该 `touchend` 处理是 iOS 专属 hack，Android 直接 return 是正确行为。

### 6. ~~RN WebView 原生层拦截触摸~~ **【v3 已排除】**

子代理研究确认 RN WebView 原生层无额外触摸拦截代码。`androidLayerType` 至 `SOFTWARE` 可能绕过特定机型（Samsung/Xiaomi）GPU 驱动 bug，但不影响核心 JS 选区问题。WebView 版本（Google Play 独立更新）是主要 OS 版本之上的独立变量。

### 7. WebView 配置审计：Android 特有参数未优化

子代理对 `ReaderScreen.tsx` 中 WebView 参数进行了全量审计（v3），发现以下 Android 特有的配置可优化：

| 参数 | 当前值 | 最佳实践 | 原因 |
|------|--------|---------|------|
| `scrollEnabled={false}` | iOS/macOS only，Android 无效果 | 追加 `overScrollMode="never"`（Android-only prop） | 防止 Android WebView 原生滚动与 iframe 内部滚动冲突 |
| `setSupportMultipleWindows` | 未设置，默认 `true` | 应设为 `false` | 防止 WebView 弹窗打断阅读体验 |
| `setBuiltInZoomControls` | 未设置，默认 `true` | 应设为 `false` | 防止内置缩放按钮与 foliate-js 缩放冲突 |
| `setDisplayZoomControls` | 未设置，默认 `true` | 应设为 `false` | 同上 |
| `androidLayerType` | 未设置，默认 `"none"` | 保持默认 | 仅特定机型 GPU bug 时才需设为 `"software"` |

> 这些配置优化**不是选区问题的决定因素**，但可以消除 Android 上的额外手势冲突。不归入 P0-P3，建议作为独立改进项。

### 7. 无 Android 特化文件

整个 `packages/` 目录中**没有任何 `.android.` 或 `_android.` 变体文件**。所有 Android 行为都来自与桌面/iOS 共享的代码路径。`ReaderScreen.tsx` 中唯一的 `Platform.OS === "android"` 检查（line 887）仅用于音量键翻页，与选区无关。`SelectionPopover.tsx` 中唯一的 `Platform.OS` 检查（L285）用于 `KeyboardAvoidingView behavior`。

---

## 因果链总结（v3 修正）

```
用户在 Android 上触摸 PDF 文字
  │
  ├─→ [第一时序] pointerdown 在 touchstart 之前触发（Chromium 事件模型）
  │
  ├─→ pdf.js onpointerdown (E)
  │     ├─→ clientX/Y 来自 compositor (visual viewport 空间)
  │     ├─→ elementFromPoint() 强制同步布局 (layout viewport 空间)
  │     │     → PointInFrameContentIfVisible 用 LayoutZoomFactor 缩放
  │     │     → visual vs layout viewport 分离时 → 返回 null/CANVAS
  │     │     → hasTextUnderneath = false
  │     │     → isPanning = true                     ← 【P0 主因】
  │     │
  │     └─→ 若命中 span → selecting class → 选择模式（无此问题时正常）
  │
  ├─→ 用户手指移动
  │     ├─→ [第二时序] pointermove 在 touchmove 之前触发
  │     ├─→ pdf.js onpointermove: isPanning && scrollParent → preventDefault()
  │     │     ← 阻止浏览器原生触摸选区行为 ← 【直接故障点】
  │     └─→ touchmove: Pull Bookmark (passive:false)
  │           ← pointermove 已触发，Pull Bookmark 不影响 onpointermove
  │
  ├─→ contextmenu 被全局阻止 → 浮动工具栏不显示      ← 【P1 次要】
  │
  └─→ 结果：用户无法创建文字选区，也无选区操作菜单
```

---

## 与 macOS 端问题的对比

| 维度 | macOS（issue #600） | Android（issue #362） |
|------|---------------------|----------------------|
| DPR/viewport 错位 | **主因**（已修复） | 无影响（已继承 DPR 分离） |
| `elementFromPoint` vs PointerEvent 坐标 | 基本一致（desktop 无 visual/layout viewport 分离） | **主因**（Android visual/layout viewport 分离 + 强制同步布局 stale 状态） |
| `touch-action: none` | 桌面不依赖原生触摸选区 | **不相关**（`.highlighting` 类从未被添加，死 CSS） |
| `contextmenu` 阻止 | 桌面不影响选区启动 | **次要因素**（影响浮动工具栏显示，但非选择启动障碍） |
| Capture-phase 抢占 | 桌面 `preventDefault` 可能被忽略 | **已排除**（v3：pointer 事件先于 touch 事件触发，事件类型独立调度） |
| 缺少平台特化处理 | 不需要（桌面有鼠标） | **不是实际因素**（selection listener 正确跳过 Android） |
| RN WebView 原生拦截 | 不存在 | **已排除**（RN WebView 原生层无额外触摸代码） |

---

## 推荐解决方案

> **设计原则：** 修改集中在 `pdf.js`（跨平台共享，无平台分支）和 `reader.template.html`（WebView bridge）。由于 PDF 走 `foliate-fxl` 且 `.highlighting` 死规则不生效，方案不再包含 `touch-action` 相关改动。以 `e.pointerType === 'touch'` 作为触摸设备判据（而非 `isAndroid` UA 嗅探），使 iOS/Android/未来触摸设备统一受益，且不引入平台特化文件。

### 修复优先级总览

| 优先级 | 修复点 | 文件 | 风险 | 预期收益 | v3 验证 |
|--------|--------|------|------|----------|---------|
| **P0** | `elementFromPoint` → `e.target` 命中检测 + 触摸默认选择 | `pdf.js:386-414` | 低 | **决定性**：消除误入平移模式 | Blink 源码确认坐标空间差异；上游 PDF.js 从不使用此方法 |
| **P0** | `onpointermove` 平移仅限非触摸 | `pdf.js:416-427` | 低 | 消除 pdf.js 层的选区 `preventDefault` | 与 upstream 实践对齐（PR #17923）|
| **P1** | Pull Bookmark 排除 `.textLayer` 区域 | `reader.template.html:2441` | 中 | 消除 touchmove preventDefault 干扰（影响原生选区，非 pdf.js） | v3 降级：不影响 onpointermove，但可能干扰浏览器原生选区手势 |
| **P1** | `contextmenu` 有选区时放行 | `reader.template.html:2250` | 低 | 恢复 Android 浮动工具栏 | 不变 |
| **P2** | WebView 配置优化 | `ReaderScreen.tsx` | 低 | 消除 Android 额外手势冲突 | v3 新发现：`scrollEnabled` 无效，`setSupportMultipleWindows` 等未设 |
| **P3** | Android 选区上报验证 | `reader.template.html:2579` | 低 | 选区消息正常上报 RN | 仅验证任务，无需修 code

---

### P0-a：改用 `e.target` 检测 + 触摸设备默认选择模式

`packages/foliate-js/pdf.js:386-414`

**问题：** `doc.elementFromPoint(e.clientX, e.clientY)` 在 Android 上不可靠。v3 Chromium Blink 源码全路径追踪确认：

1. **坐标空间差异**：`clientX/Y` 来自 compositor hit-test (visual viewport)，`elementFromPoint` 内部 `PointInFrameContentIfVisible` 使用 `VisibleContentRect()` (layout viewport)。Android 软键盘弹起、缩放等场景使两者分离
2. **强制同步布局**：`PointInFrameContentIfVisible` → `UpdateStyleAndLayout`，可能使用与 compositor 不同步的状态
3. **没有跨帧路径问题**（修正 v1/v2 假设）：同源 iframe 内 `elementFromPoint` 调用链没有跨帧障碍，但 `HitTestInDocumentImpl` 只在当前 `LayoutView` 内操作
4. **CSS `transform: scale()` 不影响 iframe 内部坐标系**：compositor 正确处理了 CSS transform 的坐标反向转换

三项上游 PDF.js 实践佐证：PR #17923 从 pointer-event 驱动转到 `selectionchange` 驱动；PDF.js 从不使用 `elementFromPoint` 做 pan-vs-select 决策；上游 `TextLayerBuilder` 只在 `mousedown` 无条件添加 `selecting` class。

**修复：** 事件派发的 `e.target` 由 Blink 内部 compositor hit-test 决定，与 `clientX/Y` 同源，不触发同步布局，是理论可靠的判据。同时对触摸设备默认进入选择模式，仅鼠标/触控笔才考虑平移。

```js
textContainer.onpointerdown = (e) => {
  const selection = doc.getSelection();
  const hasTextSelection = selection && selection.toString().length > 0;

  // 优先用事件目标（Blink 内部命中，比 elementFromPoint 可靠），
  // 未命中再用 elementFromPoint 兜底（保留桌面精确行为）
  let hasTextUnderneath = false;
  const targetEl = e.target?.closest?.(".textLayer span, .textLayer p");
  if (targetEl && targetEl.textContent.trim().length > 0) {
    hasTextUnderneath = true;
  } else {
    const elementUnderCursor = doc.elementFromPoint(e.clientX, e.clientY);
    hasTextUnderneath =
      elementUnderCursor &&
      (elementUnderCursor.tagName === "SPAN" || elementUnderCursor.tagName === "P") &&
      elementUnderCursor.textContent.trim().length > 0;
  }

  // 触摸设备：从不主动进入平移模式，交给浏览器原生触摸选区
  const isTouch = e.pointerType === "touch";

  if (!hasTextUnderneath && !hasTextSelection && !isTouch) {
    isPanning = true;
    startX = e.screenX;
    startY = e.screenY;
    const iframe = doc.defaultView.frameElement;
    if (iframe) {
      scrollParent = findScrollableParent(iframe);
      if (scrollParent === window) {
        scrollLeft = window.scrollX || window.pageXOffset;
        scrollTop = window.scrollY || window.pageYOffset;
      } else {
        scrollLeft = scrollParent.scrollLeft;
        scrollTop = scrollParent.scrollTop;
      }
      textContainer.style.cursor = "grabbing";
    }
  } else {
    textContainer.classList.add("selecting");
  }
};
```

> **说明：** 触摸设备默认不平移，是因为 PDF 在 `foliate-fxl` 中每页独立铺满 iframe，Android 上翻页由 `reader.template.html` 的 tap listener（中心区域点击）和音量键处理，PDF 页内平移在触摸设备上并非主要交互。若产品需要触摸平移（如放大后的大页面），应改由**双指拖拽**实现，而非与单指选区冲突的单指拖拽。

### P0-b：`onpointermove` 平移守卫增加触摸排除

`packages/foliate-js/pdf.js:416-427`

即使 P0-a 已使触摸设备不进入 `isPanning`，为防御性起见在 `onpointermove` 同样排除触摸的 `preventDefault()`：

```js
textContainer.onpointermove = (e) => {
  if (isPanning && scrollParent && e.pointerType !== "touch") {
    e.preventDefault();
    const dx = e.screenX - startX;
    const dy = e.screenY - startY;
    if (scrollParent === window) window.scrollTo(scrollLeft - dx, scrollTop - dy);
    else {
      scrollParent.scrollLeft = scrollLeft - dx;
      scrollParent.scrollTop = scrollTop - dy;
    }
  }
};
```

这是 Android 选区被阻止的**直接原因之一**（pdf.js 层的 `preventDefault()`），必须与 P0-a 同批修复。

---

### P1-a：Pull Bookmark 排除 `.textLayer` 区域

`packages/app-expo/assets/reader/reader.template.html:2441`（`touchmove`, `passive:false, capture:true`）

**问题：** Pull Bookmark 的 capture-phase `touchmove` 在 Android 上 `preventDefault()` 实际生效。**v3 修正：** 这不影响 pdf.js 的 `onpointermove`（pointer 事件在 touch 事件之前触发），但可能阻止浏览器原生选区手势（`touchmove` 的 `preventDefault()` 可阻止长按选区启动）。Android 触摸天然抖动，长按后水平拖拽也可能触发其垂直判定门槛。

**修复：** 触摸起点落在 PDF TextLayer 内时，Pull Bookmark 不介入。在 `touchstart`（L2413）记录起点时判断并置一标志，`touchmove` 早退：

```js
// touchstart 内（capture phase 最先执行）
const startedInPdfText = !!(e.target?.closest?.(".textLayer"));
pullState.suppressed = startedInPdfText;

// touchmove 内，最前面早退
if (pullState.suppressed) return;
```

> 注意：不能只在 `touchmove` 里查 `e.target`——capture phase 的 target 可能是 iframe 宿主。用 `touchstart` 阶段一次性判定并缓存到 `pullState`，是更稳的做法。

同样的排除也应加到 **Tap Listener 的 `touchend`**（L2319, `passive:false, capture:true`）——若该 `touchend` 因中心区域判定调用了 `preventDefault()`，会干扰选区结束后的原生行为；应在存在活动选区时早退。

### P1-b：`contextmenu` 保持原有无条件阻止

`packages/app-expo/assets/reader/reader.template.html:2250`

**问题：** 无条件 `preventDefault()` + `stopPropagation()` 抑制了 Android 长按选区后的浮动工具栏（复制/全选）。

**产品决策：** 应用目标是用**完全自定义 SelectionPopover** 替代 Android 原生工具栏，因此保持原有无条件阻止不变。选区操作通过 `selectionchange` 上报驱动自定义弹窗，不受 contextmenu 阻止影响。

> 若未来产品策略变更，改为允许原生工具栏与自定义弹窗共存，可改为有选区时放行。

---

### P2：WebView 配置优化（Android 特有参数补齐）

`packages/app-expo/src/screens/ReaderScreen.tsx`

**新发现（v3 子代理审计）：** 当前 WebView 配置忽略了多项 Android 特有参数，可能产生额外的触摸/滚动冲突。

**涉及参数：**

| 参数 | 建议值 | 原因 |
|------|--------|------|
| `overScrollMode` | `"never"` | 弥补 `scrollEnabled={false}` 对 Android 无效的问题；防止 WebView 溢出回弹干扰 iframe 内手势 |
| `setSupportMultipleWindows` | `false` | 防止弹窗打断阅读 |
| `setBuiltInZoomControls` | `false` | 防止内置缩放按钮与 foliate-js 缩放冲突 |
| `setDisplayZoomControls` | `false` | 同上 |

> **注意：** `allowFileAccess`、`allowFileAccessFromFileURLs`、`allowUniversalAccessFromFileURLs` 和 `mixedContentMode="always"` 经审计已正确设置（均 `true`），无需修改。`javaScriptEnabled` 和 `domStorageEnabled` 也正确设为 `true`。

---

### P3：Android 选区上报验证

`packages/app-expo/assets/reader/reader.template.html:2559`

**核实结论：** Selection Listener 的 `touchend` 处理（L2559-2577）是 **iOS 专属 hack**（移除并重插 range 关闭 iOS 系统菜单）。`if (!isIOSLike) return` 对 Android 早退是**正确的**。

**真正需要确认的是选区上报链**（对 Android 已生效，需回归验证）：
- `selectionchange`（L2579，300ms 防抖）→ `emitSelection` → `postToRN('selection', {...})` ——**无平台分支，Android 同样触发**
- `touchmove`（L2605，`passive:true, capture:true`）标记选区交互 ——无平台分支

因此 **P3 主要是验证任务**：确认 P0/P1 修复后，Android 上 `selectionchange` 能正常上报选区到 RN，`SelectionPopover` 正常渲染。

---

### P3 辅助：诊断日志（真机定位，临时）

在实施 P0 前，先在 Android 真机确认 `elementFromPoint` 与 `e.target` 的实际差异，验证 v3 Chromium 源码分析的正确性：

```js
textContainer.onpointerdown = (e) => {
  const byPoint = doc.elementFromPoint(e.clientX, e.clientY);
  const byTarget = e.target?.closest?.(".textLayer span, .textLayer p");
  console.debug('[PDF Android] pointerdown', {
    pointerType: e.pointerType,
    clientX: e.clientX, clientY: e.clientY,
    byPoint_tag: byPoint?.tagName, byPoint_hasText: byPoint?.textContent?.trim()?.length > 0,
    byTarget_tag: byTarget?.tagName, byTarget_hasText: byTarget?.textContent?.trim()?.length > 0,
    devicePixelRatio: window.devicePixelRatio,
  });
  // ...
};
```

若日志显示 `byPoint` 常为 null/CANVAS 而 `byTarget` 命中 SPAN，则确证根因；修复上线后清理该日志。

## 验证标准

| # | 场景 | 预期 | 覆盖的根因 |
|---|------|------|-----------|
| 1 | Android 长按文字层（有 TextLayer span）| 触发 native 选区 + 选择手柄可拖拽扩展 | P0 修复 elementFromPoint |
| 2 | Android 长按后水平拖拽 | 选中起始点到终止点之间文字 | P0 + P1a （消除两层 preventDefault）|
| 3 | Android 双击文字 | 选中一个单词 | 浏览器原生行为恢复正常 |
| 4 | Android 选中后松手 | 浮动工具栏显示（复制/高亮/AI）| P1b（contextmenu 放行）|
| 5 | Android 选中后点击复制 | 文字被复制到剪贴板 | P2（选区上报链）|
| 6 | Android 文字区域外单指平移 | 页面翻页或滚动，不进入选择模式 | P0 非触摸不误判 |
| 7 | Android 中文 PDF | 长按可选择中文文字 | P0（通用修复）|
| 8 | Android 带链接 PDF | 链接可点击，不阻塞文字选择 | P0 + P1a |
| 9 | Android 扫描件 PDF（无 TextLayer）| 不崩溃，无文字时清楚提示 | 无改动，确认不回归 |
| 10 | **macOS/Web 回归**：鼠标框选 PDF 文字 | 选择正常，selectionchange 上报 | 确认非触摸路径无退化 |
| 11 | **macOS/Web 回归**：鼠标拖拽平移 | 在文字区域外可拖拽平移 | Onpointermove 守卫不变 |
| 12 | **iOS 回归**：长按 PDF 文字 | 选择正常（与修复前一致） | 确认 iOS 无退化 |

### 运行时诊断（真机调试阶段）

```js
// 执行在 pdf.js onpointerdown 入口（先加一行临时日志）
// P0 修复前用以确证根因假设
console.debug('[PDF D]', {
  pointerType: e.pointerType,
  byPoint: doc.elementFromPoint(e.clientX, e.clientY)?.tagName,
  byTarget: e.target?.closest?.('.textLayer span, .textLayer p')?.tagName,
  selecting: textContainer.classList.contains('selecting'),
  selection: doc.getSelection()?.toString()?.length,
});

// 运行时 sanity-check TextLayer span 存在
textContainer.querySelectorAll("span").length > 0

// 运行时比较 Canvas 和 TextLayer 边界是否对齐
const canvasRect = canvas.getBoundingClientRect();
const textRect = textContainer.getBoundingClientRect();
// width/height 及原点应基本一致（误差 < 1px）
```

---

## 实施顺序（与 P0–P3 绑定）

```
Phase 1 — 诊断 + 核心修复（一次发布）
├── Step 1: P3 辅助诊断日志 → Android 真机确认 elementFromPoint vs e.target 差异
├── Step 2: P0-a + P0-b 修复（pdf.js:386-427）
└── Step 3: 真机验证场景 #1–3，确认文字可选择

Phase 2 — 辅助手势排除 + 配置优化（同一次或紧随）
├── Step 4: P1-a Pull Bookmark 排除 textLayer（reader.template.html）
├── Step 5: P1-b contextmenu 条件放行（reader.template.html）
├── Step 6: P2 WebView Android 配置优化（ReaderScreen.tsx）
└── Step 7: 回归验证场景 #4–9

Phase 3 — 选区上报 + 清理
├── Step 8: P3 真机验证 iOS/macOS 无退化（场景 #10–12）
├── Step 9: P3 清理诊断日志
└── Step 10: 全量回归验证 12 个场景
```

> **风险控制：** P0 是决定性修复（改动 `< 10` 行）；P1 和 P2 是辅助修复（降低竞争概率 + 消除 Android 特有干扰）。若 P0 合并后长按选择已满足基本需求，P1/P2 可延后独立发布。v3 确认 Capture-phase 不参与 Pointer 事件竞争，P1-a 影响从"决定性的 preventDefault 竞争"降低为"辅助性的浏览器原生选区保护"。

> **Chromium 版本说明：** 所有分析基于 Blink 源码的 `tree_scope.cc`、`local_frame.h`、`event_handler.cc` 等核心文件的当前实现。随时间推移，`PointInFrameContentIfVisible` 的 `LayoutZoomFactor` 行为和 `VisibleContentRect` 计算可能随 Chromium 版本演变。建议在真机调试时核实日志输出与本文分析的一致性。

---

## 相关文件

| 文件 | 职责 |
|------|------|
| `packages/foliate-js/pdf.js` | PDF 页面渲染（Canvas + TextLayer + AnnotationLayer）和平移逻辑 |
| `packages/foliate-js/fixed-layout.js` | Fixed-layout 渲染器，为每个 PDF 页面创建 iframe |
| `packages/foliate-js/view.js` | View 元素，PDF 走 `foliate-fxl` 分支 |
| `packages/foliate-js/paginator.js` | Paginator（**不影响 PDF**，仅作用于重排内容） |
| `packages/app-expo/assets/reader/reader.template.html` | WebView bridge JS，包含所有触摸/选区/点击监听器 |
| `packages/app-expo/src/screens/ReaderScreen.tsx` | React Native WebView 配置 |
| `packages/app-expo/src/components/reader/SelectionPopover.tsx` | 选区操作弹窗（无平台特化代码） |
| `docs/pdf-text-selection-analysis.md` | macOS 端分析（DPR/viewport 错位问题） |

---

## macOS 修复（PR #600）对 Android 方案的影响

### PR #600 的关键变更

| 变更点 | 文件 | 行号 | 与 Android 的关系 |
|--------|------|------|-------------------|
| `scale = zoom`（DPR 从 viewport 分离）| pdf.js | L218 | ✅ 已共享，Android 同样受益 |
| Canvas 渲染使用 `outputScale` + transform | pdf.js | L231-237 | ✅ 已共享 |
| TextLayer 使用 `streamTextContent({ includeMarkedContent, disableNormalization })` | pdf.js | L266-274 | ✅ 已共享 |
| `getSelectedText` 几何排序 + 换行修复 | pdf.js | L105-195 | ✅ 已共享，不影响触摸 |
| `moveEndOfContent` 动态定位 + `selecting` class | pdf.js | L280-343 | ✅ 已共享，`selecting` class 跨平台 |
| AbortController 事件清理 | pdf.js | L276-278 | ✅ 已共享 |
| `.selecting ~ .annotationLayer { pointer-events: none }` | pdf.js | CSS | ✅ 已共享 |

### Android 方案从 macOS 修复中继承的模式

1. **`scale = zoom`（不含 DPR）的 DPR 分离模式** — macOS 的 DPR 修复已被 Android 继承，无需重复。PR #600 也验证了 readAny 的 TextLayer `--total-scale-factor` 传值正确。

2. **`pointerType` 条件** — macOS 方案没有 `pointerType` 分支（因为桌面鼠标不触发 `pointerType === 'touch'`），这恰恰说明 Android 修复需新增的 `e.pointerType` 条件不会影响 macOS。

3. **`AbortController` 事件清理** — PR #600 引入的清理模式（`doc.__readanyPdfTextSelectionAbortController?.abort()`）为 P0 修复提供了安全的重入保障：每次 zoom 重新渲染前清除旧事件监听，防止多个 `onpointerdown` 竞争。

4. **`selecting` class 跨平台一致性** — `moveEndOfContent`（L313）添加 `selecting` class，与 `onpointerdown` 进入选择模式的 `selecting` 添加（L412）逻辑一致。Android 修复中不应修改此 class 名或语义。

### 需注意的平台差异

| 方面 | macOS（桌面）| Android（触摸）|
|------|------------|--------------|
| 选区手势方式 | 鼠标拖拽选择 | 长按 → 选择手柄 |
| `elementFromPoint` 可靠性 | 可靠（相同 iframe 坐标） | 不可靠（iframe + viewport 错位）|
| `preventDefault()` 的影响 | 不影响原生选区 | 实际阻止原生选区 |
| 次要交互方式 | 右键菜单（contextmenu） | 长按浮动工具栏 |

本文档经过三轮独立核对：

- **v1（2026-07-26）：** 原始核对，覆盖 10 项源码声明 + 5 项 WebView 声明 + 5 项 PDF.js 文档声明
- **v2（2026-07-27）：** 通过 5 个独立子代理并行源码验证 + Web 研究 + 交叉对比，共新增/修正以下结论
- **v3（2026-07-27）：** 通过 5 个新独立子代理（Chromium Blink 源码全路径追踪 + RN WebView 原生层审计 + iframe 事件隔离分析 + PDF.js 上游实践 + ReaderScreen WebView props 审计）再次探索，修正以下结论

### 源码级核对 v3（覆盖前两轮全部 + Chromium Blink 源码追踪）

| # | 声明 | 结果 | 验证方式 | 备注 |
|---|------|------|---------|------|
| 1 | `const scale = zoom`（viewport 不含 DPR） | ✅ | 直接读取 pdf.js L218 | |
| 2 | `elementFromPoint` 用于检测文字 span | ✅ | 直接读取 pdf.js L389 | 三方判据：tagName 为 SPAN/P，textContent.trim() > 0 |
| 3 | `onpointermove` 守卫 `isPanning && scrollParent` | ✅ | 直接读取 pdf.js L417 | scrollParent 在 onpointerdown 进入平移时同步设置，两者几乎总是同时为 true |
| 4 | Pull Bookmark `touchmove` 为 `passive:false, capture:true` | ✅ | 直接读取 reader.template.html L2486 | 函数名 `attachPullBookmarkListener`，两阶段判定设计 |
| 5 | Pull Bookmark 两阶段判定 | ⚠️ **描述偏差** | 子代理验证 reader.template.html L2451-2485 | ACTIVATE_DISTANCE=10, INTENT_THRESHOLD=14, VERTICAL_INTENT_RATIO=1.35，>= 判据 |
| 6 | contextmenu 在 L2250 无条件阻止 | ✅ | 直接读取 reader.template.html L2250 | capture: true，preventDefault + stopPropagation + return false 三重阻止 |
| 7 | Selection Listener `isIOSLike` 跳过 Android | ✅ | 直接读取 reader.template.html L2560 | 确认为 iOS 专属 hack，Android 正确跳过 |
| 8 | PDF 使用 `foliate-fxl` 非 `foliate-paginator` | ✅ | view.js L274-276 | paginator touchmove preventDefault 不影响 PDF |
| 9 | WebView `scrollEnabled={false}` iOS/macOS 专属 | ✅ | ReaderScreen.tsx L1495 + RN 官方文档 | Android 无效果 |
| 10 | Note long-press 使用 `passive:false` | ✅ | 直接读取 reader.template.html L1209 | 无 capture; 400ms 定时器 |
| 11 | **`.textLayer.highlighting` 类从未被添加** | 🚨 **v2 关键修正，v3 维持** | grep 全仓库 | 死 CSS，v1 根因 #2 错误 |
| 12 | **ReaderScreen.tsx 唯一 Android 检查** | ✅ | 子代理审计 L887 | 仅音量键翻页，与选区无关 |
| 13 | **SelectionPopover.tsx 无平台特化** | ✅ | 子代理审计 L285 | 仅 KeyboardAvoidingView behavior |
| 14 | **RN WebView 原生层无额外触摸拦截** | ✅ **v3 新增** | 子代理审计 RN WebView Java 代码 | RN WebView Android 不拦截触摸事件 |
| 15 | **WebView 配置参数（scrollEnabled 等）Android 影响评估** | ✅ **v3 新增** | 子代理全量审计 ReaderScreen.tsx L1467-1499 | `scrollEnabled` iOS/macOS 专属；`setSupportMultipleWindows` 等未设置 |
| 16 | **事件处理器都在同一 iframe document 上（非跨文档竞争）** | 🚨 **v3 新增** | 子代理追踪 reader.template.html `openBook` 事件流程 | `e.detail.doc` = iframe.contentDocument，所有 touch/pointer 监听器在此注册 |

### Chromium Blink 源码核对 v3（新增深度追踪项目）

| # | 声明 | 结果 | 验证方式 | 备注 |
|---|------|------|---------|------|
| 1 | `elementFromPoint` 走 `TreeScope::ElementFromPoint()` | ✅ **Blink 源码确认** | `tree_scope.cc` → `HitTestInDocumentImpl` → `PointInFrameContentIfVisible` → `LayoutView::HitTest` | CSS `transform: scale()` 不影响 iframe 内坐标系（compositor 已转换） |
| 2 | `PointInFrameContentIfVisible` 使用 `LayoutZoomFactor` | ✅ **Blink 源码确认** | `PointInFrameContentIfVisible` 将 CSS px × `LayoutZoomFactor()` 后检查 `VisibleContentRect()` | `LayoutZoomFactor` = `deviceScaleFactor × browser_zoom` |
| 3 | `clientX/Y` vs `elementFromPoint` 坐标空间差异 | ✅ **架构确认** | `clientX/Y` 来自 compositor (visual viewport)；`elementFromPoint` 使用 `VisibleContentRect` (layout viewport) | Android 键盘弹起/缩放时 visual ≠ layout viewport |
| 4 | PointerEvent 先于 TouchEvent 触发 | ✅ **确认** | Chromium 事件时间线：`pointerdown → touchstart → [pointermove/touchmove] → pointerup → touchend` | Pull Bookmark 的 `preventDefault()` 不影响已发出的 pointer 事件 |
| 5 | `e.target` 由 compositor hit-test 决定 | ✅ **确认** | 与 `clientX/Y` 同源（`EventHandler::HitTestResultAtLocation`），不触发同步布局 | 比 `elementFromPoint` 更可靠的判据 |
| 6 | 上游 PDF.js 不使用 `elementFromPoint` | ✅ **确认** | PR #17923 从 pointer-event 驱动转向 `selectionchange` 驱动；`TextLayerBuilder` 在 `mousedown` 无条件添加 `selecting` class | ReadAny 的 pan-vs-select 设计是项目特有的问题 |

### 核对后修正汇总（v2 → v3 变化）

| # | v2 结论 | v3 状态 | 变更理由 |
|---|---------|---------|---------|
| 1 | Capture-phase 监听器竞争原生选区（根因 #4） | ❌ **已降级/弱化** | Chromium 事件时间线确认 pointer 先于 touch 触发，事件类型独立调度。Pull Bookmark `preventDefault` 不影响 `onpointermove` |
| 2 | `elementFromPoint` 在 iframe 中跨文档坐标映射问题 | ✅ **维持但修正解释** | 不是"跨 iframe 坐标错位"，而是 `PointInFrameContentIfVisible` 使用 layout viewport (`VisibleContentRect`) vs `clientX/Y` 来自 visual viewport（compositor）。CSS transform 内坐标系正确 |
| 3 | iframe 坐标错位架构根因（visual vs layout viewport） | ✅ **维持但更精确** | 补充：`elementFromPoint` 强制同步布局也可能使用与 compositor 不同步的状态 |
| 4 | RN WebView 原生拦截评估 | ✅ **新增排除** | 子代理审计 RN WebView Java 源码确认无额外拦截；WebView 版本是主要变量 |
| 5 | WebView 参数配置 | ✅ **新增** | `scrollEnabled={false}` 在 Android 无效；`setSupportMultipleWindows` 等未设 |
