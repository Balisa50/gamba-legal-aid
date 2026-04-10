import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// In-memory fallback for local dev when Upstash env vars are missing
const memoryStore = new Map<string, { count: number; resetAt: number }>();

let _ratelimit: Ratelimit | null = null;

function getRatelimit(): Ratelimit | null {
  if (_ratelimit) return _ratelimit;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _ratelimit = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(10, "60 s"),
    analytics: true,
    prefix: "gambia-legal-aid",
  });
  return _ratelimit;
}

export async function checkRateLimit(
  identifier: string
): Promise<{ allowed: boolean; remaining: number; reset: number }> {
  const rl = getRatelimit();

  if (rl) {
    const result = await rl.limit(identifier);
    return {
      allowed: result.success,
      remaining: result.remaining,
      reset: result.reset,
    };
  }

  // Fallback: in-memory limiter
  const now = Date.now();
  const entry = memoryStore.get(identifier);
  if (!entry || now > entry.resetAt) {
    memoryStore.set(identifier, { count: 1, resetAt: now + 60_000 });
    return { allowed: true, remaining: 9, reset: now + 60_000 };
  }
  entry.count++;
  return {
    allowed: entry.count <= 10,
    remaining: Math.max(0, 10 - entry.count),
    reset: entry.resetAt,
  };
}
