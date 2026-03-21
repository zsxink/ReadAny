import type { ILocalEmbeddingEngine } from "@readany/core/ai/local-embedding-service";
import Constants from "expo-constants";
import * as FileSystem from "expo-file-system";

export class RNEmbeddingEngine implements ILocalEmbeddingEngine {
  private generator: any = null;
  private transformers: any = null;

  private async ensureTransformers(): Promise<any> {
    if (this.transformers) return this.transformers;

    const isExpoGo = Constants.executionEnvironment === "storeClient" || Constants.appOwnership === "expo";
    if (isExpoGo) {
      throw new Error("本地向量模型推理依赖 ONNX C++ 原生引擎库。Expo Go 沙盒均不提供。请编译自定义原生客户端体验本地大模型！");
    }

    try {
      this.transformers = await import("@huggingface/transformers");
    } catch (e) {
      console.warn("[RNEmbeddingEngine] Transformers/ONNX not available natively", e);
      throw e;
    }

    const { env } = this.transformers;
    env.allowLocalModels = false;
    
    // Disable WASM threads to prevent issues in strict environments
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.numThreads = 1;
    }

    // Intercept fetch to cache model files on disk
    const originalFetch = fetch;
    const cacheDir = `${(FileSystem as any).documentDirectory}models/`;
    
    await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true }).catch(() => {});

    // @ts-ignore - transformers.js v3 allows overriding fetch on the env object
    env.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = url.toString();
      
      // Only cache huggingface model files
      if (!urlStr.includes("huggingface.co")) {
        return originalFetch(url, init);
      }

      const filename = urlStr.split("/").pop() || "unknown";
      // Generate a unique cache key based on URL path to avoid collisions
      const urlPath = new URL(urlStr).pathname.replace(/[^a-zA-Z0-9]/g, "_");
      const localUri = `${cacheDir}${urlPath}_${filename}`;

      try {
        const fileInfo = await FileSystem.getInfoAsync(localUri);
        if (fileInfo.exists) {
          console.log(`[RNEmbeddingEngine] Cache HIT for ${filename}`);
          // Read as binary string, then convert to ArrayBuffer
          const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: "base64" });
          const binaryStr = atob(base64);
          const len = binaryStr.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          
          return new Response(bytes.buffer, {
            status: 200,
            headers: new Headers({ "Content-Type": "application/octet-stream" })
          });
        }
      } catch (e) {
        console.warn(`[RNEmbeddingEngine] Cache read error for ${filename}:`, e);
      }

      console.log(`[RNEmbeddingEngine] Cache MISS for ${filename}. Downloading...`);
      const response = await originalFetch(url, init);
      
      if (response.ok) {
        try {
          // Clone the response so we can both save it and return it
          const resClone = response.clone();
          const buffer = await resClone.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          
          // Convert to base64 for writing via Expo FileSystem
          // This is a bit expensive for large models but works reliably
          let binaryStr = "";
          for (let i = 0; i < bytes.length; i++) {
            binaryStr += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binaryStr);
          
          await FileSystem.writeAsStringAsync(localUri, base64, { encoding: "base64" });
          console.log(`[RNEmbeddingEngine] Saved ${filename} to cache`);
        } catch (e) {
          console.warn(`[RNEmbeddingEngine] Failed to cache ${filename}:`, e);
        }
      }
      
      return response;
    };
    
    return this.transformers;
  }

  async init(): Promise<void> {
    // No-op for Expo initialization to prevent crashing on standard App startup.
    // Transformers and its native modules will be lazily loaded in `load()`.
  }

  async load(modelId: string, hfModelId: string, onProgress?: (p: number) => void): Promise<void> {
    const transformers = await this.ensureTransformers().catch(() => null);
    if (!transformers) {
      console.warn("[RNEmbeddingEngine] Transformers engine not loaded. Cannot load model.");
      return;
    }
    try {
      console.log(`[RNEmbeddingEngine] Loading model ${hfModelId}...`);
      
      const { pipeline } = transformers;
      // Initialize pipeline
      this.generator = await pipeline("feature-extraction", hfModelId, {
        progress_callback: (info: any) => {
          if (info.status === "progress" && onProgress) {
            onProgress(info.progress);
          }
        },
        dtype: "q8",
      });

      console.log(`[RNEmbeddingEngine] Model ${hfModelId} ready!`);
    } catch (e) {
      console.error(`[RNEmbeddingEngine] Failed to load model:`, e);
      throw e;
    }
  }

  async generate(
    modelId: string,
    texts: string[],
    onItemProgress?: (done: number, total: number) => void,
  ): Promise<number[][]> {
    if (!this.generator) {
      throw new Error("RNEmbeddingEngine pipeline not loaded.");
    }

    const embeddings: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      // Generate embedding for one text
      const output = await this.generator(text, { pooling: "mean", normalize: true });
      
      // Extract Float32Array to standard JS Array
      embeddings.push(Array.from(output.data));

      onItemProgress?.(i + 1, texts.length);
    }
    return embeddings;
  }

  async dispose(): Promise<void> {
    if (this.generator) {
      try {
        await this.generator.dispose();
      } catch (e) {
        console.warn("[RNEmbeddingEngine] Error disposing pipeline:", e);
      }
      this.generator = null;
    }
  }

  async clearCache(hfModelId: string): Promise<void> {
    // Currently relying on React Native's fetch cache or custom polyfills.
    // If transformers.js uses Cache API, we might need a custom clear mechanism.
    this.generator = null;
    console.log(`[RNEmbeddingEngine] Cleared cache flag for ${hfModelId}`);
  }
}
