"use client";
import * as React from "react";
import { useRouter } from "next/navigation";

type VReq = {
  passenger_id: string;
  full_name: string | null;
  town: string | null;
  status: "draft" | "pending" | "approved" | "rejected" | string;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  admin_notes?: string | null;
};

export default function VerificationPage() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState<string>("");
  const [reqRow, setReqRow] = React.useState<VReq | null>(null);

  const [fullName, setFullName] = React.useState("");
  const [idFrontPath, setIdFrontPath] = React.useState<string>("");
  const [selfiePath, setSelfiePath] = React.useState<string>("");
  const [uploading, setUploading] = React.useState<string>("");

  async function uploadOne(kind: "id_front" | "selfie", file: File) {
    setUploading(kind);
    try {
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("file", file);
      const r = await fetch("/api/public/passenger/verification/upload", { method: "POST", body: fd });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Upload failed");
      if (kind === "id_front") setIdFrontPath(String(j.path || ""));
      else setSelfiePath(String(j.path || ""));
    } finally {
      setUploading("");
    }
  }  const [town, setTown] = React.useState("");

  async function load() {
    setLoading(true);
    setMsg("");
    try {
      const r = await fetch("/api/public/passenger/verification/request", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!j?.authed) {
        setMsg("Please sign in first.");
        setReqRow(null);
        return;
      }
      const row: VReq | null = j?.request || null;
      setReqRow(row);
      if (row?.full_name) setFullName(String(row.full_name));
      if (row?.town) setTown(String(row.town));
    } catch (e: any) {
      setMsg(e?.message || "Failed to load verification status.");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    setSaving(true);
    setMsg("");
    try {
      const r = await fetch("/api/public/passenger/verification/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName, town , id_front_path: idFrontPath || null, selfie_with_id_path: selfiePath || null}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setMsg(j?.error || "Submit failed.");
        return;
      }
      setReqRow(j.request || null);
      setMsg("Submitted. Status: pending. Please wait for admin approval.");
    } catch (e: any) {
      setMsg(e?.message || "Submit failed.");
    } finally {
      setSaving(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  const status = String(reqRow?.status || "");
  const isPending = status === "pending";
  const isApproved = status === "approved";
  const isRejected = status === "rejected";

  
const hasUploads = Boolean(String(idFrontPath || "").trim()) && Boolean(String(selfiePath || "").trim());
const canSubmit = hasUploads && Boolean(String(fullName || "").trim()) && Boolean(String(town || "").trim()) && !isApproved && !isPending;
return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-white">
      <div className="w-full max-w-lg rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xl font-bold">Passenger Verification</div>
            <div className="text-sm opacity-70 mt-1">
              Verification is required to unlock night booking (8PM-5AM) and free ride promo.
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push("/passenger")}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-4 py-2 font-semibold"
          >
            Back
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-black/10 bg-black/5 p-3 text-sm">
          {loading ? (
            <div>Loading...</div>
          ) : (
            <>
              <div className="font-semibold">Status: {status || "none"}</div>
              {isPending ? (
                <div className="opacity-80 mt-1">Your request is pending approval.</div>
              ) : null}
              {isApproved ? (
                <div className="opacity-80 mt-1">Approved. Return to dashboard.</div>
              ) : null}
              {isRejected ? (
                <div className="opacity-80 mt-1">Rejected. You may update and resubmit.</div>
              ) : null}
              {reqRow?.admin_notes ? (
                <div className="opacity-80 mt-2">Notes: {String(reqRow.admin_notes)}</div>
              ) : null}
            </>
          )}
        </div>

        <div className="mt-5 grid gap-3">
          <label className="text-sm font-semibold">
            Full name
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your full name"
              className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2"
            />
          </label>

          <label className="text-sm font-semibold">
            Town (pilot)
            <select
              value={town}
              onChange={(e) => setTown(e.target.value)}
              className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2"
            >
              <option value="">Select town</option>
              <option value="Lagawe">Lagawe</option>
              <option value="Hingyon">Hingyon</option>
              <option value="Banaue">Banaue</option>
            </select>
          </label>

          <div className="mt-3 grid grid-cols-1 gap-3">
  <div>
    <div className="text-sm font-semibold mb-1">Upload valid ID (front)</div>
    <input
      type="file"
      accept="image/jpeg,image/png,image/webp"
      onChange={(e) => {
        const f = e.target.files && e.target.files[0];
        if (f) uploadOne("id_front", f);
      }}
    />
    <div className="text-xs opacity-70 mt-1">
      {uploading === "id_front" ? "Uploading..." : (idFrontPath ? ("Saved: " + idFrontPath) : "No file yet")}
    </div>
  </div>

  <div>
    <div className="text-sm font-semibold mb-1">Selfie holding the ID</div>
    <input
      type="file"
      accept="image/jpeg,image/png,image/webp"
      onChange={(e) => {
        const f = e.target.files && e.target.files[0];
        if (f) uploadOne("selfie", f);
      }}
    />
    <div className="text-xs opacity-70 mt-1">
      {uploading === "selfie" ? "Uploading..." : (selfiePath ? ("Saved: " + selfiePath) : "No file yet")}
    </div>
  </div>
</div>
<button
            type="button"
            disabled={saving || !canSubmit}
            onClick={submit}
            className={"rounded-xl px-4 py-2 font-semibold text-white " + ((saving || !canSubmit) ? "bg-slate-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500")}
          >
            {saving ? "Submitting..." : "Submit for verification"}
          </button>
{(!canSubmit && !saving) ? (
  <div className="text-xs text-slate-600 mt-2">Please upload BOTH photos and fill name + town to enable submit.</div>
) : null}

          {msg ? <div className="text-sm text-amber-700">{msg}</div> : null}
        </div>
      </div>
    </main>
  );
}
