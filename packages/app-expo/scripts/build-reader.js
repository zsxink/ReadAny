/**
 * Build script to bundle foliate-js into a self-contained reader.html
 * for use in React Native WebView.
 *
 * Run: node scripts/build-reader.js
 */
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const FOLIATE_DIR = path.resolve(__dirname, "../../foliate-js");
const ASSETS_DIR = path.resolve(__dirname, "../assets/reader");
const TEMPLATE = path.resolve(ASSETS_DIR, "reader.html");

async function buildReader() {
  // Create a temporary entry point
  const entryContent = `
    import { makeBook, View } from "${FOLIATE_DIR.replace(/\\/g, "/")}/view.js";
    import { Overlayer } from "${FOLIATE_DIR.replace(/\\/g, "/")}/overlayer.js";

    window.makeBook = makeBook;
    window.Overlayer = Overlayer;

    if (!customElements.get('foliate-view')) {
      customElements.define('foliate-view', View);
    }

    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'foliate-loaded' }));
    }
  `;

  const entryFile = path.resolve(__dirname, "../.foliate-entry.mjs");
  fs.writeFileSync(entryFile, entryContent);

  try {
    const result = await esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      format: "iife",
      target: "es2020",
      minify: true,
      write: false,
      resolveExtensions: [".js", ".mjs"],
    });

    const bundledJS = result.outputFiles[0].text;

    // Read the template HTML
    let html = fs.readFileSync(TEMPLATE, "utf-8");

    // Replace the module script section with the bundled code
    html = html.replace(
      /<!-- foliate-js modules loaded as module scripts -->[\s\S]*$/,
      `<script>\n${bundledJS}\n</script>\n</body>\n</html>`
    );

    fs.writeFileSync(TEMPLATE, html);
    console.log(`Built reader.html (${Math.round(html.length / 1024)}KB)`);
  } finally {
    if (fs.existsSync(entryFile)) fs.unlinkSync(entryFile);
  }
}

buildReader().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
