/**
 * Fetch JSON with a timeout and one retry on transient failures (timeout, 5xx, 429).
 * Returns the parsed body or a short error string describing why it failed —
 * so callers can surface the real reason instead of silently returning empty.
 */
export async function fetchJsonWithDiag(
  url: string,
  opts: { timeoutMs: number; revalidate: number; retries?: number }
): Promise<{ data: unknown | null; error: string | null }> {
  const { timeoutMs, revalidate, retries = 1 } = opts;
  let lastError = 'unknown error';
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        next: { revalidate },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        // Retry only on rate-limit / server errors; 4xx (other) won't fix on retry.
        if (res.status === 429 || res.status >= 500) continue;
        return { data: null, error: lastError };
      }
      return { data: await res.json(), error: null };
    } catch (e) {
      if (e instanceof Error) {
        lastError = e.name === 'TimeoutError' ? `timeout after ${timeoutMs}ms` : e.message;
      } else {
        lastError = String(e);
      }
    }
  }
  return { data: null, error: lastError };
}
