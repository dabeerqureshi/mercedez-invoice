/**
 * Bundled brand images for the invoice PDF (logo.png / footer.png), read from
 * disk and returned as base64 data URIs. Files are traced into the serverless
 * bundle via outputFileTracingIncludes in next.config.ts.
 */
import { readFileSync } from "fs";
import path from "path";

const ASSETS_DIR = path.join(process.cwd(), "src", "lib", "pdf", "assets");

const cache = new Map<string, string>();
const sizeCache = new Map<string, { width: number; height: number }>();

function read(name: string): Buffer {
  return readFileSync(path.join(ASSETS_DIR, name));
}

export function assetDataUri(name: string): string {
  const hit = cache.get(name);
  if (hit) return hit;
  const uri = `data:image/png;base64,${read(name).toString("base64")}`;
  cache.set(name, uri);
  return uri;
}

/** Read pixel dimensions from a PNG's IHDR chunk. */
export function pngSize(name: string): { width: number; height: number } {
  const hit = sizeCache.get(name);
  if (hit) return hit;
  const buf = read(name);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const size = { width, height };
  sizeCache.set(name, size);
  return size;
}

export function logoDataUri(): string {
  return assetDataUri("logo.png");
}

export function footerDataUri(): string {
  return assetDataUri("footer.png");
}