/** Simple token bucket keyed by string (IP). */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; updated: number }>();
  constructor(
    private capacity: number,
    private refillPerMs: number,
    private now: () => number = Date.now,
  ) {}

  take(key: string): boolean {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, updated: t };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(this.capacity, b.tokens + (t - b.updated) * this.refillPerMs);
    b.updated = t;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  sweep(): void {
    const t = this.now();
    for (const [k, b] of this.buckets) if (t - b.updated > 10 * 60 * 1000) this.buckets.delete(k);
  }
}
