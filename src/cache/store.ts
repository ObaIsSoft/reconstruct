// Filesystem cache — keyed by url+content_hash, TTL-aware
// Stores ReconstructSchema as JSON under .reconstruct/cache/

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import type { ReconstructSchema } from "../schema/types.js";

interface CacheEntry {
  schema: ReconstructSchema;
  cached_at: string;  // ISO 8601
  ttl_hours: number;
}

function cacheKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 20);
}

function cacheDir(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function cachePath(dir: string, url: string): string {
  return join(cacheDir(dir), `${cacheKey(url)}.json`);
}

function isExpired(entry: CacheEntry): boolean {
  const cachedMs = new Date(entry.cached_at).getTime();
  const ttlMs = entry.ttl_hours * 60 * 60 * 1000;
  return Date.now() - cachedMs > ttlMs;
}

export function readCache(url: string, dir: string): ReconstructSchema | null {
  const path = cachePath(dir, url);
  if (!existsSync(path)) return null;

  try {
    const entry: CacheEntry = JSON.parse(readFileSync(path, "utf-8"));
    if (isExpired(entry)) {
      unlinkSync(path);
      return null;
    }
    return entry.schema;
  } catch {
    return null;
  }
}

export function writeCache(
  url: string,
  schema: ReconstructSchema,
  dir: string,
  ttl_hours: number
): void {
  const path = cachePath(dir, url);
  const entry: CacheEntry = {
    schema,
    cached_at: new Date().toISOString(),
    ttl_hours,
  };
  try {
    writeFileSync(path, JSON.stringify(entry, null, 2), "utf-8");
  } catch {
    // Cache write failure is non-fatal
  }
}

export function invalidateCache(url: string, dir: string): boolean {
  const path = cachePath(dir, url);
  if (!existsSync(path)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

export function pruneExpiredCache(dir: string): number {
  if (!existsSync(dir)) return 0;
  let pruned = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const path = join(dir, file);
    try {
      const entry: CacheEntry = JSON.parse(readFileSync(path, "utf-8"));
      if (isExpired(entry)) {
        unlinkSync(path);
        pruned++;
      }
    } catch {
      // Corrupt entry — remove it
      try { unlinkSync(path); pruned++; } catch {}
    }
  }
  return pruned;
}

export function listCache(dir: string): Array<{ url: string; cached_at: string; expires_at: string; size_kb: number }> {
  if (!existsSync(dir)) return [];
  const results = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const path = join(dir, file);
    try {
      const entry: CacheEntry = JSON.parse(readFileSync(path, "utf-8"));
      const stat = statSync(path);
      const cachedMs = new Date(entry.cached_at).getTime();
      const expiresAt = new Date(cachedMs + entry.ttl_hours * 3600000).toISOString();
      results.push({
        url: entry.schema.meta.url,
        cached_at: entry.cached_at,
        expires_at: expiresAt,
        size_kb: Math.round(stat.size / 1024),
      });
    } catch {}
  }
  return results;
}
