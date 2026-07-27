# Android PDF 文字选择异常：完整根因与解决方案

> 更新时间：2026-07-27
>
> 适用分支：`fix/android-pdf-text-selection`
>
> 当前状态：依赖、锁文件、vendor 和 reader bundle 已统一到 5.5.207；针对 Android WebView 的 TextLayer 数值几何兼容修复已补充，仍需 Android 真机回归确认。

## 1. 结论

Android 上 PDF “正常大小的文字无法选择、每行前面只能选到约正常字号 1/20 的小字”的第一层根因，不是触摸事件、长按菜单或页面层级问题，而是 **PDF.js 运行时代码与 TextLayer CSS 来自不同的大版本**。

统一到 5.5.207 后，真机截图进一步证明还有第二层几何问题：TextLayer 已经能选择和复制，但选区命中的是正文旁边的极小文字。截图本身只能证明 TextLayer 与 Canvas 不一致；结合 5.5.207 实现，**PDF.js 5 的 CSS 数值运算和跨文档最小字体测量是高概率兼容路径，仍需真机 computed style 数据最终确认**：

- PDF.js 5 的官方 TextLayer CSS 使用 `calc()` 中的单位乘除法计算字号和最小字体补偿；
- `TextLayer` 类在模块所属的主文档中测量并静态缓存 `--min-font-size`；
- ReadAny 把 TextLayer 实际渲染到另一个 PDF 页面 iframe 中；
- Android WebView 对主文档/iframe 的最小字体策略和 CSS typed arithmetic 支持可能不同；
- 如果 `font-size` 运算失效而逆向缩放仍生效，文字会缩小到约 1/16–1/20 并偏离 Canvas；主文档与 iframe 的最小字体差异会进一步改变补偿结果，但不能单独证明这一比例。

此外，`FixedLayout` 的缩放回调是异步渲染，但布局层不会等待它完成。窗口或 WebView 尺寸连续变化时，多个 Canvas/TextLayer 任务可能交叉结束；如果旧 TextLayer 晚于新 Canvas 完成，最终也会形成不同缩放代次的图层组合。

修复前移动端阅读器的实际组合是：

- `packages/foliate-js` 声明 `pdfjs-dist@^4.7.76`，锁文件解析为 **4.10.38**；
- `packages/app-expo/scripts/build-reader.js` 从 `packages/foliate-js/pdf.js` 打包移动端 reader，因此生成的 `reader.html` 实际包含 **PDF.js 4.10.38**；
- `packages/foliate-js/pdf.js` 内嵌的 TextLayer CSS 和缩放变量却采用 **PDF.js 5.4.x** 的协议；
- `packages/app/public/vendor/pdfjs/pdf.mjs`、`pdf.worker.mjs` 和 `text_layer_builder.css` 是 **5.4.624**；
- `packages/app`、`packages/core`、`packages/cli` 的 npm 依赖则是 **5.5.207**。

修复前仓库中因此同时存在三套 PDF.js 版本/协议：

| 位置 | 声明或实际版本 | 用途 |
|---|---:|---|
| `packages/foliate-js` | `^4.7.76` → 4.10.38 | Expo reader 打包时实际采用的 PDF.js |
| `packages/app`、`packages/core`、`packages/cli` | `^5.5.207` → 5.5.207 | 桌面、核心和 CLI 相关功能 |
| `packages/app/public/vendor/pdfjs/*` | 5.4.624 | Web 端 vendor API、worker 和 CSS |
| `packages/foliate-js/pdf.js` 的 TextLayer CSS | 5.4.x 写法 | 移动端透明文字层样式 |

**最终修复方向：先将所有 `pdfjs-dist` 精确统一为 `5.5.207`，再在 iframe 内重新测量最小字体，并把 TextLayer 每个 span 的字号、旋转和缩放固化为普通数值 CSS；最后更新 vendor 资源并重新生成 Expo 的 `reader.html`。**

只继续修改触摸事件、`z-index`、iframe 结构或 WebView 参数，无法修复当前的文字层字号和几何尺寸。

---

## 2. 为什么“正常文字能看见，却不能选择”

PDF 页面不是一层内容，而是至少三层：

```text
PDF 页面 iframe
└─ #page
   ├─ Canvas                 用户看到的正常大小 PDF 图像
   ├─ .textLayer             透明 DOM 文字，负责选择和复制
   └─ .annotationLayer       链接、表单等交互区域
```

关键区别：

- Canvas 上的文字只是像素，本身永远不能被浏览器当作文字选择；
- 用户拖选时，真正被选择的是 Canvas 上方透明的 `.textLayer span`；
- TextLayer 必须与 Canvas 中的文字保持完全相同的位置、字号、旋转和横向缩放。

当前看到的“正常大小文字”来自 Canvas，所以显示正常并不能证明 TextLayer 正常。

当前能在每行前面选中一行极小文字，说明：

1. PDF 包含可提取的文本，不是纯扫描图片；
2. `page.streamTextContent()` 成功返回了文字；
3. `TextLayer.render()` 已经创建 `<span>`；
4. Android WebView 的原生选择能力并没有完全失效；
5. 真正损坏的是透明文字层的字号和布局。

这条新现象比此前“完全无法选择”的描述更有诊断价值，它直接把故障范围收敛到了 TextLayer 几何计算。

---

## 3. 直接证据

### 3.1 Expo reader 修复前确实打进了 PDF.js 4.10.38

`packages/app-expo/scripts/build-reader.js` 以绝对路径导入：

```js
import { extractPDFChapters, makePDFFromURL } from ".../packages/foliate-js/pdf.js";
```

`packages/foliate-js/pdf.js` 再裸导入：

```js
import * as pdfjsLib from "pdfjs-dist";
import { WorkerMessageHandler } from "pdfjs-dist/build/pdf.worker.mjs";
```

esbuild 会从 `packages/foliate-js` 附近解析该依赖。当前：

```text
packages/foliate-js/node_modules/pdfjs-dist/package.json
version = 4.10.38
```

对已生成文件检查：

```bash
rg -o '4\.10\.38|5\.4\.624|5\.5\.207' \
  packages/app-expo/assets/reader/reader.html | sort | uniq -c
```

修复前结果只出现 `4.10.38`，说明 Android WebView 执行的不是仓库 vendor 中的 5.4.624，也不是其他包声明的 5.5.207。

### 3.2 PDF.js 4.10.38 使用 `--scale-factor`

PDF.js 4.10.38 的 `TextLayer` 会给文字 span 写入类似以下内联样式：

```js
const scaleFactorStr = "calc(var(--scale-factor)*";
divStyle.fontSize =
  `${scaleFactorStr}${TextLayer.#minFontSize * fontHeight}px)`;
```

页面层尺寸同样依赖：

```js
const w = `var(--scale-factor) * ${pageWidth}px`;
const h = `var(--scale-factor) * ${pageHeight}px`;
```

也就是说，4.10.38 的运行时代码要求页面提供：

```css
--scale-factor: <当前 PDF 缩放>;
```

### 3.3 当前项目只设置了 PDF.js 5 的 `--total-scale-factor`

`packages/foliate-js/pdf.js` 当前的 `applyPDFPageScale()` 对 html、body、page、TextLayer 和 AnnotationLayer 设置的是：

```js
element.style.setProperty("--total-scale-factor", scaleValue);
```

没有设置 PDF.js 4 所需的 `--scale-factor`。

同时，项目内嵌的 TextLayer CSS 使用的是 PDF.js 5.4.x 规则：

```css
.textLayer {
  --min-font-size: 1;
  --text-scale-factor:
    calc(var(--total-scale-factor) * var(--min-font-size));
}

.textLayer > :not(.markedContent),
.textLayer .markedContent span:not(.markedContent) {
  --font-height: 0;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  transform:
    rotate(var(--rotate))
    scaleX(var(--scale-x))
    scale(var(--min-font-size-inv));
}
```

这段 CSS 与修复前仓库 vendor 的 `pdfjs-dist@5.4.624` `text_layer_builder.css` 属于同一套 5.x 协议；该协议在 5.5.207 中保持兼容。

由于 PDF.js 4 不会给 span 设置 5.x 所需的 `--font-height`，这套 CSS 也不能独立完成正确的 5.x 布局。

### 3.4 PDF.js 5.5.207 会提供这套 CSS 所需的变量

PDF.js 5.5.207 的 `TextLayer` 会：

```js
container.style.setProperty("--min-font-size", TextLayer.#minFontSize);
divStyle.setProperty("--font-height", `${fontHeight.toFixed(2)}px`);
```

5.5.207 的 `setLayerDimensions()` 使用：

```js
const w = `var(--total-scale-factor) * ${pageWidth}px`;
const h = `var(--total-scale-factor) * ${pageHeight}px`;
```

因此项目的 CSS 和 `applyPDFPageScale()` 明确是按 PDF.js 5.x 编写的，只是修复前移动端实际运行的 JS 仍是 4.10.38。

---

## 4. 完整故障链

```text
app-expo 执行 build-reader.js
  → 打包 packages/foliate-js/pdf.js
  → 裸导入解析到 foliate-js/node_modules/pdfjs-dist@4.10.38
  → PDF.js 4 TextLayer 创建 span
  → span 的内联 font-size 依赖 --scale-factor
  → 项目没有设置 --scale-factor，只设置 --total-scale-factor
  → PDF.js 4 的内联 font-size 在 computed-value 阶段失效
  → span 回到继承/默认字号，而不是 PDF 对应的真实字号
  → PDF.js 4 仍保留 scale(1 / #minFontSize) 的内联 transform
  → Android WebView 测得的最小字体尺寸通常约为 16–20px
  → 默认字号再被缩小为约 1/16–1/20
  → span 聚集在每行起始位置附近，选区只有正常文字约 1/20 大小
  → Canvas 仍按 viewport 正常绘制，所以用户看到的 PDF 外观正常
```

PDF.js 4 的最小字体规避机制本来是：先把字号放大到浏览器允许的最小值，再用 `scale(1 / #minFontSize)` 缩回真实大小。但这个机制必须与有效的 `--scale-factor` 和 4.x 内联字号公式配套使用。当前字号公式失效、缩小 transform 仍生效，正好解释了用户观察到的约 1/20 比例。

精确比例会随 Android WebView 版本、系统字体和最小字体策略变化，因此不一定始终严格等于 1/20。

---

## 5. 为什么前两轮修复没有解决

### 5.1 第一轮：修复了触摸选择与平移竞争

提交 `d775bee5` 主要处理：

- 优先用 `event.target` 判断是否命中文字；
- 触摸输入不进入 PDF 平移模式；
- `pointermove` 不再对 touch 调用 `preventDefault()`；
- 从 PDF TextLayer 开始的触摸不触发下拉书签手势；
- 增加部分 Android WebView 参数。

这些修改可以防止应用主动打断 Android 原生选择，但它们不会改变 TextLayer span 的字号和位置。

因此第一轮解决的是“触摸事件有没有机会创建选区”，而当前问题是“可供选择的 DOM 文字本身只有极小尺寸”。

### 5.2 第二轮：修复了结构和层级，但继续使用了错误的版本协议

提交 `363e0d60` 主要处理：

- 增加 `#page` 容器；
- 明确 Canvas、TextLayer、AnnotationLayer 的层级；
- 给页面和图层设置宽高；
- 关闭 WebView 文本自动调整；
- 将 `--total-scale-factor` 传播到多个容器。

这些结构调整本身合理，但 `--total-scale-factor` 是 PDF.js 5 的协议。实际运行的 PDF.js 4.10.38 仍然读取 `--scale-factor`。

第二轮因此把 5.x 的页面结构补得更完整，却没有消除“4.x JS + 5.x CSS”的根本冲突。

### 5.3 新现象说明事件修复很可能已经生效

现在已经可以选中极小文字，说明至少一部分触摸事件修复已生效：浏览器成功建立了选区。继续把主要精力放在 `contextmenu`、长按定时器、`z-index` 或 Pull Bookmark 上，会偏离当前直接证据。

---

## 6. 推荐解决方案

### 6.1 将所有直接依赖精确锁定到 5.5.207

修改以下文件：

```text
packages/foliate-js/package.json
packages/app/package.json
packages/core/package.json
packages/cli/package.json
```

统一为：

```json
"pdfjs-dist": "5.5.207"
```

`packages/foliate-js/pdf.js` 在源码中直接导入并执行 `pdfjs-dist`，因此它对 PDF.js 是实际构建/运行依赖。建议同时把该项从 `devDependencies` 移到 `dependencies`：

```json
{
  "dependencies": {
    "pdfjs-dist": "5.5.207"
  }
}
```

Expo 包不需要再额外声明一份 PDF.js；应由直接导入它的 `foliate-js` 正确声明依赖，让 esbuild 从明确且唯一的位置解析。

不要使用：

```json
"pdfjs-dist": "^5.5.207"
```

原因是 `^5.5.207` 允许安装后续 5.x 版本，再次让源码、worker、CSS 和生成产物发生漂移。

### 6.2 建议增加 pnpm override 作为版本护栏

在根 `package.json` 的 `pnpm.overrides` 中加入：

```json
{
  "pnpm": {
    "overrides": {
      "pdfjs-dist": "5.5.207"
    }
  }
}
```

该项不是替代各包的精确声明，而是防止未来某个 workspace 包或间接依赖再次带入其他 PDF.js 版本。

### 6.3 更新锁文件和本地链接

执行：

```bash
pnpm install
```

仓库同时保留根 `pnpm-lock.yaml` 和 `packages/foliate-js/package-lock.json`，两者都必须刷新。完成后必须确认：

- `pnpm-lock.yaml` 中不再存在 `pdfjs-dist@4.10.38`；
- `pnpm-lock.yaml` 中不再存在 `pdfjs-dist@5.4.624`；
- 四个 workspace importer 都解析到 `5.5.207`；
- `packages/foliate-js/package-lock.json` 只记录 `pdfjs-dist@5.5.207`；
- 从 `packages/foliate-js/pdf.js` 出发解析 `pdfjs-dist` 时得到 5.5.207。

pnpm 的 hoisted 布局可能不会创建 `packages/foliate-js/node_modules/pdfjs-dist`；这种情况下向上解析到根 `node_modules/pdfjs-dist@5.5.207` 是正常结果。判断依据应是模块实际解析结果，而不是要求固定的 node_modules 目录形态。

### 6.4 重新生成移动端 reader.html

依赖更新后执行：

```bash
pnpm --filter @readany/app-expo build:reader
```

必须提交重新生成的：

```text
packages/app-expo/assets/reader/reader.html
```

只改 `package.json` 和锁文件而不重新生成 `reader.html`，已安装 App 仍会运行旧的 PDF.js 4.10.38 bundle，问题不会消失。

### 6.5 保持 API、worker、CSS 同版本

最终应满足：

```text
PDF.js API            5.5.207
PDF.js worker         5.5.207
TextLayer CSS         5.5.207 协议
vendor pdf.mjs        5.5.207
vendor pdf.worker.mjs 5.5.207
reader.html bundle    5.5.207
```

`packages/foliate-js/pdf.js` 当前通过 `pdfjsLib.version` 生成 CDN worker、CMap 和标准字体地址；依赖统一后，这些 URL 也会自动指向 5.5.207。

### 6.6 在 iframe 内固化 TextLayer 数值几何

统一版本解决了 4.x/5.x 协议错配，但 Android 真机仍可能不能可靠执行 PDF.js 5 CSS 中的数值乘除法。`packages/foliate-js/pdf.js` 因此在 `TextLayer.render()` 完成后执行以下兼容处理：

1. 在 PDF 页面 iframe 自己的 `document` 中用 1px 探针测量实际最小字体尺寸；
2. 使用 `viewport.scale * viewport.userUnit` 得到与 Canvas 相同的总缩放；
3. 从每个 span 的 `--font-height`、`--scale-x` 和 `--rotate` 读取 PDF.js 已计算的原始几何；
4. 写入明确的像素字号和纯数字 `rotate/scaleX/scale` transform；
5. Canvas 使用旋转后的 `viewport.width/height`；TextLayer 和 AnnotationLayer 使用未旋转的 `rawDims * totalScaleFactor`，再按 PDF.js 官方 `data-main-rotation` 规则旋转，保证 0/90/180/270 度页面坐标一致。
6. 为每个 PDF iframe 维护唯一渲染代次；新缩放开始时取消旧 Canvas/TextLayer 任务，旧任务即使稍后返回也不能再写入页面。

等价计算为：

```text
fontSizePx = fontHeight * viewport.scale * viewport.userUnit * minimumFontSize
transform  = rotate(angle) scaleX(scaleX) scale(1 / minimumFontSize)
```

最终视觉字号仍是 `fontHeight * viewport.scale * viewport.userUnit`，但不再要求 Android WebView 在 CSS `calc()` 中完成单位乘除，也不再复用主文档测得的最小字体值。

这不是手工重建 PDF 文字层：文字内容、位置百分比、字体、旋转和横向缩放仍由官方 `TextLayer` 生成，只把它生成后的 CSS 变量表达式解析为兼容性更强的普通数值 CSS。

### 6.7 暂时保留前两轮触摸和结构修复

版本统一时不建议立即撤销前两轮修改。它们分别处理：

- 触摸输入不应被桌面平移逻辑阻止；
- PDF 页面三层结构、尺寸和层级应明确；
- 下拉书签手势不应与 TextLayer 选择竞争。

这些修改不是当前字号异常的根因，但在 TextLayer 几何恢复后仍有可能是 Android 原生选择稳定工作所需要的配套条件。

应先完成版本统一和真机回归，再根据测试结果逐项精简，而不是在同一轮同时回退多个变量。

### 6.8 兼容性和回归风险

统一到 5.5.207 对不同包的含义不同：

- `foliate-js`：从 4.10.38 升级到 5.5.207，是本次修复的核心；
- `app`、`core`、`cli`：从可漂移的 `^5.5.207` 改为精确 `5.5.207`；
- `packages/app/public/vendor/pdfjs`：从 5.4.624 升级到 5.5.207。

`pdfjs-dist@5.5.207` 要求 Node.js `>=20.19.0 || >=22.13.0 || >=24`。当前开发环境为 Node.js 24，满足要求；CI、EAS 和发布构建环境也应一并确认。

由于 `core` 和 `cli` 存在 PDF 文本提取功能，版本统一后除移动端 reader 外，还应至少运行桌面构建、core 测试和 CLI 检查，避免把 Android 修复变成其他端的回归。

---

## 7. 不推荐作为主修复的方案

### 7.1 只补一个 `--scale-factor`

临时同时设置：

```js
element.style.setProperty("--scale-factor", scaleValue);
element.style.setProperty("--total-scale-factor", scaleValue);
```

可能让 PDF.js 4 的部分尺寸恢复，但仍然保留以下问题：

- 4.x JS 与 5.x CSS 的最小字体补偿机制不同；
- 4.x 通过内联 `font-size/transform` 布局，5.x 通过 CSS 变量布局；
- worker、AnnotationLayer 和未来维护仍可能继续错配；
- 仓库仍同时存在三个版本。

它只能作为快速诊断实验，不应作为最终方案。

### 7.2 手工重建 TextLayer span

PDF 文字定位涉及旋转、ascent/descent、横向缩放、竖排文字、marked content、字体替换和可访问性。手工遍历 `getTextContent()` 创建 span 很容易只修好简单 PDF，却破坏中文、复杂排版或旋转页面。

应继续使用 PDF.js 官方 `TextLayer`，并保证 JS 与 CSS 协议一致。

### 7.3 继续只调整 z-index、透明度或 pointer-events

当前极小文字已经能被选择，说明 TextLayer 位于可交互链路中。层级调整无法补齐错配的缩放变量，也无法让 4.x JS 按 5.x CSS 的布局协议工作。

### 7.4 把 WebView 参数当作主修复

`overScrollMode`、缩放控件和手势参数会影响交互体验，但不会改变 PDF.js 4 和 5 的 CSS 变量协议。

---

## 8. 实施后的自动检查

### 8.1 依赖只能剩一个版本

```bash
pnpm why -r pdfjs-dist
```

期望所有直接使用方都指向 `5.5.207`。

```bash
rg -n 'pdfjs-dist@4\.|pdfjs-dist@5\.4\.' pnpm-lock.yaml
```

期望无输出。

```bash
node -e "const l=require('./packages/foliate-js/package-lock.json'); console.log(l.packages['node_modules/pdfjs-dist'].version)"
```

期望只输出 `5.5.207`。不要直接搜索锁文件中所有 `4.x` 版本；其他依赖可以合法使用自己的 4.x 版本，这与 PDF.js 是否统一无关。

### 8.2 检查生成 bundle 的版本

```bash
rg -o '4\.10\.38|5\.4\.624|5\.5\.207' \
  packages/app-expo/assets/reader/reader.html | sort | uniq -c
```

期望只出现 `5.5.207`。

### 8.3 检查 API 与 worker 版本一致

PDF.js 在 API/worker 版本不一致时通常会报类似：

```text
The API version "x" does not match the Worker version "y".
```

Android 调试日志和 WebView console 中不得出现该错误。

### 8.4 检查 TextLayer 变量

在 PDF 页面 iframe 中检查任意文字 span：

```js
const layer = document.querySelector(".textLayer");
const span = layer?.querySelector("span");

({
  totalScaleFactor: getComputedStyle(layer)
    .getPropertyValue("--total-scale-factor"),
  minFontSize: getComputedStyle(layer)
    .getPropertyValue("--min-font-size"),
  fontHeight: span?.style.getPropertyValue("--font-height"),
  computedFontSize: span ? getComputedStyle(span).fontSize : null,
  layerRect: layer?.getBoundingClientRect(),
  spanRect: span?.getBoundingClientRect(),
});
```

期望：

- `--total-scale-factor` 为当前页面缩放值；
- `--min-font-size` 为 PDF.js 测得的正数；
- span 的 `--font-height` 是非零 px 值；
- `computedFontSize` 大于 0；
- `.textLayer` 的宽高与 Canvas 的 CSS 宽高一致；
- span 覆盖在 Canvas 对应文字上，而不是聚集在行首。

---

## 9. Android 真机验收矩阵

自动构建成功不能代替真机选择测试。至少覆盖：

| 场景 | 验收标准 |
|---|---|
| 中文文本 PDF | 长按能选中手指下的字，选区与 Canvas 对齐 |
| 英文文本 PDF | 单词选择、同一行拖选正常 |
| 跨行选择 | 选区能连续跨越两行以上，无行首小字 |
| 多栏 PDF | 不跨栏误选，文本顺序基本符合 PDF 文本流 |
| 旋转页面 | 选择框位置和方向正确 |
| 放大/缩小后 | TextLayer 与 Canvas 仍保持对齐 |
| 翻页后 | 新页面仍可选择，无旧页面选区残留 |
| 复制 | 复制结果与可见选区一致，无重复或明显缺字 |
| 纯扫描 PDF | 不应出现伪文字选择；明确属于无文本层样本 |

建议至少在两个 Android System WebView/Chrome 大版本上测试，因为字体最小尺寸和长按选择行为可能存在平台差异。

---

## 10. 如果统一版本后仍有问题

先区分问题类型，不要再次混合排查：

### A. 仍然出现行首极小文字

优先检查：

1. App 内使用的 `reader.html` 是否真的是刚生成的文件；
2. bundle 中是否仍包含 `4.10.38`；
3. `packages/foliate-js/node_modules/pdfjs-dist` 是否仍是旧目录；
4. span 是否拿到了非零 `--font-height`；
5. span 的内联 `font-size` 和 `transform` 是否已经变成普通数值，而不是只依赖 CSS 变量；
6. TextLayer 的宽高是否与 Canvas 的 CSS 宽高完全一致；
7. API 与 worker 是否混用了不同版本。

这属于版本、构建产物或 TextLayer 数值几何兼容层未生效，而不是 Android 手势问题。

### B. 文字大小和位置正确，但长按无法建立选区

此时才重新检查：

- `pointerdown/pointermove` 是否调用了 `preventDefault()`；
- Pull Bookmark、点击翻页、笔记长按是否抢占触摸；
- `contextmenu` 策略是否影响系统工具栏；
- 特定 Android WebView 版本的原生 selection 行为。

前两轮修复主要覆盖的就是这一层。

### C. 能选择，但复制文本顺序错误

这属于 PDF 文本内容顺序和 `getSelectedText()` 归并逻辑，不是 TextLayer 几何问题，应使用多栏、竖排、复杂中文 PDF 单独分析。

---

## 11. 完成定义

本问题只有同时满足以下条件才能视为修复完成：

- 四个 workspace 包全部精确依赖 `pdfjs-dist@5.5.207`；
- 锁文件中只保留一套 PDF.js 版本；
- Expo `reader.html` 已重新生成且只包含 5.5.207；
- API、worker、TextLayer CSS 和 vendor 文件版本一致；
- Android 真机不再出现每行前面的极小可选文字；
- 正常大小 Canvas 文字对应位置可以建立选区；
- 同行、跨行、缩放后和翻页后的选择均通过；
- 复制结果与可见选区一致；
- 桌面 PDF、核心 PDF 提取和 CLI PDF 功能没有版本升级回归。

## 12. 最终判断

当前现象不是“Android 不支持 PDF 文字选择”，也不是“PDF.js 没有生成文字层”。恰恰相反，极小文字能够被选中，证明文字层和选择机制都存在。

完整问题由两层组成：

> Android reader 实际执行 PDF.js 4.10.38，却使用 PDF.js 5.4.x 的 TextLayer CSS 和缩放变量；4.x 需要的 `--scale-factor`、内联字号布局，与 5.x 的 `--total-scale-factor`、`--font-height` 布局不能混用，最终导致透明文字层字号趋近于零并与 Canvas 脱离。

> 统一到 5.5.207 后，截图确认仍存在 TextLayer 几何错位。代码审计显示 PDF.js 5 依赖 CSS typed arithmetic，并在模块主文档而不是页面 iframe 中缓存最小字体尺寸；Android WebView 若使字号表达式失效而逆向缩放继续生效，就能解释旁置小字，但该兼容路径仍需真机 computed style 数据确认。

因此最小且正确的修复不是继续堆叠触摸特判，而是先把 PDF.js API、worker、CSS、依赖和生成产物统一到 **5.5.207**，再把官方 TextLayer 已计算出的几何在实际 iframe 中固化为普通数值 CSS，最后进行 Android 真机选择回归。
