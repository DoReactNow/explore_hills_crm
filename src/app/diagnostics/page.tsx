"use client";

// Diagnostics for operators (system:view-diagnostics). It reads the guarded API through the shared
// client, so a refusal shows the same friendly message as everywhere else.
import { useEffect, useState } from "react";
import type { Diagnostics } from "@/modules/system";
import { apiRequest, type ApiResult } from "@/shared/api/client";
import { formatInstant, parseInstant } from "@/shared/time";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";

export default function DiagnosticsPage() {
  const [result, setResult] = useState<ApiResult<Diagnostics> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<Diagnostics>("/api/diagnostics", { signal: controller.signal }).then((next) => {
      if (!controller.signal.aborted) setResult(next);
    });
    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>Diagnostics</h1>
      {result === null ? <p>Loading…</p> : null}
      {result && !result.ok ? <ErrorMessage error={result.error} /> : null}
      {result?.ok ? (
        <section>
          <p>Status: {result.data.status}</p>
          <p>Database: {result.data.database}</p>
          <p>
            Worker: {result.data.worker.state}
            {result.data.worker.lastBeatAt
              ? ` (last heartbeat ${formatInstant(parseInstant(result.data.worker.lastBeatAt), "dateTime")})`
              : null}
          </p>
          <p>Version: {result.data.version}</p>
          <p>Server time: {formatInstant(parseInstant(result.data.time), "dateTime")}</p>
        </section>
      ) : null}
    </main>
  );
}
