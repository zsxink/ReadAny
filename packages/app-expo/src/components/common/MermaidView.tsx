import { Download, RotateCcw } from "@/components/ui/Icon";
import { useColors } from "@/styles/theme";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import WebView from "react-native-webview";

interface MermaidViewProps {
  chart: string;
  title?: string;
}

const generateHtml = (colors: any) => {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { 
      width: 100%; 
      height: 100%; 
      overflow: hidden;
      background: ${colors.background};
      touch-action: none;
    }
    #container { 
      width: 100%; 
      height: 100%; 
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #container svg { 
      width: 100% !important; 
      height: 100% !important; 
      max-width: 100% !important; 
      max-height: 100% !important;
      cursor: grab; 
    }
    #container svg:active { cursor: grabbing; }
    .error { color: #e53935; padding: 20px; font-size: 14px; }
  </style>
</head>
<body>
  <div id="container"></div>
  <script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
  <script>
    (function() {
      var zoom = null;
      var currentChart = '';
      
      function init() {
        if (!window.mermaid || !window.d3) {
          setTimeout(init, 100);
          return;
        }
        
        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          themeVariables: {
            primaryColor: '${colors.card}',
            primaryTextColor: '${colors.foreground}',
            primaryBorderColor: '${colors.border}',
            lineColor: '${colors.foreground}',
            secondaryColor: '${colors.muted}',
            tertiaryColor: '${colors.background}',
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          },
          flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis' },
          sequence: { useMaxWidth: false },
          gantt: { useMaxWidth: false },
        });
        
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'loaded' }));
      }
      
      window.renderChart = function(chart) {
        if (!chart) return;
        currentChart = chart;
        
        mermaid.render('mermaid-svg-' + Date.now(), chart).then(function(result) {
          var container = document.getElementById('container');
          container.innerHTML = result.svg;
          
          var svg = container.querySelector('svg');
          if (svg) {
            // 保存原始 viewBox 或计算新的
            var viewBox = svg.getAttribute('viewBox');
            var width = svg.getAttribute('width');
            var height = svg.getAttribute('height');
            
            // 设置 SVG 填满容器
            svg.style.width = '100%';
            svg.style.height = '100%';
            svg.style.cursor = 'grab';
            svg.removeAttribute('width');
            svg.removeAttribute('height');
            
            // 如果没有 viewBox，根据 width/height 创建
            if (!viewBox && width && height) {
              svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
            }
            
            var contentG = svg.querySelector('.mermaid-content');
            if (!contentG) {
              contentG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
              contentG.classList.add('mermaid-content');
              
              var children = Array.from(svg.childNodes);
              children.forEach(function(child) {
                if (child.nodeName !== 'style' && child !== contentG) {
                  contentG.appendChild(child);
                }
              });
              svg.appendChild(contentG);
            }
            
            zoom = d3.zoom()
              .scaleExtent([0.1, 10])
              .on('zoom', function(event) {
                contentG.setAttribute('transform', String(event.transform));
              });
            
            d3.select(svg).call(zoom);
          }
        }).catch(function(err) {
          console.error('Mermaid render error:', err);
        });
      };
      
      window.resetView = function() {
        var svg = document.querySelector('#container svg');
        if (svg && zoom) {
          d3.select(svg).transition().duration(300).call(zoom.transform, d3.zoomIdentity);
        }
      };
      
      window.getSvgContent = function() {
        var svg = document.querySelector('#container svg');
        if (!svg) return '';
        var cloned = svg.cloneNode(true);
        var g = cloned.querySelector('g');
        if (g) {
          g.setAttribute('transform', 'translate(0,0) scale(1)');
        }
        var bbox = { x: 0, y: 0, width: 800, height: 600 };
        try { bbox = cloned.getBBox(); } catch(e) {}
        var padding = 20;
        cloned.setAttribute('viewBox', (bbox.x - padding) + ' ' + (bbox.y - padding) + ' ' + (bbox.width + padding * 2) + ' ' + (bbox.height + padding * 2));
        cloned.setAttribute('width', bbox.width + padding * 2);
        cloned.setAttribute('height', bbox.height + padding * 2);
        var bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgRect.setAttribute('x', bbox.x - padding);
        bgRect.setAttribute('y', bbox.y - padding);
        bgRect.setAttribute('width', bbox.width + padding * 2);
        bgRect.setAttribute('height', bbox.height + padding * 2);
        bgRect.setAttribute('fill', '${colors.background}');
        cloned.insertBefore(bgRect, cloned.firstChild);
        return cloned.outerHTML;
      };
      
      if (document.readyState === 'complete') {
        init();
      } else {
        window.addEventListener('load', init);
      }
    })();
  </script>
</body>
</html>`;
};

export function MermaidView({ chart, title }: MermaidViewProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const webviewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const chartRef = useRef(chart);

  // 同步 chart 到 ref
  useEffect(() => {
    chartRef.current = chart;
  }, [chart]);

  const html = useMemo(() => generateHtml(colors), [colors]);

  // 渲染图表的函数
  const renderChart = useCallback((chartToRender: string) => {
    if (!webviewRef.current || !chartToRender) return;

    const escapedChart = chartToRender
      .replace(/\\/g, "\\\\")
      .replace(/`/g, "\\`")
      .replace(/\$/g, "\\$");

    webviewRef.current.injectJavaScript(`
      (function() {
        if (window.renderChart) {
          window.renderChart(\`${escapedChart}\`);
        }
      })();
      true;
    `);
  }, []);

  // 当 isReady 变为 true 时，渲染当前 chart
  useEffect(() => {
    if (isReady && chartRef.current) {
      renderChart(chartRef.current);
    }
  }, [isReady, renderChart]);

  // 当 chart 变化时渲染
  useEffect(() => {
    if (isReady && chart) {
      renderChart(chart);
    }
  }, [chart, isReady, renderChart]);

  const handleReset = useCallback(() => {
    webviewRef.current?.injectJavaScript(`
      (function() {
        if (window.resetView) {
          window.resetView();
        }
      })();
      true;
    `);
  }, []);

  const handleDownload = useCallback(async () => {
    webviewRef.current?.injectJavaScript(`
      (function() {
        const svgContent = window.getSvgContent();
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'svg', content: svgContent }));
      })();
      true;
    `);
  }, []);

  const onMessage = useCallback(
    async (event: any) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === "loaded") {
          setLoading(false);
          setIsReady(true);
        } else if (data.type === "svg") {
          const filename = `${title || "mermaid"}.svg`;
          const filepath = `${FileSystem.documentDirectory}${filename}`;
          await FileSystem.writeAsStringAsync(filepath, data.content);
          await Sharing.shareAsync(filepath, { mimeType: "image/svg+xml" });
        } else if (data.type === "debug") {
          console.log("[Mermaid Debug]", data.message);
        }
      } catch (e) {
        console.error("WebView message error:", e);
      }
    },
    [title],
  );

  const displayTitle = title && title.length > 20 ? title.slice(0, 20) + "..." : title;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.mutedForeground }]} numberOfLines={1}>
          {displayTitle || t("mindmap.mermaidChart", "Mermaid 图表")}
        </Text>
        <View style={styles.controls}>
          <TouchableOpacity onPress={handleReset} style={styles.button}>
            <RotateCcw size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleDownload} style={styles.button}>
            <Download size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.webviewContainer}>
        {loading && (
          <View style={[styles.loading, { backgroundColor: colors.background }]}>
            <ActivityIndicator color={colors.foreground} />
          </View>
        )}
        <WebView
          ref={webviewRef}
          source={{ html }}
          style={styles.webview}
          onMessage={onMessage}
          scrollEnabled={false}
          bounces={false}
          originWhitelist={["*"]}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          mixedContentMode="compatibility"
        />
      </View>

      <View style={[styles.footer, { borderColor: colors.border }]}>
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          {t("mindmap.zoomHint", "双击放大 · 双指缩放 · 拖动移动")}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    marginVertical: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  title: {
    fontSize: 13,
    flex: 1,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  button: {
    padding: 4,
    borderRadius: 4,
  },
  webviewContainer: {
    height: 280,
    overflow: "hidden",
  },
  webview: {
    flex: 1,
    backgroundColor: "transparent",
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  footer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  hint: {
    fontSize: 13,
  },
});
