/**
 * WebDAV client using IPlatformService.fetch() — works on both Tauri and Expo.
 * WebDAV is HTTP with custom methods (PROPFIND, MKCOL, PUT, GET, DELETE).
 */

import { getPlatformService } from "../services/platform";
import type { DavResource } from "./sync-types";

export class WebDavClient {
  private baseUrl: string;
  private authHeader: string;
  private allowInsecure: boolean;

  constructor(url: string, username: string, password: string, allowInsecure?: boolean) {
    // Normalize: remove trailing slash
    this.baseUrl = url.replace(/\/+$/, "");
    // Basic auth header
    const credentials = `${username}:${password}`;
    // Use btoa for base64 encoding (available in both environments)
    this.authHeader = `Basic ${btoa(credentials)}`;
    this.allowInsecure = allowInsecure ?? false;
  }

  private buildUrl(path: string): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    // Encode path segments but preserve /
    const encoded = normalizedPath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `${this.baseUrl}${encoded}`;
  }

  private async request(
    method: string,
    path: string,
    options: {
      body?: string | Uint8Array | ArrayBuffer;
      headers?: Record<string, string>;
      contentType?: string;
      timeoutMs?: number;
    } = {},
  ): Promise<Response> {
    const platform = getPlatformService();
    const url = this.buildUrl(path);
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      ...options.headers,
    };
    if (options.contentType) {
      headers["Content-Type"] = options.contentType;
    }

    console.log(`[WebDAV] ${method} ${url}`);
    const startTime = Date.now();

    try {
      const response = await platform.fetch(url, {
        method,
        headers,
        body: options.body as BodyInit | undefined,
        allowInsecure: this.allowInsecure,
        timeoutMs: options.timeoutMs,
      });
      const elapsed = Date.now() - startTime;
      console.log(
        `[WebDAV] ${method} ${url} completed in ${elapsed}ms (status: ${response.status})`,
      );
      return response;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error(`[WebDAV] ${method} ${url} failed after ${elapsed}ms:`, error);
      throw error;
    }
  }

  /** Test if the server is reachable and credentials are valid */
  async ping(): Promise<void> {
    // Prefer OPTIONS for connectivity/auth checks because some servers (including
    // our local test server after its backing data dir is deleted) may return 404
    // for PROPFIND / even though the server is reachable and sync can recreate data.
    const optionsResp = await this.request("OPTIONS", "/", {
      timeoutMs: 10_000,
    });
    if (optionsResp.ok) {
      return;
    }

    // Fall back to PROPFIND for servers that don't expose OPTIONS cleanly.
    const propfindResp = await this.request("PROPFIND", "/", {
      headers: { Depth: "0" },
      body: '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>',
      contentType: "application/xml",
      timeoutMs: 10_000,
    });
    if (!propfindResp.ok && propfindResp.status !== 207 && propfindResp.status !== 404) {
      throw new Error(`WebDAV ping failed: ${propfindResp.status} ${propfindResp.statusText}`);
    }
  }

  /** Test connection, returns true if successful */
  async testConnection(): Promise<boolean> {
    try {
      await this.ping();
      return true;
    } catch {
      return false;
    }
  }

  /** Create a directory (MKCOL) */
  async mkcol(path: string): Promise<void> {
    const resp = await this.request("MKCOL", path);
    // 201 Created, 405 Already Exists — both OK
    if (!resp.ok && resp.status !== 405) {
      throw new Error(`WebDAV MKCOL failed for ${path}: ${resp.status} ${resp.statusText}`);
    }
  }

  /** Ensure a full directory path exists (creates each segment) */
  async ensureDirectory(path: string): Promise<void> {
    const segments = path.split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current += `/${segment}`;
      // MKCOL already handles 405 (Already Exists), no need for a separate HEAD check
      await this.mkcol(current);
    }
  }

  /** Upload data to a path (PUT) */
  async put(
    path: string,
    data: string | Uint8Array | ArrayBuffer,
    contentType = "application/octet-stream",
  ): Promise<void> {
    const resp = await this.request("PUT", path, {
      body: data,
      contentType,
    });
    if (!resp.ok) {
      throw new Error(`WebDAV PUT failed for ${path}: ${resp.status} ${resp.statusText}`);
    }
  }

  /** Upload a JSON object */
  async putJSON(path: string, data: unknown): Promise<void> {
    await this.put(path, JSON.stringify(data), "application/json");
  }

  /** Download data from a path (GET) — returns Uint8Array */
  async get(path: string): Promise<Uint8Array> {
    const resp = await this.request("GET", path);
    if (!resp.ok) {
      throw new Error(`WebDAV GET failed for ${path}: ${resp.status} ${resp.statusText}`);
    }
    const buffer = await resp.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /** Download and parse JSON from a path */
  async getJSON<T>(path: string): Promise<T | null> {
    try {
      const data = await this.get(path);
      const text = new TextDecoder().decode(data);
      return JSON.parse(text) as T;
    } catch (e: unknown) {
      const err = e as { message?: string };
      if (err.message?.includes("404")) return null;
      throw e;
    }
  }

  /** Delete a resource (DELETE) */
  async delete(path: string): Promise<void> {
    const resp = await this.request("DELETE", path);
    // 204 No Content or 404 Not Found — both OK for delete
    if (!resp.ok && resp.status !== 404) {
      throw new Error(`WebDAV DELETE failed for ${path}: ${resp.status} ${resp.statusText}`);
    }
  }

  /** Check if a resource exists (try HEAD first, fallback to PROPFIND Depth 0) */
  async exists(path: string): Promise<boolean> {
    try {
      const resp = await this.request("HEAD", path);
      if (resp.ok) return true;
      if (resp.status === 405) {
        const resp = await this.request("PROPFIND", path, {
          headers: { Depth: "0" },
          body: '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>',
          contentType: "application/xml",
        });
        return resp.ok || resp.status === 207;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** List directory contents (PROPFIND Depth 1) */
  async propfind(path: string): Promise<DavResource[]> {
    const resp = await this.request("PROPFIND", path, {
      headers: { Depth: "1" },
      body: '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/><D:getcontentlength/><D:getlastmodified/><D:getetag/></D:prop></D:propfind>',
      contentType: "application/xml",
    });
    if (!resp.ok && resp.status !== 207) {
      if (resp.status === 404) return [];
      throw new Error(`WebDAV PROPFIND failed for ${path}: ${resp.status} ${resp.statusText}`);
    }
    const xml = await resp.text();
    return parsePropfindResponse(xml, path);
  }

  /** Safely list directory, create if not exists */
  async safeReadDir(path: string): Promise<DavResource[]> {
    try {
      return await this.propfind(path);
    } catch (e: unknown) {
      const err = e as { message?: string };
      if (err.message?.includes("404")) {
        await this.ensureDirectory(path);
        return [];
      }
      throw e;
    }
  }
}

/**
 * Parse a PROPFIND multistatus XML response.
 * Uses regex-based parsing — no DOM parser needed since the XML structure is predictable.
 */
function parsePropfindResponse(xml: string, basePath: string): DavResource[] {
  const resources: DavResource[] = [];

  // Split by <D:response> or <d:response> boundaries (case-insensitive)
  const responseRegex = /<(?:D|d):response[^>]*>([\s\S]*?)<\/(?:D|d):response>/gi;
  let match: RegExpExecArray | null;
  while ((match = responseRegex.exec(xml)) !== null) {
    const block = match[1];

    const href = extractTagContent(block, "href") || "";
    const isCollection =
      block.includes("<D:collection") ||
      block.includes("<d:collection") ||
      block.includes("<D:collection/") ||
      block.includes("<d:collection/");
    const contentLengthStr = extractTagContent(block, "getcontentlength");
    const lastModified = extractTagContent(block, "getlastmodified");
    const etag = extractTagContent(block, "getetag")?.replace(/"/g, "");

    resources.push({
      href: decodeURIComponent(href),
      name: filenameFromHref(href),
      isCollection,
      contentLength: contentLengthStr ? Number.parseInt(contentLengthStr, 10) : undefined,
      lastModified: lastModified || undefined,
      etag: etag || undefined,
    });
  }

  // Filter out the parent directory itself (first result is usually the queried path)
  const baseNormalized = basePath.replace(/\/+$/, "").replace(/^\/+/, "");
  return resources.filter((r) => {
    const hrefNormalized = r.href.replace(/\/+$/, "").replace(/^\/+/, "");
    return hrefNormalized !== baseNormalized;
  });
}

/** Extract text content of an XML tag (case-insensitive, supports D: and d: namespace prefix) */
function extractTagContent(xml: string, localName: string): string | null {
  const regex = new RegExp(`<(?:D|d):${localName}[^>]*>([^<]*)<\\/(?:D|d):${localName}>`, "i");
  const match = regex.exec(xml);
  return match ? match[1].trim() : null;
}

/** Extract filename from a WebDAV href */
function filenameFromHref(href: string): string {
  const decoded = decodeURIComponent(href);
  return decoded.replace(/\/+$/, "").split("/").pop() || "";
}
