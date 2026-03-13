import { getChunks, getHighlights, getNotes, getBooks, getBook, updateBook, getAllHighlights, getAllNotes, getReadingSessionsByDateRange, getSkills as getDbSkills } from "../db/database";
import { emitLibraryChanged } from "../events/library-events";
import { getBuiltinSkills } from "./skills/builtin-skills";
import { search } from "../rag/search";
import { getContextTools } from "./context-tools";
/**
 * AI Tool registration — conditional tool registration based on book state
 * Full implementation with RAG search pipeline integration
 * 
 * Tool Categories:
 * - RAG Tools: ragSearch, ragToc, ragContext
 * - Analysis Tools: summarize, extractEntities, analyzeArguments, findQuotes
 * - Annotation Tools: getAnnotations
 */
import type { SearchQuery, Skill } from "../types";
import type { ToolDefinition, ToolParameter } from "./tool-types";

/** Create RAG search tool for a specific book */
function createRagSearchTool(bookId: string): ToolDefinition {
  return {
    name: "ragSearch",
    description:
      "Search book content using semantic or keyword search. Returns results with 'cfi' field for precise location. CRITICAL: When you cite content from search results, you MUST extract and pass the 'cfi' field to addCitation - this enables users to jump to the exact location in the book.",
    parameters: {
      query: {
        type: "string",
        description: "The search query describing what to find",
        required: true,
      },
      mode: {
        type: "string",
        description:
          'Search mode: "hybrid" (recommended), "vector" (semantic), or "bm25" (keyword)',
      },
      topK: { type: "number", description: "Number of results to return (default: 5)" },
    },
    execute: async (args) => {
      const query: SearchQuery = {
        query: args.query as string,
        bookId,
        mode: (args.mode as "hybrid" | "vector" | "bm25") || "hybrid",
        topK: (args.topK as number) || 5,
        threshold: 0.3,
      };

      const results = await search(query);

      return {
        results: results.map((r) => ({
          chapter: r.chunk.chapterTitle,
          chapterIndex: r.chunk.chapterIndex,
          content: r.chunk.content.slice(0, 500), // Truncate for context window
          score: Math.round(r.score * 1000) / 1000,
          matchType: r.matchType,
          highlights: r.highlights,
          cfi: r.chunk.startCfi || "",
        })),
        totalResults: results.length,
      };
    },
  };
}

/** Create RAG TOC tool for a specific book */
function createRagTocTool(bookId: string): ToolDefinition {
  return {
    name: "ragToc",
    description:
      "Get the table of contents of the current book. Use this when the user wants to see the book structure or navigate to a specific chapter.",
    parameters: {},
    execute: async () => {
      // Get unique chapter titles from chunks
      const chunks = await getChunks(bookId);
      const chapters = new Map<number, string>();
      for (const chunk of chunks) {
        if (!chapters.has(chunk.chapterIndex)) {
          chapters.set(chunk.chapterIndex, chunk.chapterTitle);
        }
      }

      return {
        chapters: Array.from(chapters.entries()).map(([index, title]) => ({
          index,
          title,
        })),
        totalChapters: chapters.size,
      };
    },
  };
}

/** Create RAG context tool for a specific book */
function createRagContextTool(bookId: string): ToolDefinition {
  return {
    name: "ragContext",
    description:
      "Get surrounding text context for a specific chapter. Use this when the user asks about content near a specific location. Returns chunks with CFI information - use the CFI from the chunk containing your quoted text when calling addCitation.",
    parameters: {
      chapterIndex: { type: "number", description: "The chapter index", required: true },
      range: {
        type: "number",
        description: "Number of chunks to include before and after (default: 2)",
      },
    },
    execute: async (args) => {
      const chapterIndex = args.chapterIndex as number;
      const range = (args.range as number) || 2;

      const chunks = await getChunks(bookId);
      const chapterChunks = chunks.filter((c) => c.chapterIndex === chapterIndex);

      // Get surrounding chunks
      const contextChunks = chapterChunks.slice(0, range * 2 + 1);

      return {
        chapterTitle: chapterChunks[0]?.chapterTitle || "Unknown",
        chapterIndex: chapterIndex,
        context: contextChunks.map((c) => c.content).join("\n\n"),
        chunks: contextChunks.map((c) => ({
          content: c.content,
          cfi: c.startCfi || "",
        })),
        chunksIncluded: contextChunks.length,
      };
    },
  };
}

// ============================================
// Content Analysis Tools
// ============================================

/** Create summarize tool for a specific book */
function createSummarizeTool(bookId: string): ToolDefinition {
  return {
    name: "summarize",
    description:
      "Generate a summary of a chapter or the entire book. Returns book content that YOU must summarize. After receiving the results, call addCitation to cite the source, then write your summary. Do NOT call content retrieval tools again.",
    parameters: {
      scope: {
        type: "string",
        description: "'chapter' for current chapter summary, 'book' for full book summary",
        required: true,
      },
      chapterIndex: {
        type: "number",
        description: "Chapter index (required when scope is 'chapter')",
      },
      style: {
        type: "string",
        description: "'brief' for short summary, 'detailed' for comprehensive summary",
      },
    },
    execute: async (args) => {
      const scope = args.scope as "chapter" | "book";
      const chapterIndex = args.chapterIndex as number | undefined;
      const style = (args.style as "brief" | "detailed") || "brief";

      const chunks = await getChunks(bookId);

      if (scope === "chapter" && chapterIndex !== undefined) {
        const chapterChunks = chunks.filter((c) => c.chapterIndex === chapterIndex);
        if (chapterChunks.length === 0) {
          return { error: `Chapter ${chapterIndex} not found` };
        }
        const content = chapterChunks.map((c) => c.content).join("\n\n");
        const truncatedContent = style === "brief" 
          ? content.slice(0, 3000) 
          : content.slice(0, 8000);

        return {
          scope: "chapter",
          chapterTitle: chapterChunks[0]?.chapterTitle,
          chapterIndex: chapterIndex,
          content: truncatedContent,
          chunks: chapterChunks.map(c => ({
            content: c.content,
            cfi: c.startCfi || "",
            chapterTitle: c.chapterTitle,
            chapterIndex: c.chapterIndex
          })),
          instruction: style === "brief"
            ? "Generate a concise summary (2-3 sentences) of this chapter content. Use the 'chunks' array to extract CFI for citations."
            : "Generate a detailed summary covering main points, key arguments, and important details. Use the 'chunks' array to extract CFI for citations.",
        };
      }

      if (scope === "book") {
        const chapters = new Map<number, string>();

        for (const chunk of chunks) {
          if (!chapters.has(chunk.chapterIndex)) {
            chapters.set(chunk.chapterIndex, chunk.chapterTitle);
          }
        }

        const sampledContent: string[] = [];
        const chapterList = Array.from(chapters.entries()).sort((a, b) => a[0] - b[0]);
        const chapterCfiMap: Array<{ chapterIndex: number; chapterTitle: string; firstChunkCfi: string }> = [];

        for (const [idx, title] of chapterList) {
          const chapterChunks = chunks.filter((c) => c.chapterIndex === idx);
          const firstChunk = chapterChunks[0];
          if (firstChunk) {
            sampledContent.push(`\n## Chapter: ${title}\n${firstChunk.content.slice(0, 500)}`);
            chapterCfiMap.push({
              chapterIndex: idx,
              chapterTitle: title,
              firstChunkCfi: firstChunk.startCfi || ""
            });
          }
        }

        return {
          scope: "book",
          totalChapters: chapters.size,
          content: sampledContent.join("\n").slice(0, style === "brief" ? 4000 : 10000),
          chapters: chapterCfiMap,
          instruction: style === "brief"
            ? "Generate a concise book summary (1-2 paragraphs) covering the main theme and key points. Use the 'chapters' array to extract CFI for citations."
            : "Generate a comprehensive book summary covering: main theme, chapter-by-chapter overview, key arguments, and conclusions. Use the 'chapters' array to extract CFI for citations.",
        };
      }

      return { error: "Invalid scope. Use 'chapter' or 'book'." };
    },
  };
}

/** Create extract entities tool for a specific book */
function createExtractEntitiesTool(bookId: string): ToolDefinition {
  return {
    name: "extractEntities",
    description:
      "Extract named entities from the book content. Returns raw text from the book — YOU must read through it and identify the entities (characters, places, concepts, etc.) yourself. After receiving results, call addCitation for the source, then analyze the content and answer the user. Do NOT call content retrieval tools again.",
    parameters: {
      entityType: {
        type: "string",
        description: "Type of entities to extract: 'characters', 'places', 'concepts', 'organizations', or 'all'",
      },
      chapterIndex: {
        type: "number",
        description: "Specific chapter index (optional, extracts from entire book if not specified)",
      },
    },
    execute: async (args) => {
      const entityType = (args.entityType as string) || "all";
      const chapterIndex = args.chapterIndex as number | undefined;

      const chunks = await getChunks(bookId);
      const targetChunks = chapterIndex !== undefined
        ? chunks.filter((c) => c.chapterIndex === chapterIndex)
        : chunks;

      if (targetChunks.length === 0) {
        return { error: "No content found" };
      }

      // Sample content from across the book (take first chunk from each chapter for broader coverage)
      let sampledChunks: typeof targetChunks;
      if (chapterIndex !== undefined) {
        // Single chapter: take up to 10 chunks
        sampledChunks = targetChunks.slice(0, 10);
      } else {
        // Whole book: take first 2 chunks from each chapter for breadth
        const byChapter = new Map<number, typeof targetChunks>();
        for (const c of targetChunks) {
          const list = byChapter.get(c.chapterIndex) || [];
          if (list.length < 2) list.push(c);
          byChapter.set(c.chapterIndex, list);
        }
        sampledChunks = Array.from(byChapter.values()).flat();
      }

      const content = sampledChunks
        .map((c) => `[${c.chapterTitle}]\n${c.content}`)
        .join("\n\n")
        .slice(0, 5000);

      return {
        entityType,
        chapterIndex,
        chapterTitle: targetChunks[0]?.chapterTitle,
        content,
        chunks: sampledChunks.map(c => ({
          content: c.content,
          cfi: c.startCfi || "",
          chapterTitle: c.chapterTitle,
          chapterIndex: c.chapterIndex
        })),
        instruction: `The above is raw book content. Read through it carefully and identify all ${entityType === "all" ? "named entities (characters, places, organizations, key concepts)" : entityType}. List each entity with a brief description based ONLY on what appears in this text. Use the 'chunks' array to extract CFI for citations. This is all the data you need — do NOT call any more tools.`,
      };
    },
  };
}

/** Create analyze arguments tool for a specific book */
function createAnalyzeArgumentsTool(bookId: string): ToolDefinition {
  return {
    name: "analyzeArguments",
    description:
      "Analyze the author's arguments, reasoning, and logical structure. Returns book content that YOU must analyze. After receiving the results, call addCitation to cite the source, then write your analysis. Do NOT call content retrieval tools again.",
    parameters: {
      chapterIndex: {
        type: "number",
        description: "Specific chapter index to analyze (optional)",
      },
      focusType: {
        type: "string",
        description: "'main' for main arguments, 'evidence' for supporting evidence, 'structure' for logical structure, or 'all'",
      },
    },
    execute: async (args) => {
      const chapterIndex = args.chapterIndex as number | undefined;
      const focusType = (args.focusType as string) || "all";

      const chunks = await getChunks(bookId);
      const targetChunks = chapterIndex !== undefined
        ? chunks.filter((c) => c.chapterIndex === chapterIndex)
        : chunks.slice(0, 15);

      if (targetChunks.length === 0) {
        return { error: "No content found" };
      }

      const content = targetChunks
        .map((c) => `[${c.chapterTitle}]\n${c.content}`)
        .join("\n\n")
        .slice(0, 10000);

      const focusInstructions: Record<string, string> = {
        main: "Identify and explain the main arguments or thesis presented. What is the author trying to prove or convey?",
        evidence: "Identify the evidence, examples, and data used to support arguments. How strong is the supporting evidence?",
        structure: "Analyze the logical structure: how are arguments organized? What is the reasoning chain?",
        all: "Provide a comprehensive analysis: main arguments, supporting evidence, logical structure, and overall persuasiveness.",
      };

      return {
        focusType,
        chapterIndex,
        chapterTitle: targetChunks[0]?.chapterTitle,
        content,
        chunks: targetChunks.map(c => ({
          content: c.content,
          cfi: c.startCfi || "",
          chapterTitle: c.chapterTitle,
          chapterIndex: c.chapterIndex
        })),
        instruction: (focusInstructions[focusType] || focusInstructions.all) + " Use the 'chunks' array to extract CFI for citations.",
      };
    },
  };
}

/** Create find quotes tool for a specific book */
function createFindQuotesTool(bookId: string): ToolDefinition {
  return {
    name: "findQuotes",
    description:
      "Find notable quotes, passages, and memorable sentences from the book. Returns book content that YOU must search through for quotes. After receiving the results, call addCitation for each quote's location, then present the quotes. Do NOT call content retrieval tools again.",
    parameters: {
      quoteType: {
        type: "string",
        description: "'insightful' for wisdom/insights, 'beautiful' for literary beauty, 'controversial' for debate-worthy, or 'all'",
      },
      chapterIndex: {
        type: "number",
        description: "Specific chapter index (optional)",
      },
      maxQuotes: {
        type: "number",
        description: "Maximum number of quotes to return (default: 5)",
      },
    },
    execute: async (args) => {
      const quoteType = (args.quoteType as string) || "all";
      const chapterIndex = args.chapterIndex as number | undefined;
      const maxQuotes = (args.maxQuotes as number) || 5;

      const chunks = await getChunks(bookId);
      const targetChunks = chapterIndex !== undefined
        ? chunks.filter((c) => c.chapterIndex === chapterIndex)
        : chunks;

      if (targetChunks.length === 0) {
        return { error: "No content found" };
      }

      const content = targetChunks
        .slice(0, 30)
        .map((c) => `[${c.chapterTitle}]\n${c.content}`)
        .join("\n\n")
        .slice(0, 12000);

      const quoteInstructions: Record<string, string> = {
        insightful: "Find quotes containing wisdom, insights, or thought-provoking ideas. Explain why each quote is significant.",
        beautiful: "Find quotes with beautiful language, vivid imagery, or literary merit. Note the stylistic elements.",
        controversial: "Find quotes that present controversial opinions or debate-worthy points. Explain the controversy.",
        all: "Find a mix of insightful, beautiful, and notable quotes. For each, explain its significance and context.",
      };

      return {
        quoteType,
        maxQuotes,
        chapterIndex,
        content,
        chunks: targetChunks.slice(0, 30).map(c => ({
          content: c.content,
          cfi: c.startCfi || "",
          chapterTitle: c.chapterTitle,
          chapterIndex: c.chapterIndex
        })),
        instruction: `${quoteInstructions[quoteType] || quoteInstructions.all} Return at most ${maxQuotes} quotes with their locations. Use the 'chunks' array to extract CFI for citations.`,
      };
    },
  };
}

/** Create get annotations tool for a specific book */
function createGetAnnotationsTool(bookId: string): ToolDefinition {
  return {
    name: "getAnnotations",
    description:
      "Get the user's highlights and notes from the book. Use this to reference what the user has marked as important.",
    parameters: {
      type: {
        type: "string",
        description: "'highlights' for highlights only, 'notes' for notes only, 'all' for both",
      },
    },
    execute: async (args) => {
      const type = (args.type as string) || "all";

      const result: {
        highlights?: Array<{ text: string; note?: string; chapterTitle?: string; color: string }>;
        notes?: Array<{ title: string; content: string; chapterTitle?: string }>;
      } = {};

      if (type === "highlights" || type === "all") {
        const highlights = await getHighlights(bookId);
        result.highlights = highlights.slice(0, 20).map((h) => ({
          text: h.text,
          note: h.note,
          chapterTitle: h.chapterTitle,
          color: h.color,
        }));
      }

      if (type === "notes" || type === "all") {
        const notes = await getNotes(bookId);
        result.notes = notes.slice(0, 20).map((n) => ({
          title: n.title,
          content: n.content,
          chapterTitle: n.chapterTitle,
        }));
      }

      return result;
    },
  };
}

/** Create add citation tool for a specific book */
function createAddCitationTool(bookId: string): ToolDefinition {
  return {
    name: "addCitation",
    description:
      "CRITICAL: Register a citation for specific content from the book. You MUST call this tool whenever you reference factual information from the book in your response. This creates a verifiable citation that users can click to jump to the exact location. Returns citation metadata that you should reference using [1], [2], [3] format in your response text. The citationIndex parameter determines the number — pass 1 for [1], 2 for [2], etc.",
    parameters: {
      citationIndex: {
        type: "number",
        description: "The citation number you will use in your response text. If you write [1] in your response, pass 1 here. If you write [2], pass 2. This MUST match the [N] marker in your response text.",
        required: true,
      },
      chapterTitle: {
        type: "string",
        description: "The chapter title where this content is from (get this from ragSearch or other tool results)",
        required: true,
      },
      chapterIndex: {
        type: "number",
        description: "The chapter index number (get this from ragSearch or other tool results)",
        required: true,
      },
      cfi: {
        type: "string",
        description: "REQUIRED: The exact CFI (Canonical Fragment Identifier) from ragSearch or other tool results. Extract the 'cfi' field from the search result or chunk that contains your quoted text. This CFI enables users to jump to the precise location in the book. NEVER pass empty string - if the tool result has a CFI, you MUST use it.",
        required: true,
      },
      quotedText: {
        type: "string",
        description: "A short excerpt of the actual text being cited (max 200 characters). This helps users verify the citation.",
        required: true,
      },
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are citing this source",
        required: true,
      },
    },
    execute: async (args) => {
      const citationIndex = args.citationIndex as number;
      const chapterTitle = args.chapterTitle as string;
      const chapterIndex = args.chapterIndex as number;
      const aiCfi = (args.cfi as string) || "";
      const quotedText = (args.quotedText as string).slice(0, 200);

      // Refine CFI: the AI only gets chunk-level startCfi, which may point to the
      // beginning of a chunk while the quoted text is in the middle/end.
      // Use segmentCfis (per-paragraph CFIs) for precise navigation when available,
      // falling back to startCfi/endCfi heuristic for older data.
      let refinedCfi = aiCfi;
      try {
        const chunks = await getChunks(bookId);
        const chapterChunks = chunks.filter((c) => c.chapterIndex === chapterIndex);

        // Find the chunk that contains the quoted text
        const normalizedQuote = quotedText.replace(/\s+/g, "");
        let bestChunk = null;
        let bestPos = -1;
        for (const chunk of chapterChunks) {
          const normalizedContent = chunk.content.replace(/\s+/g, "");
          const pos = normalizedContent.indexOf(normalizedQuote);
          if (pos !== -1) {
            bestChunk = chunk;
            bestPos = pos;
            break;
          }
        }

        // Fallback: try partial match (first 30 chars of quoted text)
        if (!bestChunk && normalizedQuote.length > 30) {
          const partialQuote = normalizedQuote.slice(0, 30);
          for (const chunk of chapterChunks) {
            const normalizedContent = chunk.content.replace(/\s+/g, "");
            const pos = normalizedContent.indexOf(partialQuote);
            if (pos !== -1) {
              bestChunk = chunk;
              bestPos = pos;
              break;
            }
          }
        }

        if (bestChunk) {
          if (bestChunk.segmentCfis && bestChunk.segmentCfis.length > 0) {
            // Paragraph-level lookup: split chunk content into segments,
            // find which segment contains the quoted text, use that segment's CFI
            const segments = bestChunk.content.split("\n\n");
            let charsBefore = 0;
            let found = false;
            for (let i = 0; i < segments.length; i++) {
              const segLen = segments[i].replace(/\s+/g, "").length;
              if (charsBefore + segLen > bestPos && i < bestChunk.segmentCfis.length) {
                refinedCfi = bestChunk.segmentCfis[i];
                found = true;
                break;
              }
              charsBefore += segLen;
            }
            if (!found) {
              refinedCfi = bestChunk.startCfi || aiCfi;
            }
          } else {
            // No segmentCfis (old data): use startCfi/endCfi heuristic
            const normalizedContent = bestChunk.content.replace(/\s+/g, "");
            const contentLen = normalizedContent.length;
            if (bestPos > contentLen / 2 && bestChunk.endCfi) {
              refinedCfi = bestChunk.endCfi;
            } else {
              refinedCfi = bestChunk.startCfi || aiCfi;
            }
          }
        }
      } catch (e) {
        // If refinement fails, fall back to AI-provided CFI
        console.warn("[addCitation] CFI refinement failed, using AI-provided CFI:", e);
      }

      // Return citation metadata
      // The message pipeline will assign citation numbers and create CitationPart objects
      return {
        type: "citation",
        bookId,
        chapterTitle,
        chapterIndex,
        cfi: refinedCfi,
        text: quotedText,
        citationIndex,
        timestamp: Date.now(),
        message: `Citation [${citationIndex}] registered: "${chapterTitle}" - Reference this in your response as [${citationIndex}].`,
      };
    },
  };
}

/** Create compare sections tool for a specific book */
function createCompareSectionsTool(bookId: string): ToolDefinition {
  return {
    name: "compareSections",
    description:
      "Compare two sections or chapters of the book. Use this when the user asks to compare, contrast, or find differences between parts of the book.",
    parameters: {
      chapterIndex1: {
        type: "number",
        description: "First chapter index to compare",
        required: true,
      },
      chapterIndex2: {
        type: "number",
        description: "Second chapter index to compare",
        required: true,
      },
      compareType: {
        type: "string",
        description: "'themes' for theme comparison, 'arguments' for argument comparison, 'style' for writing style, or 'all'",
      },
    },
    execute: async (args) => {
      const chapterIndex1 = args.chapterIndex1 as number;
      const chapterIndex2 = args.chapterIndex2 as number;
      const compareType = (args.compareType as string) || "all";

      const chunks = await getChunks(bookId);

      const chapter1Chunks = chunks.filter((c) => c.chapterIndex === chapterIndex1);
      const chapter2Chunks = chunks.filter((c) => c.chapterIndex === chapterIndex2);

      if (chapter1Chunks.length === 0 || chapter2Chunks.length === 0) {
        return { error: "One or both chapters not found" };
      }

      const content1 = chapter1Chunks.map((c) => c.content).join("\n\n").slice(0, 4000);
      const content2 = chapter2Chunks.map((c) => c.content).join("\n\n").slice(0, 4000);

      const compareInstructions: Record<string, string> = {
        themes: "Compare the themes discussed in both sections. What themes are shared? What themes are unique to each?",
        arguments: "Compare the arguments presented. Are they consistent? Contradictory? Complementary?",
        style: "Compare the writing style, tone, and language used in both sections.",
        all: "Provide a comprehensive comparison: themes, arguments, writing style, and any connections or contrasts.",
      };

      return {
        chapter1: {
          index: chapterIndex1,
          title: chapter1Chunks[0]?.chapterTitle,
          content: content1,
          chunks: chapter1Chunks.map(c => ({
            content: c.content,
            cfi: c.startCfi || "",
            chapterTitle: c.chapterTitle,
            chapterIndex: c.chapterIndex
          }))
        },
        chapter2: {
          index: chapterIndex2,
          title: chapter2Chunks[0]?.chapterTitle,
          content: content2,
          chunks: chapter2Chunks.map(c => ({
            content: c.content,
            cfi: c.startCfi || "",
            chapterTitle: c.chapterTitle,
            chapterIndex: c.chapterIndex
          }))
        },
        compareType,
        instruction: (compareInstructions[compareType] || compareInstructions.all) + " Use the 'chunks' arrays in chapter1 and chapter2 to extract CFI for citations.",
      };
    },
  };
}

// ============================================
// General Tools (no bookId required)
// ============================================

/** List all books in the user's library */
function createListBooksTool(): ToolDefinition {
  return {
    name: "listBooks",
    description:
      "List all books in the user's library, including titles, authors, reading progress, and basic metadata. Use this when the user asks about their books, reading list, or library.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are calling this tool",
        required: true,
      },
      search: {
        type: "string",
        description: "Search keyword to filter by title or author",
      },
      status: {
        type: "string",
        description: "Filter by reading status: 'unread' (0%), 'reading' (1-99%), or 'completed' (100%)",
      },
      limit: {
        type: "number",
        description: "Maximum number of books to return (default: 20)",
      },
    },
    execute: async (args) => {
      const limit = (args.limit as number) || 20;
      const searchTerm = (args.search as string)?.toLowerCase();
      const status = args.status as string | undefined;
      let books = await getBooks();

      // Filter by search keyword
      if (searchTerm) {
        books = books.filter(
          (b) =>
            b.meta.title.toLowerCase().includes(searchTerm) ||
            (b.meta.author && b.meta.author.toLowerCase().includes(searchTerm)),
        );
      }

      // Filter by reading status
      if (status === "unread") {
        books = books.filter((b) => !b.progress || b.progress === 0);
      } else if (status === "reading") {
        books = books.filter((b) => b.progress > 0 && b.progress < 1);
      } else if (status === "completed") {
        books = books.filter((b) => b.progress >= 1);
      }

      const result = books.slice(0, limit).map((b) => ({
        id: b.id,
        title: b.meta.title,
        author: b.meta.author,
        format: b.format,
        progress: Math.round((b.progress || 0) * 100) + "%",
        isVectorized: b.isVectorized,
        addedAt: b.addedAt,
        lastOpenedAt: b.lastOpenedAt,
      }));
      return { total: books.length, showing: result.length, books: result };
    },
  };
}

/** Search highlights across all books */
function createSearchAllHighlightsTool(): ToolDefinition {
  return {
    name: "searchAllHighlights",
    description:
      "Get the user's recent highlights and annotations across ALL books. Use this when the user asks about their highlights, marked passages, or important notes without specifying a particular book.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are calling this tool",
        required: true,
      },
      days: {
        type: "number",
        description: "Only return highlights from the last N days (e.g. 7=last week, 30=last month)",
      },
      limit: {
        type: "number",
        description: "Maximum number of highlights to return (default: 20)",
      },
    },
    execute: async (args) => {
      const limit = (args.limit as number) || 20;
      const days = args.days as number | undefined;
      let highlights = await getAllHighlights(limit * 2); // fetch extra for filtering
      const books = await getBooks();
      const bookMap = new Map(books.map((b) => [b.id, b.meta.title]));

      // Filter by time range
      if (days) {
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        highlights = highlights.filter((h) => h.createdAt >= cutoff);
      }

      highlights = highlights.slice(0, limit);

      return {
        total: highlights.length,
        highlights: highlights.map((h) => ({
          text: h.text,
          note: h.note,
          bookTitle: bookMap.get(h.bookId) || "Unknown",
          chapterTitle: h.chapterTitle,
          color: h.color,
          createdAt: h.createdAt,
        })),
      };
    },
  };
}

/** Search notes across all books */
function createSearchAllNotesTool(): ToolDefinition {
  return {
    name: "searchAllNotes",
    description:
      "Get the user's notes across ALL books. Use this when the user asks about their notes, thoughts, or writings without specifying a particular book.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are calling this tool",
        required: true,
      },
      days: {
        type: "number",
        description: "Only return notes from the last N days (e.g. 7=last week, 30=last month)",
      },
      bookTitle: {
        type: "string",
        description: "Filter notes by book title (fuzzy match)",
      },
      limit: {
        type: "number",
        description: "Maximum number of notes to return (default: 20)",
      },
    },
    execute: async (args) => {
      const limit = (args.limit as number) || 20;
      const days = args.days as number | undefined;
      const bookTitleSearch = (args.bookTitle as string)?.toLowerCase();

      const notes = await getAllNotes(limit * 2);
      const highlightsWithNotes = await getAllHighlights(limit * 2);
      const highlightNotes = highlightsWithNotes.filter(h => h.note);

      const books = await getBooks();
      const bookMap = new Map(books.map((b) => [b.id, b.meta.title]));

      let allNotes = [
        ...notes.map((n) => ({
          type: "note" as const,
          title: n.title,
          content: n.content,
          bookId: n.bookId,
          chapterTitle: n.chapterTitle,
          tags: n.tags,
          createdAt: n.createdAt,
        })),
        ...highlightNotes.map((h) => ({
          type: "highlight_note" as const,
          title: h.text.slice(0, 50) + (h.text.length > 50 ? "..." : ""),
          content: h.note || "",
          bookId: h.bookId,
          chapterTitle: h.chapterTitle,
          highlightedText: h.text,
          createdAt: h.createdAt,
        })),
      ];

      if (days) {
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        allNotes = allNotes.filter((n) => n.createdAt >= cutoff);
      }

      if (bookTitleSearch) {
        allNotes = allNotes.filter((n) => {
          const title = bookMap.get(n.bookId)?.toLowerCase() || "";
          return title.includes(bookTitleSearch);
        });
      }

      allNotes.sort((a, b) => b.createdAt - a.createdAt);
      allNotes = allNotes.slice(0, limit);

      return {
        total: allNotes.length,
        notes: allNotes.map((n) => ({
          type: n.type,
          title: n.title,
          content: n.content,
          bookTitle: bookMap.get(n.bookId) || "Unknown",
          chapterTitle: n.chapterTitle,
          highlightedText: n.type === "highlight_note" ? (n as any).highlightedText : undefined,
          tags: n.type === "note" ? (n as any).tags : undefined,
          createdAt: n.createdAt,
        })),
      };
    },
  };
}

/** Get reading statistics across all books */
function createReadingStatsTool(): ToolDefinition {
  return {
    name: "getReadingStats",
    description:
      "Get the user's reading statistics, including total books, reading time, and recent activity. Use this when the user asks about their reading habits, statistics, or activity summary.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are calling this tool",
        required: true,
      },
      days: {
        type: "number",
        description: "Number of recent days to include for activity stats (default: 30)",
      },
    },
    execute: async (args) => {
      const days = (args.days as number) || 30;
      const books = await getBooks();
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const sessions = await getReadingSessionsByDateRange(startDate, endDate);

      const totalReadingTimeMs = sessions.reduce((sum, s) => sum + s.totalActiveTime, 0);
      const totalPagesRead = sessions.reduce((sum, s) => sum + s.pagesRead, 0);
      const booksInProgress = books.filter((b) => b.progress > 0 && b.progress < 1);
      const booksCompleted = books.filter((b) => b.progress >= 1);

      return {
        library: {
          totalBooks: books.length,
          inProgress: booksInProgress.length,
          completed: booksCompleted.length,
        },
        recentActivity: {
          periodDays: days,
          totalSessions: sessions.length,
          totalReadingMinutes: Math.round(totalReadingTimeMs / 60000),
          totalPagesRead,
        },
        recentBooks: books.slice(0, 5).map((b) => ({
          title: b.meta.title,
          author: b.meta.author,
          progress: Math.round((b.progress || 0) * 100),
        })),
      };
    },
  };
}

/** Get books info and existing tags for AI classification */
function createClassifyBooksTool(): ToolDefinition {
  return {
    name: "classifyBooks",
    description:
      "Get book metadata, table of contents, and content samples for classification. MUST be called BEFORE tagBooks to get book IDs and enough context. Without bookId: returns all uncategorized books with their TOC and content samples. With bookId: returns that specific book's full info. Use when the user asks to classify/categorize/tag books. IMPORTANT: Each book should have at most 2 tags — pick the most representative ones.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are calling this tool",
        required: true,
      },
      bookId: {
        type: "string",
        description: "Optional. If provided, return info for this specific book instead of all uncategorized books.",
      },
    },
    execute: async (args) => {
      const books = await getBooks();
      const allTags = [...new Set(books.flatMap((b) => b.tags))];
      const targetBookId = args.bookId as string | undefined;

      /** Extract TOC and content samples from chunks for a given book */
      const getBookContentInfo = async (bookId: string) => {
        try {
          const chunks = await getChunks(bookId);
          if (chunks.length === 0) return { toc: [], contentSample: "" };

          // Extract TOC
          const chapters = new Map<number, string>();
          for (const chunk of chunks) {
            if (!chapters.has(chunk.chapterIndex)) {
              chapters.set(chunk.chapterIndex, chunk.chapterTitle);
            }
          }
          const toc = Array.from(chapters.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([, title]) => title);

          // Sample first few chunks as content preview (up to ~1500 chars)
          let contentSample = "";
          for (const chunk of chunks.slice(0, 5)) {
            contentSample += chunk.content + "\n";
            if (contentSample.length > 1500) break;
          }
          contentSample = contentSample.slice(0, 1500);

          return { toc, contentSample };
        } catch {
          return { toc: [], contentSample: "" };
        }
      };

      if (targetBookId) {
        const book = await getBook(targetBookId);
        if (!book) {
          return { success: false, error: "Book not found" };
        }
        const contentInfo = await getBookContentInfo(book.id);
        return {
          existingTags: allTags,
          book: {
            id: book.id,
            title: book.meta.title,
            author: book.meta.author,
            description: book.meta.description,
            subjects: book.meta.subjects,
            language: book.meta.language,
            currentTags: book.tags,
            toc: contentInfo.toc,
            contentSample: contentInfo.contentSample,
          },
          totalBooks: books.length,
        };
      }

      const uncategorized = books.filter((b) => b.tags.length === 0);
      const uncategorizedWithContent = await Promise.all(
        uncategorized.map(async (b) => {
          const contentInfo = await getBookContentInfo(b.id);
          return {
            id: b.id,
            title: b.meta.title,
            author: b.meta.author,
            description: b.meta.description,
            subjects: b.meta.subjects,
            language: b.meta.language,
            toc: contentInfo.toc,
            contentSample: contentInfo.contentSample,
          };
        }),
      );
      return {
        existingTags: allTags,
        uncategorizedBooks: uncategorizedWithContent,
        totalBooks: books.length,
        uncategorizedCount: uncategorized.length,
      };
    },
  };
}

/** Batch-apply tags to books */
function createTagBooksTool(): ToolDefinition {
  return {
    name: "tagBooks",
    description:
      "Apply tags to books. Can tag multiple books at once. IMPORTANT: You MUST call classifyBooks first to get book IDs and metadata — never guess tags based on title alone. Use the description, subjects, and language from classifyBooks results to suggest accurate tags. RULE: Each book should have at most 2 tags — pick the 1-2 most representative categories. Prefer reusing existing tags over creating new ones.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are calling this tool",
        required: true,
      },
      assignments: {
        type: "string",
        description:
          'JSON array of {bookId, tags: string[]}. Example: [{"bookId":"abc","tags":["科幻","小说"]}]',
        required: true,
      },
    },
    execute: async (args) => {
      const assignments: { bookId: string; tags: string[] }[] = JSON.parse(
        args.assignments as string,
      );
      const results: {
        bookId: string;
        title?: string;
        tags?: string[];
        success: boolean;
        error?: string;
      }[] = [];
      for (const { bookId, tags } of assignments) {
        const book = await getBook(bookId);
        if (!book) {
          results.push({ bookId, success: false, error: "Book not found" });
          continue;
        }
        const merged = [...new Set([...book.tags, ...tags])];
        await updateBook(bookId, { tags: merged });
        results.push({
          bookId,
          title: book.meta.title,
          tags: merged,
          success: true,
        });
      }
      const result = {
        results,
        taggedCount: results.filter((r) => r.success).length,
      };
      emitLibraryChanged();
      return result;
    },
  };
}

/** Manage book tags: rename, delete, remove from book, set book tags */
function createManageBookTagsTool(): ToolDefinition {
  return {
    name: "manageBookTags",
    description:
      "Manage book tags: rename a tag across all books, delete one or more tags from all books, remove specific tags from a book, or replace all tags of a book. Use when the user asks to modify, rename, or delete tags. For delete action, you can delete multiple tags at once by passing a JSON array.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are calling this tool",
        required: true,
      },
      action: {
        type: "string",
        description:
          '"rename" | "delete" | "removeFromBook" | "setBookTags"',
        required: true,
      },
      tag: {
        type: "string",
        description: "The tag to rename (for rename action). For delete action, use 'tags' parameter instead to support batch deletion.",
      },
      newTag: {
        type: "string",
        description: "New tag name (for rename action)",
      },
      bookId: {
        type: "string",
        description: "Book ID (for removeFromBook/setBookTags)",
      },
      tags: {
        type: "string",
        description:
          'JSON array of tags. For delete action: tags to delete. For removeFromBook/setBookTags: tags to remove/set. Example: ["科幻","小说"]',
      },
    },
    execute: async (args) => {
      const action = args.action as string;

      if (action === "rename") {
        const oldTag = args.tag as string;
        const newTag = args.newTag as string;
        if (!oldTag || !newTag) {
          return { success: false, error: "Both tag and newTag are required for rename" };
        }
        const books = await getBooks();
        let affectedCount = 0;
        for (const book of books) {
          if (book.tags.includes(oldTag)) {
            const updated = book.tags.map((t) => (t === oldTag ? newTag : t));
            const deduped = [...new Set(updated)];
            await updateBook(book.id, { tags: deduped });
            affectedCount++;
          }
        }
        emitLibraryChanged();
        return { success: true, action: "rename", oldTag, newTag, affectedBooks: affectedCount };
      }

      if (action === "delete") {
        // Support both single tag (via 'tag' param) and multiple tags (via 'tags' param)
        let tagsToDelete: string[] = [];
        if (args.tags) {
          tagsToDelete = JSON.parse(args.tags as string);
        } else if (args.tag) {
          tagsToDelete = [args.tag as string];
        }
        if (tagsToDelete.length === 0) {
          return { success: false, error: "tag or tags is required for delete" };
        }
        const books = await getBooks();
        let affectedCount = 0;
        for (const book of books) {
          const hasAnyTag = tagsToDelete.some((tag) => book.tags.includes(tag));
          if (hasAnyTag) {
            const updated = book.tags.filter((t) => !tagsToDelete.includes(t));
            await updateBook(book.id, { tags: updated });
            affectedCount++;
          }
        }
        emitLibraryChanged(tagsToDelete);
        return { success: true, action: "delete", deletedTags: tagsToDelete, affectedBooks: affectedCount };
      }

      if (action === "removeFromBook") {
        const bookId = args.bookId as string;
        const tagsToRemove: string[] = JSON.parse(args.tags as string);
        if (!bookId || !tagsToRemove) {
          return { success: false, error: "bookId and tags are required for removeFromBook" };
        }
        const book = await getBook(bookId);
        if (!book) {
          return { success: false, error: "Book not found" };
        }
        const updated = book.tags.filter((t) => !tagsToRemove.includes(t));
        await updateBook(bookId, { tags: updated });
        emitLibraryChanged();
        return {
          success: true,
          action: "removeFromBook",
          bookId,
          title: book.meta.title,
          removedTags: tagsToRemove,
          remainingTags: updated,
        };
      }

      if (action === "setBookTags") {
        const bookId = args.bookId as string;
        const newTags: string[] = JSON.parse(args.tags as string);
        if (!bookId || !newTags) {
          return { success: false, error: "bookId and tags are required for setBookTags" };
        }
        const book = await getBook(bookId);
        if (!book) {
          return { success: false, error: "Book not found" };
        }
        const deduped = [...new Set(newTags)];
        await updateBook(bookId, { tags: deduped });
        emitLibraryChanged();
        return {
          success: true,
          action: "setBookTags",
          bookId,
          title: book.meta.title,
          tags: deduped,
        };
      }

      return { success: false, error: `Unknown action: ${action}` };
    },
  };
}

/** Get general (non-book-specific) tools */
function getGeneralTools(): ToolDefinition[] {
  return [
    createListBooksTool(),
    createSearchAllHighlightsTool(),
    createSearchAllNotesTool(),
    createReadingStatsTool(),
    createGetSkillsTool(),
    createMindmapTool(),
    createClassifyBooksTool(),
    createTagBooksTool(),
    createManageBookTagsTool(),
  ];
}

/** Query available skills/SOPs */
function createGetSkillsTool(): ToolDefinition {
  return {
    name: "getSkills",
    description:
      "Query the available skills (SOPs / standard operating procedures) that define how to perform specific tasks. Use this when you need guidance on how to execute a complex task like generating a mindmap, writing a summary, analyzing arguments, etc.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are calling this tool",
        required: true,
      },
      task: {
        type: "string",
        description: "The task type or keyword to search for (e.g. '思维导图', '摘要', 'summary')",
        required: true,
      },
    },
    execute: async (args) => {
      const task = (args.task as string).toLowerCase();

      // Merge builtin and custom skills
      const builtins = getBuiltinSkills();
      let dbSkills: Skill[] = [];
      try {
        dbSkills = await getDbSkills();
      } catch { /* ignore */ }

      const allSkills = [
        ...builtins,
        ...dbSkills.filter((s) => !s.builtIn && s.enabled),
      ];

      // Fuzzy match by name or description
      const matched = allSkills.filter(
        (s) =>
          s.name.toLowerCase().includes(task) ||
          s.description.toLowerCase().includes(task) ||
          s.id.toLowerCase().includes(task),
      );

      if (matched.length > 0) {
        return {
          found: matched.length,
          skills: matched.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            prompt: s.prompt,
            parameters: s.parameters.map((p) => ({
              name: p.name,
              type: p.type,
              description: p.description,
              required: p.required,
            })),
          })),
        };
      }

      // No match — return all available skill names
      return {
        found: 0,
        message: `No skill matched "${task}". Available skills:`,
        availableSkills: allSkills.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
        })),
      };
    },
  };
}

/** Generate a mindmap from content */
function createMindmapTool(): ToolDefinition {
  return {
    name: "mindmap",
    description:
      "Generate a mindmap visualization from content. The output will be rendered as an interactive mindmap using markmap. Use this when the user asks you to create a mindmap, knowledge map, concept map, or visual structure of a topic, chapter, or book. IMPORTANT: The markdown parameter must use standard Markdown heading syntax (# ## ### etc.), NOT mermaid mindmap syntax.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are calling this tool",
        required: true,
      },
      title: {
        type: "string",
        description: "The title of the mindmap",
        required: true,
      },
      markdown: {
        type: "string",
        description: "The mindmap content in standard Markdown heading format (NOT mermaid syntax). Use # for root topic, ## for main branches, ### for sub-branches, and - for leaf items. NEVER use mermaid 'mindmap' syntax. Example:\n# Main Topic\n## Branch 1\n### Sub-branch 1.1\n- Detail A\n- Detail B\n## Branch 2\n- Detail C\n- Detail D",
        required: true,
      },
    },
    execute: async (args) => {
      const title = args.title as string;
      let markdown = args.markdown as string;

      // Fallback: convert mermaid mindmap syntax to markmap Markdown if AI used wrong format
      if (markdown.trim().startsWith("mindmap") || markdown.trim().startsWith("```mermaid")) {
        markdown = convertMermaidMindmapToMarkdown(markdown, title);
      }

      // Count nodes and depth for stats
      const lines = markdown.split("\n").filter((l) => l.trim());
      const nodeCount = lines.length;
      const maxDepth = lines.reduce((max, line) => {
        const headingMatch = line.match(/^(#{1,6})\s/);
        const listMatch = line.match(/^(\s*)-\s/);
        if (headingMatch) return Math.max(max, headingMatch[1].length);
        if (listMatch) return Math.max(max, 7 + Math.floor((listMatch[1].length) / 2));
        return max;
      }, 0);

      return {
        type: "mindmap",
        title,
        markdown,
        stats: { nodeCount, maxDepth },
      };
    },
  };
}

/** Get available tools based on current state */
export function getAvailableTools(options: {
  bookId?: string | null;
  isVectorized: boolean;
  enabledSkills: Skill[];
}): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  // General tools are always available (no bookId required)
  tools.push(...getGeneralTools());

  if (options.bookId) {
    // Context tools (always available when book is loaded)
    tools.push(...getContextTools(options.bookId));

    // RAG tools (require vectorization)
    if (options.isVectorized) {
      tools.push(
        createRagSearchTool(options.bookId),
        createRagTocTool(options.bookId),
        createRagContextTool(options.bookId),
      );

      // Content analysis tools (require chunks from vectorization)
      tools.push(
        createSummarizeTool(options.bookId),
        createExtractEntitiesTool(options.bookId),
        createAnalyzeArgumentsTool(options.bookId),
        createFindQuotesTool(options.bookId),
        createCompareSectionsTool(options.bookId),
      );
    }

    // Annotation & citation tools (always available when book is loaded)
    tools.push(
      createGetAnnotationsTool(options.bookId),
      createAddCitationTool(options.bookId),
    );
  }

  // Add custom skills
  for (const skill of options.enabledSkills) {
    tools.push(skillToTool(skill));
  }

  return tools;
}

/** Convert mermaid mindmap syntax to markmap Markdown heading format */
function convertMermaidMindmapToMarkdown(mermaidText: string, fallbackTitle: string): string {
  // Strip mermaid code fence markers
  let text = mermaidText
    .replace(/```mermaid\s*/g, "")
    .replace(/```\s*/g, "")
    .replace(/^mindmap\s*/m, "")
    .trim();

  const lines = text.split("\n");
  const result: string[] = [];

  // Find the minimum indentation (the root node)
  let minIndent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.search(/\S/);
    if (indent >= 0 && indent < minIndent) minIndent = indent;
  }
  if (!Number.isFinite(minIndent)) minIndent = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const indent = line.search(/\S/);
    // Calculate depth relative to root (each 2 spaces = 1 level)
    const depth = Math.floor((indent - minIndent) / 2);

    // Clean up mermaid-specific syntax: remove parentheses wrapping, brackets, etc.
    const cleanText = trimmed
      .replace(/^\((.+)\)$/, "$1")    // (text) → text
      .replace(/^\[(.+)\]$/, "$1")    // [text] → text
      .replace(/^\{(.+)\}$/, "$1")    // {text} → text
      .replace(/^["'](.+)["']$/, "$1"); // "text" → text

    if (depth === 0) {
      result.push(`# ${cleanText}`);
    } else if (depth === 1) {
      result.push(`## ${cleanText}`);
    } else if (depth === 2) {
      result.push(`### ${cleanText}`);
    } else if (depth === 3) {
      result.push(`#### ${cleanText}`);
    } else {
      // Deeper levels use list items
      const listIndent = "  ".repeat(Math.max(0, depth - 4));
      result.push(`${listIndent}- ${cleanText}`);
    }
  }

  // If conversion produced nothing, return a simple fallback
  if (result.length === 0) {
    return `# ${fallbackTitle}`;
  }

  return result.join("\n");
}

/** Convert a Skill to a ToolDefinition */
function skillToTool(skill: Skill): ToolDefinition {
  const parameters: Record<string, ToolParameter> = {
    reasoning: {
      type: "string",
      description: "Brief explanation of why you are calling this skill",
      required: true,
    },
  };
  for (const param of skill.parameters) {
    parameters[param.name] = {
      type: param.type,
      description: param.description,
      required: param.required,
    };
  }

  return {
    name: skill.id,
    description: `[${skill.name}] ${skill.description}`,
    parameters,
    execute: async (args) => {
      // Return the skill's prompt + args so the agent can use the skill's SOP
      // The LLM will use the skill prompt as guidance for its response
      return {
        skillId: skill.id,
        skillName: skill.name,
        skillPrompt: skill.prompt,
        args,
        instruction: "Follow the skill prompt above to complete this task. Use the provided parameters and context.",
      };
    },
  };
}
