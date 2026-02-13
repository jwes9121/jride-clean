"use client";

import { useEffect, useMemo, useState } from "react";

type PayoutRow = {
  id: number | string;
  driver_id: string;
  amount: number;
  status: string | null;
  requested_at: string | null;
  processed_at: string | null;
  payout_method?: string | null;
  payout_ref?: string | null;
  receipt_url?: string | null;
  admin_note?: string | null;
};

type Banner = { kind: "ok" | "warn" | "err"; text: string } | null;

function fmt(ts?: string | null) {
  if (!ts) return "";
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

function normalizeErr(e: any): string {
  const raw = (e?.message || e?.error || String(e || "")).trim();
  if (!raw) return "Request failed.";
  if (raw.length > 260) return raw.slice(0, 260) + "â€¦";
  return raw;
}

// Short ref generator: PAY-<id>-<4chars>
function genRef(id: number | string) {
  const s = String(id || "").replace(/[^a-zA-Z0-9]/g, "").slice(-6) || "X";
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PAY-${s}-${rnd}`;
}

export default function AdminDriverPayoutsPage() {
  const [status, setStatus] = useState<"pending" | "paid" | "all">("pending");
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [driverQuery, setDriverQuery] = useState("");

  // Mark Paid modal only
  const [markPaidId, setMarkPaidId] = useState<number | string | null>(null);
  const [method, setMethod] = useState("gcash");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");

  async function load() {
    setLoading(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/admin/driver-payouts?status=${status}&limit=200`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || data?.error || "Failed to load payouts");
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setRows([]);
      setBanner({ kind: "err", text: normalizeErr(e) });
    } finally {
      setLoading(false);
    }
  }

  async function markPaid(id: number | string) {
    setLoading(true);
    setBanner(null);
    try {
      const body: any = {
        id,
        action: "mark_paid",
        payout_method: method,
        payout_ref: ref || null,
        admin_note: note || null,
      };

      const res = await fetch("/api/admin/driver-payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => null);

      // Some failures come back as {code, details, hint} (Postgres-style)
      if (!res.ok) {
        const msg =
          data?.message ||
          data?.error ||
          data?.details ||
          (data?.code ? `DB_ERROR ${data.code}` : "") ||
          "Action failed";
        const hint = data?.hint ? ` Hint: ${String(data.hint)}` : "";
        throw new Error(String(msg) + hint);
      }

      setBanner({ kind: "ok", text: `Marked paid for #${id}.` });
      setMarkPaidId(null);
      setRef("");
      setNote("");
      await load();
    } catch (e: any) {
      setBanner({ kind: "err", text: normalizeErr(e) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [status]);

  const filtered = useMemo(() => {
    const q = driverQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.driver_id || "").toLowerCase().includes(q));
  }, [rows, driverQuery]);

  const bannerStyle = (k: "ok" | "warn" | "err") =>
    ({
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid #e5e7eb",
      marginTop: 12,
      background: k === "ok" ? "#ecfdf5" : k === "warn" ? "#fffbeb" : "#fef2f2",
      color: k === "ok" ? "#065f46" : k === "warn" ? "#92400e" : "#991b1b",
      fontSize: 14,
      maxWidth: 980,
      whiteSpace: "pre-wrap",
    } as any);

  const btn = {
    padding: "6px 10px",
    border: "1px solid #ddd",
    borderRadius: 8,
    background: "white",
    cursor: "pointer",
    fontSize: 12,
  } as any;

  const btnDisabled = { ...btn, opacity: 0.5, cursor: "not-allowed" } as any;

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Driver Payouts</h1>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <label>
          Status:&nbsp;
          <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="pending">pending</option>
            <option value="paid">paid</option>
            <option value="all">all</option>
          </select>
        </label>

        <label>
          Driver:&nbsp;
          <input
            value={driverQuery}
            onChange={(e) => setDriverQuery(e.target.value)}
            placeholder="search driver_idâ€¦"
            style={{ width: 260 }}
          />
        </label>

        <button style={loading ? btnDisabled : btn} onClick={load} disabled={loading}>
          Refresh
        </button>

        {loading ? <span style={{ opacity: 0.7 }}>Loadingâ€¦</span> : null}
      </div>

      {banner ? <div style={bannerStyle(banner.kind)}>{banner.text}</div> : null}

      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["id","driver_id","amount","status","requested_at","processed_at","method","ref","note","actions"].map((h) => (
                <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>{h}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filtered.map((r) => {
              const st = String(r.status || "").toLowerCase();
              const canMarkPaid = st === "pending"; // safest: only pending -> paid
              return (
                <tr key={String(r.id)}>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{String(r.id)}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee", fontFamily: "monospace" }}>{r.driver_id}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{Number(r.amount || 0).toFixed(2)}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{st}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{fmt(r.requested_at)}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{fmt(r.processed_at)}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{r.payout_method || ""}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{r.payout_ref || ""}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{r.admin_note || ""}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        style={!canMarkPaid || loading ? btnDisabled : btn}
                        disabled={!canMarkPaid || loading}
                        onClick={() => {
                          setMarkPaidId(r.id);
                          setMethod(String(r.payout_method || "gcash"));
                          setNote("");
                          setRef(genRef(r.id));
                        }}
                        title="pending -> paid (no wallet deduction)"
                      >
                        Mark Paid
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: 12, color: "#666" }}>No rows.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {markPaidId != null ? (
        <div style={{ marginTop: 14, padding: 12, border: "1px solid #ddd", borderRadius: 10, maxWidth: 720 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Mark Paid - #{String(markPaidId)}</div>

          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, alignItems: "center" }}>
            <div>Method</div>
            <input value={method} onChange={(e) => setMethod(e.target.value)} />

            <div>Reference</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="required"
                style={{ flex: 1 }}
              />
              <button
                style={loading ? btnDisabled : btn}
                disabled={loading}
                onClick={() => setRef(genRef(markPaidId))}
                title="Generate a new short reference"
              >
                Generate
              </button>
            </div>

            <div>Note</div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button
              style={loading || !ref.trim() ? btnDisabled : btn}
              disabled={loading || !ref.trim()}
              onClick={() => markPaid(markPaidId)}
            >
              Confirm
            </button>

            <button
              style={loading ? btnDisabled : btn}
              disabled={loading}
              onClick={() => setMarkPaidId(null)}
            >
              Cancel
            </button>
          </div>

          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
            Reference recommendation: short + unique (auto-generated like <span style={{ fontFamily: "monospace" }}>PAY-19-A1B2</span>).
          </div>
        </div>
      ) : null}
    </div>
  );
}