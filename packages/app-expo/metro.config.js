const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// 1. Watch the monorepo root so Metro can resolve workspace packages
config.watchFolders = [monorepoRoot];

// 2. Tell Metro where to find node_modules in a pnpm monorepo
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// 3. Add support for TypeScript files
config.resolver.sourceExts = [...config.resolver.sourceExts, "ts", "tsx"];

// 4. Add .html to asset extensions so WebView can load local HTML files
config.resolver.assetExts = [...config.resolver.assetExts, "html"];

// 5. Force all packages to use the same React instance from the monorepo root
// pnpm stores packages in node_modules/.pnpm/<package>@<version>/node_modules/<package>
// IMPORTANT: react version must match react-native's renderer version (19.1.4)
const reactPath = path.resolve(monorepoRoot, "node_modules/.pnpm/react@19.1.4/node_modules/react");
const reactNativePath = path.resolve(monorepoRoot, "node_modules/.pnpm/react-native@0.81.6_@babel+core@7.29.0_@types+react@19.1.17_react@19.1.4/node_modules/react-native");

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  react: reactPath,
  "react/jsx-runtime": path.resolve(reactPath, "jsx-runtime"),
  "react/jsx-dev-runtime": path.resolve(reactPath, "jsx-dev-runtime"),
  "react-native": reactNativePath,
};

// 6. Override resolver to redirect modules that depend on Node.js built-ins
const moduleRedirects = {
  punycode: path.resolve(monorepoRoot, "node_modules/punycode/punycode.js"),
};

// Redirect @readany/core modules that pull in LangChain (Node.js-only) to RN stubs
const coreRedirects = {
  "@readany/core/hooks/use-streaming-chat": path.resolve(
    projectRoot,
    "src/hooks/use-streaming-chat.rn.ts",
  ),
};

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Redirect Node built-in polyfills
  if (moduleRedirects[moduleName]) {
    return { type: "sourceFile", filePath: moduleRedirects[moduleName] };
  }
  // Redirect @readany/core modules that depend on LangChain / Node APIs
  if (coreRedirects[moduleName]) {
    return { type: "sourceFile", filePath: coreRedirects[moduleName] };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
