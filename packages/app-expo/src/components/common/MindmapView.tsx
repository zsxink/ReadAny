import { Download, RotateCcw } from "@/components/ui/Icon";
import { useColors } from "@/styles/theme";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import WebView from "react-native-webview";

interface MindmapViewProps {
  markdown: string;
  title?: string;
}

const generateHtml = (markdown: string, colors: any) => {
  const escapedMarkdown = markdown
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$");

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
    #mindmap { 
      width: 100%; 
      height: 100%; 
    }
    svg { width: 100%; height: 100%; }
    .markmap-node-circle { cursor: pointer; }
    .markmap-foreign { font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    .markmap-foreign, .markmap-foreign * {
      color: ${colors.foreground} !important;
    }
  </style>
</head>
<body>
  <svg id="mindmap"></svg>
  <script src="https://cdn.jsdelivr.net/npm/markmap-autoloader@0.18.12/dist/index.js"></script>
  <script>
    (function() {
      var markdown = \`${escapedMarkdown}\`;
      var mm = null;
      
      function init() {
        if (!window.markmap || !window.markmap.Transformer || !window.markmap.Markmap) {
          setTimeout(init, 100);
          return;
        }
        
        try {
          var Transformer = window.markmap.Transformer;
          var Markmap = window.markmap.Markmap;
          
          var transformer = new Transformer();
          var result = transformer.transform(markdown);
          
          mm = Markmap.create('#mindmap', {
            autoFit: true,
            duration: 300,
            maxWidth: 200,
            color: function(node) {
              return '${colors.primary}';
            }
          }, result.root);
          
          window._markmap = mm;
          
          window.getSvgContent = function() {
            var svgEl = document.querySelector('#mindmap');
            var cloned = svgEl.cloneNode(true);
            var g = cloned.querySelector('g');
            if (g) {
              g.setAttribute('transform', 'translate(0,0) scale(1)');
            }
            var bbox = { x: -200, y: -200, width: 800, height: 600 };
            try {
              bbox = g.getBBox();
            } catch(e) {}
            var padding = 50;
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
          
          window.resetView = function() {
            if (mm) {
              mm.fit();
            }
          };
          
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'loaded' }));
        } catch (err) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ 
            type: 'error', 
            message: 'Error initializing mindmap: ' + err.message 
          }));
        }
      }
      
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

export function MindmapView({ markdown, title }: MindmapViewProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const webviewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);

  const html = useMemo(() => generateHtml(markdown, colors), [markdown, colors]);

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
        } else if (data.type === "error") {
          console.error("Mindmap error:", data.message);
          setLoading(false);
        } else if (data.type === "svg") {
          const filename = `${title || "mindmap"}.svg`;
          const filepath = `${FileSystem.documentDirectory}${filename}`;
          await FileSystem.writeAsStringAsync(filepath, data.content);
          await Sharing.shareAsync(filepath, { mimeType: "image/svg+xml" });
        }
      } catch (e) {
        console.error("WebView message error:", e);
      }
    },
    [title],
  );

  const displayTitle = title && title.length > 20 ? title.slice(0, 20) + "..." : title;

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
          {displayTitle || t("mindmap.title", "思维导图")}
        </Text>
        <View style={styles.controls}>
          <TouchableOpacity onPress={handleReset} style={styles.button}>
            <RotateCcw size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <TouchableOpacity onPress={handleDownload} style={styles.button}>
            <Download size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.webviewContainer}>
        {loading && (
          <View style={[styles.loading, { backgroundColor: colors.card }]}>
            <ActivityIndicator color={colors.foreground} />
          </View>
        )}
        <WebView
          ref={webviewRef}
          source={{ html }}
          style={styles.webview}
          onLoadEnd={() => setLoading(false)}
          onMessage={onMessage}
          scrollEnabled={false}
          bounces={false}
          originWhitelist={["*"]}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          mixedContentMode="compatibility"
        />
      </View>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          {t("mindmap.zoomHintMindmap", "双指缩放 · 拖动移动 · 点击节点展开/收起")}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
    marginVertical: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  button: {
    padding: 6,
    borderRadius: 4,
  },
  divider: {
    width: 1,
    height: 16,
    marginHorizontal: 4,
  },
  webviewContainer: {
    height: 300,
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
  },
  footer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  hint: {
    fontSize: 13,
  },
});
