export type DocumentChunk = {
  id: string;
  employeeId: string;
  fileId: string;
  chunkIndex: number;
  text: string;
  score?: number;
};

export type RagEnvironment = {
  DB: D1Database;
  DOCUMENTS?: R2Bucket;
  AI?: {
    run(
      model: string,
      input: { text: string[] | string },
    ): Promise<{ data: number[][] | number[] }>;
  };
  VECTORIZE?: {
    insert(
      vectors: Array<{
        id: string;
        values: number[];
        metadata?: Record<string, unknown>;
      }>,
    ): Promise<unknown>;
    query(
      vector: number[],
      options?: {
        topK?: number;
        filter?: Record<string, unknown>;
        returnMetadata?: "all" | "indexed" | "none";
      },
    ): Promise<{
      matches: Array<{
        id: string;
        score: number;
        metadata?: Record<string, unknown>;
      }>;
    }>;
    deleteByIds(ids: string[]): Promise<unknown>;
  };
};

export const CLOUDFLARE_EMBEDDING_MODEL = "@cf/baai/bge-m3";

/**
 * Splits raw document text into readable chunks with overlap.
 */
export function chunkText(
  text: string,
  chunkSize: number = 600,
  overlap: number = 80,
): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  // Split by double newline (paragraphs) first, then sentences if necessary
  const paragraphs = normalized.split(/\n\s*\n/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (!currentChunk) {
      currentChunk = trimmed;
    } else if (currentChunk.length + trimmed.length + 2 <= chunkSize) {
      currentChunk += "\n\n" + trimmed;
    } else {
      chunks.push(currentChunk);
      // Keep overlap from end of current chunk if feasible
      const overlapText =
        currentChunk.length > overlap
          ? currentChunk.slice(-overlap).trim()
          : "";
      currentChunk = overlapText ? `${overlapText}\n\n${trimmed}` : trimmed;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  // If any individual chunk is still exceedingly large, hard split it
  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= chunkSize * 1.5) {
      finalChunks.push(chunk);
    } else {
      let remaining = chunk;
      while (remaining.length > 0) {
        finalChunks.push(remaining.slice(0, chunkSize));
        if (remaining.length <= chunkSize) break;
        remaining = remaining.slice(chunkSize - overlap);
      }
    }
  }

  return finalChunks;
}

/**
 * Extracts plain text from various file formats (Text, Markdown, CSV, JSON, basic PDF extraction).
 */
export function extractTextFromFile(
  content: ArrayBuffer | string,
  contentType: string,
  filename: string,
): string {
  if (typeof content === "string") {
    return content;
  }

  const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
  const rawString = decoder.decode(content);

  const lowerName = filename.toLowerCase();
  const lowerType = contentType.toLowerCase();

  // If JSON, pretty print readable fields
  if (lowerType.includes("json") || lowerName.endsWith(".json")) {
    try {
      const parsed = JSON.parse(rawString);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return rawString;
    }
  }

  // If PDF, extract textual stream tokens if plain text isn't directly usable
  if (lowerType.includes("pdf") || lowerName.endsWith(".pdf")) {
    // Basic text extraction from uncompressed PDF streams
    const textBlocks: string[] = [];
    const regex = /BT[\s\S]*?ET/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(rawString)) !== null) {
      const inner = match[0];
      const tjMatches = inner.match(/\((.*?)\)\s*Tj/g);
      if (tjMatches) {
        const line = tjMatches
          .map((m) => m.replace(/^\(/, "").replace(/\)\s*Tj$/, ""))
          .join(" ");
        if (line.trim()) textBlocks.push(line);
      }
    }
    if (textBlocks.length > 0) {
      return textBlocks.join("\n");
    }
    // Fallback: strip binary noise
    const sanitized = rawString.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\xFF]/g, " ");
    return sanitized.replace(/\s{2,}/g, " ").trim();
  }

  // Text / Markdown / CSV
  return rawString;
}

/**
 * Index a document into Cloudflare RAG (Workers AI Embeddings + Vectorize)
 * and persist chunks in D1 for local fallback & provenance.
 */
export async function indexDocument(
  env: RagEnvironment,
  employeeId: string,
  fileId: string,
  filename: string,
  text: string,
): Promise<{ chunksCount: number }> {
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    return { chunksCount: 0 };
  }

  const now = new Date().toISOString();
  const chunkRecords: DocumentChunk[] = chunks.map((chunk, index) => ({
    id: crypto.randomUUID(),
    employeeId,
    fileId,
    chunkIndex: index,
    text: chunk,
  }));

  // 1. Persist to D1 chunks table (guarantees local testing & backup)
  for (const chunk of chunkRecords) {
    await env.DB.prepare(
      `INSERT INTO assistant_virtual_employee_chunks (id, employee_id, file_id, chunk_index, text, vector_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        chunk.id,
        chunk.employeeId,
        chunk.fileId,
        chunk.chunkIndex,
        chunk.text,
        chunk.id,
        now,
      )
      .run();
  }

  // 2. If Cloudflare Workers AI and Vectorize are bound, generate vectors and insert
  if (env.AI && env.VECTORIZE) {
    try {
      const embeddingsResponse = await env.AI.run(CLOUDFLARE_EMBEDDING_MODEL, {
        text: chunks,
      });

      const vectors = (embeddingsResponse.data as number[][]).map((vec, i) => ({
        id: chunkRecords[i].id,
        values: vec,
        metadata: {
          employee_id: employeeId,
          file_id: fileId,
          filename,
          chunk_index: i,
          text: chunks[i],
        },
      }));

      await env.VECTORIZE.insert(vectors);
    } catch (error) {
      console.warn("[Cloudflare RAG] Vector indexing failed, falling back to D1 storage:", error);
    }
  }

  return { chunksCount: chunks.length };
}

/**
 * Retrieves the most relevant context chunks for a query using Cloudflare RAG or local fallback.
 */
export async function retrieveRelevantChunks(
  env: RagEnvironment,
  employeeId: string,
  query: string,
  topK: number = 4,
): Promise<DocumentChunk[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  // 1. Try Cloudflare Vectorize + Workers AI if available
  if (env.AI && env.VECTORIZE) {
    try {
      const queryEmbResp = await env.AI.run(CLOUDFLARE_EMBEDDING_MODEL, {
        text: [trimmedQuery],
      });
      const queryVector = Array.isArray(queryEmbResp.data[0])
        ? (queryEmbResp.data[0] as number[])
        : (queryEmbResp.data as unknown as number[]);

      const searchResult = await env.VECTORIZE.query(queryVector, {
        topK,
        filter: { employee_id: employeeId },
        returnMetadata: "all",
      });

      if (searchResult.matches && searchResult.matches.length > 0) {
        return searchResult.matches.map((match) => ({
          id: match.id,
          employeeId,
          fileId: (match.metadata?.file_id as string) ?? "",
          chunkIndex: (match.metadata?.chunk_index as number) ?? 0,
          text: (match.metadata?.text as string) ?? "",
          score: match.score,
        }));
      }
    } catch (error) {
      console.warn("[Cloudflare RAG] Vector search failed, using D1 fallback:", error);
    }
  }

  // 2. Local Fallback: Keyword and phrase matching from D1 chunks
  const rows = await env.DB.prepare(
    `SELECT id, employee_id AS employeeId, file_id AS fileId, chunk_index AS chunkIndex, text
     FROM assistant_virtual_employee_chunks
     WHERE employee_id = ?`,
  )
    .bind(employeeId)
    .all<DocumentChunk>();

  const allChunks = rows.results ?? [];
  if (allChunks.length === 0) return [];

  // Score chunks by keyword frequency & word matches
  const terms = trimmedQuery
    .toLowerCase()
    .replace(/[^\w\sáéíóúüñ]/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);

  if (terms.length === 0) {
    return allChunks.slice(0, topK);
  }

  const scored = allChunks.map((chunk) => {
    const chunkLower = chunk.text.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (chunkLower.includes(term)) {
        score += 1;
        // Exact word match bonus
        const regex = new RegExp(`\\b${term}\\b`, "i");
        if (regex.test(chunkLower)) {
          score += 2;
        }
      }
    }
    return { ...chunk, score };
  });

  // Sort descending by score and filter out zero scores unless no chunk scored
  const sorted = scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const positive = sorted.filter((c) => (c.score ?? 0) > 0);

  return (positive.length > 0 ? positive : sorted).slice(0, topK);
}

/**
 * Removes all indexed vectors and chunks for a deleted file.
 */
export async function deleteFileVectors(
  env: RagEnvironment,
  employeeId: string,
  fileId: string,
): Promise<void> {
  // 1. Get chunk IDs from D1
  const rows = await env.DB.prepare(
    `SELECT id FROM assistant_virtual_employee_chunks WHERE employee_id = ? AND file_id = ?`,
  )
    .bind(employeeId, fileId)
    .all<{ id: string }>();

  const chunkIds = (rows.results ?? []).map((r) => r.id);

  // 2. Delete from Vectorize if bound
  if (env.VECTORIZE && chunkIds.length > 0) {
    try {
      await env.VECTORIZE.deleteByIds(chunkIds);
    } catch (error) {
      console.warn("[Cloudflare RAG] Failed to delete vectors from Vectorize:", error);
    }
  }

  // 3. Delete from D1
  await env.DB.prepare(
    `DELETE FROM assistant_virtual_employee_chunks WHERE employee_id = ? AND file_id = ?`,
  )
    .bind(employeeId, fileId)
    .run();
}
