import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

export function ensureUploadDir(): void {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

// BR-27: a generated, non-guessable storage filename; the original filename
// is kept only as display metadata and never used as a path segment.
export function generateStoredFilename(originalFilename: string): string {
  const extension = originalFilename.split(".").pop()?.toLowerCase();
  return extension ? `${randomUUID()}.${extension}` : randomUUID();
}
