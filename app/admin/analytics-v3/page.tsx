"use client";

import * as React from "react";

export default function AnalyticsV3Page() {
  const [data, setData] = React.useState<any>(null);
  const [err, setErr] = React.useState("");

  React.useEffect(() => {
    fetch("/api/admin/analytics/v3?days=30", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setErr(String(e?.message || e)));
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <h1 className="text-2xl font-bold">Analytics V3</h1>
      <p className="mt-2 text-sm text-slate-600">
        Backend validation shell. Full UI will be built after the V3 payload is verified.
      </p>

      {err ? <pre className="mt-4 rounded bg-red-50 p-4 text-sm text-red-700">{err}</pre> : null}

      <pre className="mt-4 max-h-[70vh] overflow-auto rounded bg-white p-4 text-xs shadow">
        {data ? JSON.stringify(data, null, 2) : "Loading..."}
      </pre>
    </main>
  );
}
