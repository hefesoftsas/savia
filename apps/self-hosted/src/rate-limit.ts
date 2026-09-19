/** Single-node bounded limiter. The Docker topology intentionally has one API writer. */
export function createRateLimiter({
  limit = 30,
  periodMs = 60_000,
  maxKeys = 20_000,
  now = Date.now,
} = {}) {
  const buckets = new Map<string, { count: number; expires: number }>();
  return {
    async limit({ key }: { key: string }) {
      const time = now();
      let bucket = buckets.get(key);
      if (!bucket || bucket.expires <= time) {
        if (buckets.size >= maxKeys)
          for (const [id, value] of buckets)
            if (value.expires <= time) buckets.delete(id);
        if (!buckets.has(key) && buckets.size >= maxKeys)
          return { success: false };
        bucket = { count: 0, expires: time + periodMs };
        buckets.set(key, bucket);
      }
      if (bucket.count >= limit) return { success: false };
      bucket.count++;
      return { success: true };
    },
  };
}
