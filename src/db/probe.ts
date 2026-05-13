import postgres from 'postgres';

export interface ProbeResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
}

export async function probe(
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<ProbeResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const start = Date.now();
  const sql = postgres(url, {
    prepare: false,
    connect_timeout: Math.max(1, Math.ceil(timeoutMs / 1000)),
    max: 1,
    idle_timeout: 1,
    onnotice: () => {},
  });
  try {
    await sql`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    try {
      await sql.end({ timeout: 1 });
    } catch {
      // ignore — best-effort close
    }
  }
}
