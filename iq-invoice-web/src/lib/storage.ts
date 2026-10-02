/**
 * Invoice file storage.
 *
 * Production (Vercel): files go to Vercel Blob and a public URL is returned.
 * Local dev / tests:   files are written under .data/ and served by
 *                      /api/files/[...path], so the whole pipeline works
 *                      without any cloud account.
 */
import { promises as fs } from "fs";
import path from "path";

/** Local (non-Blob) storage base folder. Dev/test only; production uses Blob. */
export const DATA_DIR = path.join(process.cwd(), ".data");

export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
};

export function contentTypeFor(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function localPathFor(key: string): string {
  const base = path.resolve(DATA_DIR);
  const full = path.resolve(base, key);
  // Prevent path traversal outside the data directory.
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error("Invalid storage key.");
  }
  return full;
}

export interface SavedFile {
  url: string;
  key: string;
  /** "blob" | "local" — where the file actually went. */
  storage: "blob" | "local";
}

export async function saveInvoiceFile(args: {
  key: string;
  data: Buffer | string;
  contentType?: string;
}): Promise<SavedFile> {
  const { key, data } = args;
  const contentType = args.contentType ?? contentTypeFor(key);

  if (isBlobConfigured()) {
    const { put } = await import("@vercel/blob");
    const result = await put(key, data, {
      access: "public",
      contentType,
      addRandomSuffix: false,
    });
    return { url: result.url, key, storage: "blob" };
  }

  const full = localPathFor(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
  const url = `/api/files/${key.split("/").map(encodeURIComponent).join("/")}`;
  return { url, key, storage: "local" };
}

/** Read a locally-stored invoice file (local storage mode only). */
export async function readLocalFile(key: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(localPathFor(key));
  } catch {
    return null;
  }
}