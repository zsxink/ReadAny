# PDF 文本无法选择：原因分析与解决方案

## 结论

当前问题不应归因于“pdfjs-dist v5 删除了 `TextLayer` / `AnnotationLayer`”。

对项目实际使用的 `pdfjs-dist@5.5.207` 进行核对后可以确认：

- `TextLayer` 仍由 `pdfjs-dist` 导出
- `AnnotationLayer` 仍由 `pdfjs-dist` 导出
- 当前 `new TextLayer({ textContentSource, container, viewport })` 的调用形式仍受支持

版本不统一确实会增加维护风险，但不是“页面能显示、文字不能选择”的直接证据。

结合当前渲染代码，最可能的主因是：

> `devicePixelRatio` 被混入了 PDF 页面的逻辑 viewport，随后同一个高分辨率 viewport 又被传给 TextLayer；PDF.js 的 TextLayer 内部还会按设备像素比进行测量，导致透明文本层与可见 Canvas 的布局、命中区域不一致。

Canvas 仍然可以正常显示，是因为 Canvas 本来就适合使用更高的像素尺寸；但 TextLayer 是浏览器中的 DOM 文本层，应该使用 CSS 逻辑尺寸，而不是 Canvas 的物理像素尺寸。

这个判断与 PDF.js 官方示例和源码一致：官方高 DPI 渲染会把 `devicePixelRatio` 作为 Canvas 输出倍率处理，而不是乘进 `page.getViewport({ scale })` 的页面逻辑缩放。

---

## 页面渲染结构

每个 PDF 页面由 `packages/foliate-js/pdf.js` 渲染到一个 iframe：

```html
<div id="canvas"></div>
<div class="textLayer"></div>
<div class="annotationLayer"></div>
```

三层的职责不同：

| 层 | 内容 | 尺寸坐标 |
|---|---|---|
| Canvas | 用户看到的 PDF 页面图像 | 可以使用高 DPI 物理像素 |
| TextLayer | 透明的 DOM 文本 `<span>`，负责选择、复制 | 必须使用 CSS 逻辑像素 |
| AnnotationLayer | 链接、批注等交互区域 | 必须与 TextLayer 使用相同的逻辑 viewport |

文字选择并不是发生在 Canvas 上，而是发生在覆盖 Canvas 的透明 TextLayer 上。因此 Canvas 显示正常，只能说明 PDF 页面绘制成功，不能证明文本层的位置和尺寸正确。

---

## 实际故障链

### 1. fixed-layout 传入的 `zoom` 已经是页面逻辑缩放

`packages/foliate-js/fixed-layout.js` 计算页面适配比例后调用：

```js
onZoom({
  doc: frame.iframe.contentDocument,
  scale,
});
```

同时 iframe 的显示尺寸也按该 `scale` 设置：

```js
iframe.style.width = `${width * scale}px`;
iframe.style.height = `${height * scale}px`;
```

因此传入 `pdf.js` 的 `zoom` 表示页面在布局中的 CSS 缩放，不需要再把设备像素比合并进页面几何尺寸。

### 2. 当前代码提前把 DPR 乘进 viewport

`packages/foliate-js/pdf.js` 当前使用：

```js
const scale = zoom * devicePixelRatio;
const viewport = page.getViewport({ scale });
```

随后这个 viewport 同时用于：

```js
await page.render({ canvasContext, viewport }).promise;

new pdfjsLib.TextLayer({
  textContentSource: await page.streamTextContent(),
  container: textContainer,
  viewport,
});
```

这里把两种不同含义的缩放合并成了一个值：

- `zoom`：CSS 逻辑缩放，决定页面在界面上有多大
- `devicePixelRatio`：输出像素密度，只应决定 Canvas 内部有多少像素

### 3. TextLayer 内部再次考虑设备像素比

PDF.js v5 的 TextLayer 会根据 viewport 和输出像素比进行字体测量，并通过 `--total-scale-factor` 等 CSS 变量生成 DOM 文本的位置、字号和变换。

当前代码同时做了三件事：

```js
const scale = zoom * devicePixelRatio;
doc.documentElement.style.transform = `scale(${1 / devicePixelRatio})`;
doc.documentElement.style.setProperty("--total-scale-factor", scale);
```

页面根节点的反向 CSS transform 能让高分辨率 Canvas 在视觉上恢复到接近正确的大小，但它不能可靠地消除 TextLayer 内部字体测量、DOM 布局和浏览器命中测试中的重复缩放。

在 DPR 为 2 的屏幕上，逻辑关系接近：

```text
页面逻辑缩放                zoom
传给 TextLayer 的 viewport  zoom × 2
TextLayer 内部测量比例       viewport.scale × 2
```

最终透明文字可能被放大、偏移或覆盖范围异常。用户看到的 Canvas 是正常的，但鼠标所在位置没有命中对应文字 `<span>`。

### 4. 平移逻辑会放大这个现象

当前指针处理会通过 `elementFromPoint()` 判断指针下是否存在文本：

```js
const hasTextUnderneath =
  elementUnderCursor &&
  (elementUnderCursor.tagName === "SPAN" ||
    elementUnderCursor.tagName === "P") &&
  elementUnderCursor.textContent.trim().length > 0;
```

如果文本层错位，判断结果会是 `false`，代码随即进入拖拽平移模式。在 `pointermove` 中调用 `preventDefault()` 后，浏览器原生选区也会被阻止。

所以用户感受到的是“任何文字都选不了”，实际链路可能是：

```text
TextLayer 几何错位
  → 鼠标没有命中透明 span
  → 被判断为页面空白区域
  → 启动平移并阻止默认拖动
  → 无法形成文本选区
```

---

## 为什么原版本结论不成立

项目中确实同时存在 pdfjs-dist v4 和 v5：

| 使用位置 | 版本情况 |
|---|---|
| `packages/foliate-js` | 声明 `^4.7.76`，lockfile 解析到 4.10.38 |
| `packages/app`、`packages/core`、`packages/cli` | 5.5.207 |
| App 的 Vite 别名 | 将运行时 `pdfjs-dist` 指向仓库根依赖 |

这说明运行时版本可能与 foliate-js 自己声明的版本不同，值得后续统一。但在 5.5.207 中，以下 API 都实际存在：

```js
pdfjsLib.TextLayer
pdfjsLib.AnnotationLayer
page.getTextContent()
page.streamTextContent()
```

因此不能从“运行时使用 v5”推导出“TextLayer 构造失败”。

原方案建议手动遍历 `getTextContent()` 创建 `<span>`，也不适合作为首选修复。PDF 文本定位还涉及：

- 页面旋转
- 字体 ascent / descent
- 水平和垂直缩放
- 字符间距及合并
- 竖排文本
- marked content
- 可访问性属性

只用 `item.transform[4]`、`item.transform[5]` 和 `item.height` 无法完整重建这些规则，容易修好简单英文 PDF，却在中文、旋转页面或复杂排版中产生新的选区偏移。

---

## 与 GitHub issue #600 的关系

Issue [#600](https://github.com/codedogQBY/ReadAny/issues/600) 描述的是 macOS 上“PDF 可选文本存在，但拖选不能可靠选中预期文字”，影响复制、高亮和将选中段落发送给 AI。设备为 Mac mini M4，App 版本为 1.3.5。

这与本文分析的 DPR / TextLayer 几何错位问题高度一致：

- 问题发生在包含 selectable text 的 PDF 上，不像扫描件无文本对象
- 描述是“不能可靠选中预期文字”，更像透明 TextLayer 与可见 Canvas 文字错位，而不是 TextLayer 完全没有渲染
- 影响复制、高亮、AI 选中文本，说明故障点在浏览器选区 / Range / TextLayer 这一层
- macOS + Apple Silicon 设备很可能处在 Retina 或高 DPI 显示环境中，正好会放大 `devicePixelRatio` 被错误混入 viewport 的问题

但目前仍只能判定为“强候选同因”，不能 100% 定案。issue 缺少以下信息：

- 实际 `window.devicePixelRatio`
- 显示器缩放设置和是否外接显示器
- 选区偏移截图或录屏
- 复现用 PDF 样本
- TextLayer span 数量、Canvas 与 TextLayer 的 `getBoundingClientRect()` 对比

因此修复后应优先在 issue #600 的设备环境或同类 macOS Retina 环境中回归验证。它引用的 Android issue [#362](https://github.com/codedogQBY/ReadAny/issues/362) 只能说明跨平台存在相似选区问题；Android 还可能涉及 WebView selection、触摸事件和平移手势策略，不能直接视为同一根因。

---

## 推荐解决方案

### 核心原则

使用两个独立的比例：

```js
const viewport = page.getViewport({ scale: zoom }); // DOM/CSS 逻辑尺寸
const outputScale = window.devicePixelRatio || 1;   // Canvas 像素密度
```

- TextLayer 和 AnnotationLayer 使用 `viewport`
- Canvas 的 CSS 尺寸使用 `viewport.width / height`
- Canvas 的内部像素尺寸乘以 `outputScale`
- Canvas 渲染时通过 `transform` 提升输出分辨率
- 删除 iframe 根节点的 DPR 反向 transform

### 建议代码

`packages/foliate-js/pdf.js` 中的渲染部分建议改为：

```js
const render = async (page, doc, zoom) => {
  if (!doc) return;

  const viewport = page.getViewport({ scale: zoom });
  const outputScale = window.devicePixelRatio || 1;

  doc.documentElement.style.removeProperty("transform");
  doc.documentElement.style.removeProperty("transform-origin");
  doc.documentElement.style.setProperty(
    "--total-scale-factor",
    String(viewport.scale),
  );
  doc.documentElement.style.setProperty("--user-unit", "1");
  doc.documentElement.style.setProperty("--scale-round-x", "1px");
  doc.documentElement.style.setProperty("--scale-round-y", "1px");

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const canvasContext = canvas.getContext("2d");
  const transform =
    outputScale === 1
      ? undefined
      : [outputScale, 0, 0, outputScale, 0, 0];

  await page.render({
    canvasContext,
    viewport,
    transform,
  }).promise;

  const textLayer = new pdfjsLib.TextLayer({
    textContentSource: await page.streamTextContent(),
    container: textContainer,
    viewport,
  });
  await textLayer.render();

  await new pdfjsLib.AnnotationLayer({
    page,
    viewport: viewport.clone({ dontFlip: true }),
    div: annotationDiv,
    linkService,
  }).render({
    annotations: await page.getAnnotations(),
  });
};
```

示例省略了当前代码已有的 DOM 查询、清理和指针事件逻辑，实施时只需要替换 viewport 与 Canvas 输出比例相关部分。

### 补充 CSS

建议明确三层的定位关系，减少浏览器差异：

```css
html,
body {
  margin: 0;
  padding: 0;
}

body {
  position: relative;
  width: 100%;
  height: 100%;
}

#canvas canvas {
  display: block;
}

.textLayer {
  z-index: 1;
  letter-spacing: normal;
  word-spacing: normal;
}

.annotationLayer {
  z-index: 2;
}

.textLayer.selecting ~ .annotationLayer section {
  pointer-events: none;
}
```

AnnotationLayer 本身保留 `pointer-events: none`，具体链接元素继续使用 `pointer-events: auto`。

如果继续直接使用底层 `AnnotationLayer`，建议按 PDF.js 官方 viewer 的做法传入 `viewport.clone({ dontFlip: true })`。更完整的做法是后续迁移到官方 `AnnotationLayerBuilder` / `TextLayerBuilder`，让 PDF.js 统一维护 `selecting`、`endOfContent`、`selectionchange` 和注释层交互状态。

注意：不要只手动追加一个固定在页面末尾的 `.endOfContent` 辅助节点。PDF.js 官方 viewer 会在 `selectionchange` 中把这个节点动态移动到当前选区边界附近，并在 `pointerup` / `blur` / `keyup` 后重置；只复制固定 CSS 和静态节点，容易导致“只拖选一小段却选中整页”的误选。若不使用完整 `TextLayerBuilder`，也应保留这套动态移动与重置逻辑。

---

## 诊断与容错改进

### 1. 区分“文本层错位”和“扫描件没有文字”

有些 PDF 本身只有扫描图片，没有文字对象。这种文件即使 TextLayer 渲染完全正确，也无法直接选择文字。

可以临时记录：

```js
const textContent = await page.getTextContent();
console.debug("[PDF text layer]", {
  page: page.pageNumber,
  itemCount: textContent.items.length,
  viewport: {
    width: viewport.width,
    height: viewport.height,
    scale: viewport.scale,
  },
  devicePixelRatio: window.devicePixelRatio,
});
```

判断方式：

| 结果 | 含义 | 处理 |
|---|---|---|
| `items.length > 0`，但不能选择 | 文本存在，继续检查 TextLayer 布局和命中 | 修复缩放与指针逻辑 |
| `items.length === 0` | PDF 很可能是扫描件或纯图片 | 需要 OCR，不属于 TextLayer 渲染故障 |

### 2. 不要让 TextLayer 失败保持静默

Canvas 完成后，TextLayer 的异常目前没有独立的错误上下文。建议增加：

```js
try {
  const textLayer = new pdfjsLib.TextLayer({
    textContentSource: await page.streamTextContent(),
    container: textContainer,
    viewport,
  });
  await textLayer.render();
} catch (error) {
  console.error("[PDF] Failed to render text layer", {
    page: page.pageNumber,
    error,
  });
}
```

这不会替代根因修复，但可以避免以后再次把“TextLayer 报错”和“TextLayer 错位”混为一谈。

### 3. 修复后再收紧平移判断

缩放修复完成后，可以把命中判断改为基于事件目标：

```js
const textSpan = e.target.closest?.(".textLayer span");
const hasTextUnderneath = Boolean(textSpan?.textContent?.trim());
```

若需要支持 marked content 包装层，可再用 `elementFromPoint()` 作为补充。该改动属于交互加固，不应代替 TextLayer 几何修复。

### 4. 复制文本需要接管 `copy` 事件

PDF.js TextLayer 使用绝对定位的透明 `<span>` 和 `<br>` 还原页面文字。浏览器原生 `selection.toString()` 在这种结构下可能丢失行尾换行，尤其是在复制跨行文本时。

建议和官方 viewer 保持两点一致：

- `streamTextContent()` 使用 `{ includeMarkedContent: true, disableNormalization: true }`
- 在 iframe 文档和 TextLayer 上监听 `copy`，从选区命中的 TextLayer span 中读取文本，并按 span 的页面坐标分行重建 `\n`

这样复制内容会以 TextLayer 的几何行结构为准，而不是完全依赖浏览器对绝对定位文本的默认拼接。对于某些没有把 `<br>` 纳入选区片段的 PDF，这比只读取 `selection.toString()` 或 `Range.cloneContents()` 更稳定。

### 5. 标点处选中背景不连续通常是正常现象

PDF 的文本对象并不一定按自然语言连续切分。标点、连字、缩放字形、CJK 字符和特殊编码文本经常会被 PDF.js 渲染成独立 `<span>`，浏览器只会给这些真实字形盒子绘制选区背景。

因此标点附近出现轻微的选中背景断裂，不一定表示复制结果错误。除非复制文本缺字、乱序或标点丢失，否则不建议用额外背景层强行抹平视觉断点；那会增加选区与真实文本不一致的风险。

---

## 实施顺序

1. 将 viewport 改回纯逻辑缩放：`page.getViewport({ scale: zoom })`
2. 仅在 Canvas 内部像素尺寸和渲染 transform 中应用 DPR
3. 删除 `documentElement` 上用于抵消 DPR 的 CSS transform
4. TextLayer 和 AnnotationLayer 继续共用逻辑 viewport
5. AnnotationLayer 使用 `viewport.clone({ dontFlip: true })`
6. 补齐 TextLayer 基础 CSS，并在 `.textLayer.selecting` 时避免 AnnotationLayer 抢事件
7. 为 TextLayer 增加明确的错误日志
8. 验证无误后，再优化平移与文本命中判断
9. 单独规划 pdfjs-dist 版本统一，避免未来 API 和构建行为漂移

---

## 验证标准

至少覆盖以下组合：

| 场景 | 预期 |
|---|---|
| DPR = 1 | Canvas 与文字选区完全重合 |
| DPR = 2 或 Retina 屏 | 页面清晰，文字仍可准确选择 |
| 适合窗口、100%、200% 缩放 | 每个缩放级别均可选择，选区不漂移 |
| 中文和英文 PDF | 复制结果与页面内容一致 |
| 90° / 180° 旋转页面 | 选区位置与文字方向正确 |
| 带链接的 PDF | 链接可点击，不阻塞普通文字选择 |
| 扫描件 PDF | 明确识别为无文本内容，而不是误报渲染失败 |

运行时还应检查：

```js
textContainer.querySelectorAll("span").length > 0
```

并抽样比较 Canvas 和 TextLayer 的边界：

```js
canvas.getBoundingClientRect()
textContainer.getBoundingClientRect()
```

两者的 `width`、`height` 以及页面原点应基本一致。

---

## 最终建议

首选修复不是替换 PDF.js TextLayer，也不是手工创建文本 `<span>`，而是恢复 PDF.js 的标准分层渲染方式：

> viewport 只表示页面的 CSS 逻辑尺寸；devicePixelRatio 只负责提高 Canvas 的输出分辨率。

这项调整改动集中在 `packages/foliate-js/pdf.js`，能够保留官方 TextLayer 对复杂 PDF 排版的完整处理，同时解决 Retina/高 DPI 环境下透明文本层与可见页面不重合的问题。

GitHub issue #600 的现象应作为修复后的重点验收用例。若修复后 macOS Retina 环境的选区准确恢复，则可以基本确认它与本文主因同源；若仍有偏移，再继续排查 panning 手势、AnnotationLayer 抢事件或特定 PDF 内容问题。
