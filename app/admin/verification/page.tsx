"use client";

import * as React from "react";
import PassengerEvidence from "@/app/components/PassengerEvidence";

type Row = {
  passenger_id: string;
  full_name: string | null;
  town: string | null;
  status: string | null;
  submitted_at: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  admin_notes: string | null;
  can_view_evidence?: boolean;
  has_id_front?: boolean;
  has_id_back?: boolean;
  has_selfie?: boolean;
};

type Payload = {
  ok: boolean;
  error?: string;
  counts?: { submitted?: number; pending_admin?: number; declined?: number };
  rows?: { submitted?: Row[]; pending_admin?: Row[]; declined?: Row[] };
};

function fmt(value: any) {
  try {
    if (!value) return "";
    return new Date(String(value)).toLocaleString();
  } catch {
    return String(value || "");
  }
}

function statusLabel(value: string | null | undefined) {
  if (value === "rejected") return "Declined";
  if (value === "pending_admin") return "Pending Admin";
  if (value === "submitted") return "Submitted";
  if (value === "approved") return "Approved";
  return String(value || "");
}

function StatCard(props: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/10 p-4">
      <div className="text-sm opacity-70">{props.label}</div>
      <div className="mt-1 text-3xl font-bold">{props.value}</div>
    </div>
  );
}

function RowItem(props: {
  row: Row;
  busy: boolean;
  onForward: (id: string, notes: string) => void;
  onDecide: (id: string, d: "approve" | "reject", n: string) => void;
  showForward: boolean;
}) {
  const { row, busy, onForward, onDecide, showForward } = props;
  const [notes, setNotes] = React.useState(row.admin_notes || "");

  return (
    <tr className="border-t border-black/10 align-top">
      <td className="p-3">
        <div className="font-semibold">{row.full_name || "(no name)"}</div>
        <div className="text-xs opacity-70">{row.passenger_id}</div>
        <div className="mt-1 text-xs opacity-60">Status: {statusLabel(row.status)}</div>
      </td>
      <td className="p-3">{row.town || ""}</td>
      <td className="p-3">{fmt(row.submitted_at)}</td>
      <td className="p-3">
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes; required when declining" className="w-full rounded-xl border border-black/10 px-3 py-2" />
      </td>
      <td className="p-3">
        <PassengerEvidence passengerId={row.passenger_id} canView={!!row.can_view_evidence} hasId={!!row.has_id_front} hasBack={!!row.has_id_back} hasSelfie={!!row.has_selfie} />
      </td>
      <td className="p-3">
        <div className="flex flex-wrap gap-2">
          {showForward ? (
            <button type="button" disabled={busy} onClick={() => onForward(row.passenger_id, notes)} className={"rounded-xl px-4 py-2 font-semibold text-white " + (busy ? "cursor-not-allowed bg-sky-300" : "bg-sky-600 hover:bg-sky-500")}>{busy ? "Working..." : "Forward to Admin"}</button>
          ) : null}
          <button type="button" disabled={busy} onClick={() => onDecide(row.passenger_id, "approve", notes)} className={"rounded-xl px-4 py-2 font-semibold text-white " + (busy ? "cursor-not-allowed bg-emerald-300" : "bg-emerald-600 hover:bg-emerald-500")}>{busy ? "Working..." : "Approve"}</button>
          <button type="button" disabled={busy} onClick={() => onDecide(row.passenger_id, "reject", notes)} className={"rounded-xl px-4 py-2 font-semibold text-white " + (busy ? "cursor-not-allowed bg-red-300" : "bg-red-600 hover:bg-red-500")}>{busy ? "Working..." : "Decline"}</button>
        </div>
      </td>
    </tr>
  );
}

function QueueTable(props: {
  title: string;
  loading: boolean;
  rows: Row[];
  busyId: string;
  onForward: (id: string, notes: string) => void;
  onDecide: (id: string, d: "approve" | "reject", n: string) => void;
  showForward: boolean;
}) {
  const { title, loading, rows, busyId, onForward, onDecide, showForward } = props;
  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-black/10">
      <div className="bg-black/5 px-4 py-3 text-sm font-semibold">{loading ? "Loading..." : title + " - " + rows.length}</div>
      {!loading && rows.length === 0 ? <div className="p-4 text-sm">No items.</div> : null}
      {rows.length > 0 ? (
        <table className="w-full text-sm">
          <thead className="bg-black/5"><tr><th className="p-3 text-left">Passenger</th><th className="p-3 text-left">Town</th><th className="p-3 text-left">Submitted</th><th className="p-3 text-left">Notes / decline reason</th><th className="p-3 text-left">Uploads</th><th className="p-3 text-left">Actions</th></tr></thead>
          <tbody>{rows.map((r) => <RowItem key={r.passenger_id} row={r} busy={busyId === r.passenger_id} onForward={onForward} onDecide={onDecide} showForward={showForward} />)}</tbody>
        </table>
      ) : null}
    </div>
  );
}

function DeclinedTable(props: { loading: boolean; rows: Row[] }) {
  const { loading, rows } = props;
  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-red-200">
      <div className="bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">{loading ? "Loading..." : "Declined - " + rows.length}</div>
      {!loading && rows.length === 0 ? <div className="p-4 text-sm">No declined verifications.</div> : null}
      {rows.length > 0 ? (
        <table className="w-full text-sm">
          <thead className="bg-red-50/60"><tr><th className="p-3 text-left">Passenger</th><th className="p-3 text-left">Town</th><th className="p-3 text-left">Declined</th><th className="p-3 text-left">Declined by</th><th className="p-3 text-left">Reason / guidance to passenger</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.passenger_id} className="border-t border-red-100 align-top">
              <td className="p-3"><div className="font-semibold">{r.full_name || "(no name)"}</div><div className="text-xs opacity-70">{r.passenger_id}</div></td>
              <td className="p-3">{r.town || ""}</td>
              <td className="p-3">{fmt(r.reviewed_at)}</td>
              <td className="p-3">{r.reviewed_by || ""}</td>
              <td className="p-3">{r.admin_notes?.trim() || "No reason recorded (older decline)."}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : null}
    </div>
  );
}

export default function AdminVerificationPage() {
  const [loading, setLoading] = React.useState(true);
  const [submitted, setSubmitted] = React.useState<Row[]>([]);
  const [pendingAdmin, setPendingAdmin] = React.useState<Row[]>([]);
  const [declined, setDeclined] = React.useState<Row[]>([]);
  const [cSubmitted, setCSubmitted] = React.useState(0);
  const [cPendingAdmin, setCPendingAdmin] = React.useState(0);
  const [cDeclined, setCDeclined] = React.useState(0);
  const [msg, setMsg] = React.useState("");
  const [busyId, setBusyId] = React.useState("");

  async function load() {
    setLoading(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/passenger-verifications/pending", { cache: "no-store", credentials: "include" });
      const j: Payload = await r.json().catch(() => ({} as any));
      if (!r.ok || !j?.ok) throw new Error(j?.error || ("Failed to load (HTTP " + r.status + ")"));

      const counts = j.counts || {};
      const rows = j.rows || {};
      const sub = Array.isArray(rows.submitted) ? rows.submitted : [];
      const pad = Array.isArray(rows.pending_admin) ? rows.pending_admin : [];
      const dec = Array.isArray(rows.declined) ? rows.declined : [];

      setSubmitted(sub);
      setPendingAdmin(pad);
      setDeclined(dec);
      setCSubmitted(Number(counts.submitted || sub.length || 0));
      setCPendingAdmin(Number(counts.pending_admin || pad.length || 0));
      setCDeclined(Number(counts.declined || dec.length || 0));
    } catch (e: any) {
      setMsg(e?.message || "Failed to load.");
      setSubmitted([]); setPendingAdmin([]); setDeclined([]);
      setCSubmitted(0); setCPendingAdmin(0); setCDeclined(0);
    } finally {
      setLoading(false);
    }
  }

  function notifyPendingChanged() {
    try {
      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        const bc = new BroadcastChannel("jride_verification");
        bc.postMessage({ type: "pending_changed", at: Date.now() });
        bc.close();
      }
    } catch {}
    try { if (typeof window !== "undefined") localStorage.setItem("jride_verification_pending_changed", String(Date.now())); } catch {}
  }

  async function forward(passenger_id: string, notes: string) {
    setMsg("Forwarding to admin..."); setBusyId(passenger_id);
    try {
      const r = await fetch("/api/admin/passenger-verifications/forward", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ passenger_id, admin_notes: notes }) });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || ("Forward failed (HTTP " + r.status + ")"));
      await load(); notifyPendingChanged(); setMsg("Done."); setTimeout(() => setMsg(""), 1200);
    } catch (e: any) { setMsg("ERROR: " + (e?.message || "Forward failed")); }
    finally { setBusyId(""); }
  }

  async function decide(passenger_id: string, decision: "approve" | "reject", admin_notes: string) {
    if (decision === "reject" && !admin_notes.trim()) {
      setMsg("ERROR: Enter a decline reason so the passenger knows what to correct before resubmitting.");
      return;
    }
    setMsg("Submitting decision..."); setBusyId(passenger_id);
    try {
      const r = await fetch("/api/admin/passenger-verifications/decide", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ passenger_id, decision, admin_notes }) });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || ("Decision failed (HTTP " + r.status + ")"));
      await load(); notifyPendingChanged(); setMsg(decision === "reject" ? "Declined and passenger guidance saved." : "Approved."); setTimeout(() => setMsg(""), 1800);
    } catch (e: any) { setMsg("ERROR: " + (e?.message || "Decision failed")); }
    finally { setBusyId(""); }
  }

  React.useEffect(() => { load(); }, []);

  return (
    <main className="min-h-screen bg-white p-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-2xl font-bold">Passenger Verification (Admin)</div>
            <div className="mt-1 text-sm opacity-70">Dispatcher queue: Submitted then Pending Admin then approve or decline. Admin may approve directly from Submitted.</div>
          </div>
          <button type="button" onClick={load} className="rounded-xl border border-black/10 px-4 py-2 font-semibold hover:bg-black/5">Refresh</button>
        </div>

        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="font-semibold">Strict name rule:</span> first name and last name are required and must each contain at least 2 letters. Middle initials are allowed. The name must match the submitted valid ID. Server approval is blocked when the stored name fails this format.
        </div>

        {msg ? <div className="mt-4 rounded-xl border border-black/10 bg-black/5 p-3 text-sm">{msg}</div> : null}

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatCard label="Submitted (Dispatcher queue)" value={loading ? "..." : String(cSubmitted)} />
          <StatCard label="Pending Admin" value={loading ? "..." : String(cPendingAdmin)} />
          <StatCard label="Declined" value={loading ? "..." : String(cDeclined)} />
        </div>

        <QueueTable title="Submitted (waiting for dispatcher review)" loading={loading} rows={submitted} busyId={busyId} onForward={forward} onDecide={decide} showForward={true} />
        <QueueTable title="Pending Admin (dispatcher forwarded)" loading={loading} rows={pendingAdmin} busyId={busyId} onForward={forward} onDecide={decide} showForward={false} />
        <DeclinedTable loading={loading} rows={declined} />
      </div>
    </main>
  );
}
