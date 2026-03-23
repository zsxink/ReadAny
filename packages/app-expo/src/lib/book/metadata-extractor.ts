/**
 * Book metadata + cover extraction for React Native (Expo).
 *
 * EPUB: pure-JS ZIP decompression + XML parsing (no DOMParser dependency).
 * PDF:  title extracted from file name (pdfjs-dist not available in RN).
 *
 * Uses pako for Deflate decompression (Hermes does NOT support DecompressionStream).
 *
 * Optimized: only decompresses the 2-3 ZIP entries needed for metadata
 * (container.xml, OPF, cover image) instead of the entire EPUB.
 */
import pako from "pako";

export interface ExtractedMeta {
  title: string;
  author: string;
  coverBytes: Uint8Array | null;
  coverMimeType: string | null;
}

// ─── EPUB extraction ────────────────────────────────────────────────

export async function extractEpubMetadata(fileBytes: Uint8Array): Promise<ExtractedMeta> {
  const buf = new Uint8Array(fileBytes);
  const directory = parseZipDirectory(buf);

  // 1. Read container.xml to find OPF path
  const containerXml = readTextFromZip(buf, directory, "META-INF/container.xml");
  if (!containerXml) {
    console.warn("[extractEpubMetadata] container.xml not found");
    return { title: "", author: "", coverBytes: null, coverMimeType: null };
  }

  const opfPath = parseAttribute(containerXml, "rootfile", "full-path") || "content.opf";
  const opfDir = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1) : "";

  // 2. Read OPF and extract title / author
  const opfXml = readTextFromZip(buf, directory, opfPath);
  if (!opfXml) {
    console.warn(`[extractEpubMetadata] OPF not found at: ${opfPath}`);
    return { title: "", author: "", coverBytes: null, coverMimeType: null };
  }

  const title = extractTagContent(opfXml, "dc:title") || extractTagContent(opfXml, "title") || "";
  const author =
    extractTagContent(opfXml, "dc:creator") || extractTagContent(opfXml, "creator") || "";

  // 3. Extract cover image (only decompress the cover entry)
  let coverBytes: Uint8Array | null = null;
  let coverMimeType: string | null = null;

  try {
    const coverHref = findCoverHref(opfXml);
    if (coverHref) {
      const decoded = decodeURIComponent(coverHref);
      const candidates = [opfDir + decoded, opfDir + coverHref, decoded, coverHref];
      for (const candidate of candidates) {
        const data = readBytesFromZip(buf, directory, candidate);
        if (data) {
          coverBytes = data;
          coverMimeType = guessMimeType(candidate);
          break;
        }
      }
    }
  } catch (err) {
    console.warn("[extractEpubMetadata] cover extraction error:", err);
  }

  return { title: title.trim(), author: author.trim(), coverBytes, coverMimeType };
}

// ─── Generic metadata from file bytes ──────────────────────────────

export async function extractBookMetadata(
  fileBytes: Uint8Array,
  format: string,
  fileName: string,
): Promise<ExtractedMeta> {
  const fallback: ExtractedMeta = {
    title: fileName.replace(/\.\w+$/i, "") || "Untitled",
    author: "",
    coverBytes: null,
    coverMimeType: null,
  };

  try {
    switch (format) {
      case "epub":
        return await extractEpubMetadata(fileBytes);
      // Future: mobi/azw3/fb2 parsers can be added here
      default:
        return fallback;
    }
  } catch (err) {
    console.warn(`[extractBookMetadata] failed for ${format}:`, err);
    return fallback;
  }
}

// ─── Lazy ZIP reader: parse directory first, decompress on demand ───

interface ZipDirectoryEntry {
  filename: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/**
 * Parse the ZIP central directory WITHOUT decompressing any entries.
 * This is fast O(n) on entry count, with no decompression overhead.
 */
function parseZipDirectory(buf: Uint8Array): ZipDirectoryEntry[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const entries: ZipDirectoryEntry[] = [];

  // Find End of Central Directory
  let eocdOffset = -1;
  for (let i = buf.byteLength - 22; i >= 0 && i >= buf.byteLength - 65557; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return entries;

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdCount = view.getUint16(eocdOffset + 10, true);

  let pos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (pos + 46 > buf.byteLength) break;
    if (view.getUint32(pos, true) !== 0x02014b50) break;

    const compressionMethod = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const uncompressedSize = view.getUint32(pos + 24, true);
    const filenameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);

    const filename = new TextDecoder().decode(buf.slice(pos + 46, pos + 46 + filenameLen));

    entries.push({
      filename,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    pos += 46 + filenameLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * Decompress a single ZIP entry on demand.
 */
function decompressEntry(buf: Uint8Array, entry: ZipDirectoryEntry): Uint8Array | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  if (entry.localHeaderOffset + 30 > buf.byteLength) return null;

  const localFilenameLen = view.getUint16(entry.localHeaderOffset + 26, true);
  const localExtraLen = view.getUint16(entry.localHeaderOffset + 28, true);
  const dataStart = entry.localHeaderOffset + 30 + localFilenameLen + localExtraLen;

  if (entry.compressionMethod === 0) {
    // Stored (no compression)
    if (dataStart + entry.compressedSize > buf.byteLength) return null;
    return buf.slice(dataStart, dataStart + entry.compressedSize);
  }

  if (entry.compressionMethod === 8) {
    // Deflated
    if (dataStart + entry.compressedSize > buf.byteLength) return null;
    try {
      const compressed = buf.slice(dataStart, dataStart + entry.compressedSize);
      return pako.inflateRaw(compressed);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Find a ZIP entry by name (case-insensitive fallback) and decompress it.
 */
function findAndDecompress(
  buf: Uint8Array,
  directory: ZipDirectoryEntry[],
  path: string,
): Uint8Array | null {
  // Exact match first
  let entry = directory.find((e) => e.filename === path);
  if (!entry) {
    // Case-insensitive fallback
    const lower = path.toLowerCase();
    entry = directory.find((e) => e.filename.toLowerCase() === lower);
  }
  if (!entry) return null;
  return decompressEntry(buf, entry);
}

function readTextFromZip(
  buf: Uint8Array,
  directory: ZipDirectoryEntry[],
  path: string,
): string | null {
  const data = findAndDecompress(buf, directory, path);
  if (!data) return null;
  return new TextDecoder().decode(data);
}

function readBytesFromZip(
  buf: Uint8Array,
  directory: ZipDirectoryEntry[],
  path: string,
): Uint8Array | null {
  return findAndDecompress(buf, directory, path);
}

// ─── XML helpers (no DOMParser, regex-based) ────────────────────────

function extractTagContent(xml: string, tagName: string): string {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`<${escapedTag}[^>]*>([^<]*)</${escapedTag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : "";
}

function parseAttribute(xml: string, tagName: string, attrName: string): string | null {
  const tagRegex = new RegExp(`<${tagName}\\b([^>]*)/?>`, "i");
  const tagMatch = xml.match(tagRegex);
  if (!tagMatch) return null;

  const attrRegex = new RegExp(`${attrName}\\s*=\\s*["']([^"']*)["']`, "i");
  const attrMatch = tagMatch[0].match(attrRegex);
  return attrMatch ? attrMatch[1] : null;
}

/**
 * Find cover image href from OPF manifest using 4 strategies:
 * 1. EPUB 3: <item properties="cover-image">
 * 2. EPUB 2: <meta name="cover" content="id"> → <item id="id">
 * 3. Any image item with "cover" in id or href
 * 4. Fallback: first image item
 */
function findCoverHref(opfXml: string): string | null {
  const itemRegex = /<item\b([^>]*)\/?>(?:<\/item>)?/gi;
  const items: Array<{ id: string; href: string; mediaType: string; properties: string }> = [];
  let m: RegExpExecArray | null;

  while ((m = itemRegex.exec(opfXml)) !== null) {
    const attrs = m[1];
    items.push({
      id: getAttr(attrs, "id"),
      href: getAttr(attrs, "href"),
      mediaType: getAttr(attrs, "media-type"),
      properties: getAttr(attrs, "properties"),
    });
  }

  // Method 1: EPUB 3 cover-image property
  for (const item of items) {
    if (item.properties.split(/\s+/).includes("cover-image")) {
      return item.href;
    }
  }

  // Method 2: EPUB 2 <meta name="cover" content="coverId">
  const metaRegex = /<meta\b([^>]*)\/?>(?:<\/meta>)?/gi;
  while ((m = metaRegex.exec(opfXml)) !== null) {
    const attrs = m[1];
    if (getAttr(attrs, "name").toLowerCase() === "cover") {
      const coverId = getAttr(attrs, "content");
      if (coverId) {
        const coverItem = items.find((it) => it.id === coverId);
        if (coverItem) return coverItem.href;
      }
    }
  }

  // Method 3: image item with "cover" in id or href
  for (const item of items) {
    if (item.mediaType.startsWith("image/")) {
      if (item.id.toLowerCase().includes("cover") || item.href.toLowerCase().includes("cover")) {
        return item.href;
      }
    }
  }

  // Method 4: first image item
  for (const item of items) {
    if (item.mediaType.startsWith("image/")) {
      return item.href;
    }
  }

  return null;
}

function getAttr(attrsStr: string, name: string): string {
  const regex = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i");
  const match = attrsStr.match(regex);
  return match ? match[1] : "";
}

// ─── Helpers ────────────────────────────────────────────────────────

function guessMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return "image/jpeg";
  }
}
