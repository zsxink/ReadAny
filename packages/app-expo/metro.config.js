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

// 4. Force all packages to use the same React instance
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  react: path.resolve(projectRoot, "node_modules/react"),
  "react/jsx-runtime": path.resolve(projectRoot, "node_modules/react/jsx-runtime"),
  "react/jsx-dev-runtime": path.resolve(projectRoot, "node_modules/react/jsx-dev-runtime"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
};

// 5. Override resolver to redirect Node built-in "punycode" to the npm package
const nodeBuiltinRedirects = {
  punycode: path.resolve(projectRoot, "node_modules/punycode/punycode.js"),
};
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (nodeBuiltinRedirects[moduleName]) {
    return { type: "sourceFile", filePath: nodeBuiltinRedirects[moduleName] };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
