"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type VerificationStatus = "submitted" | "pending_admin" | "approved" | "rejected" | string;

type VerificationRequest = {
  passenger_id: string;
  full_name: string | null;
  town: string | null;
  status: VerificationStatus | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  admin_notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  id_front_path: string | null;
  selfie_with_id_path: string | null;
  id_back_path?: string | null;
  id_front_mime?: string | null;
  selfie_mime?: string | null;
  id_front_bytes?: number | null;
  selfie_bytes?: number | null;
};

function niceStatus(s?: string | null) {
  const v = String(s || "");
  if (!v) return "Not submitted";
  if (v === "submitted") return "Submitted (waiting for dispatcher review)";
  if (v === "pending_admin") return "Pending Admin (dispatcher forwarded)";
  if (v === "approved") return "VERIFIED";
  if (v === "rejected") return "Rejected (you may re-submit)";
  return v;
}

function isLocked(status?: string | null) {
  return status === "submitted" || status === "pending_admin" || status === "approved";
}

export default function PassengerVerifyPage() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  const [authed, setAuthed] = useState<boolean>(false);
  const [userId, setUserId] = useState<string>("");

  const [current, setCurrent] = useState<VerificationRequest | null>(null);

  // form fields (kept minimal; backend only needs full_name + town + 2 files)
  const [fullName, setFullName] = useState("");
  const [town, setTown] = useState("");
  const [idFrontFile, setIdFrontFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);

  const locked = useMemo(() => isLocked(current?.status || null), [current?.status]);

  async function refresh() {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      // session user
      const sres = await fetch("/api/verify/session-user", { method: "GET", cache: "no-store" });
      const sj: any = await sres.json().catch(() => ({}));
      const uid = sj?.user_id ? String(sj.user_id) : "";

      if (!uid) {
        setAuthed(false);
        setUserId("");
        setCurrent(null);
        setLoading(false);
        return;
      }

      setAuthed(true);
      setUserId(uid);

      // current request
      const rres = await fetch("/api/public/passenger/verification/request", { method: "GET", cache: "no-store" });
      const rj: any = await rres.json().catch(() => ({}));

      const req = rj?.request ? (rj.request as VerificationRequest) : null;
      setCurrent(req);

      // Autofill inputs from existing request (if present)
      if (req) {
        setFullName(String(req.full_name || ""));
        setTown(String(req.town || ""));
      }
    } catch (e: any) {
      setError("Failed to load verification state: " + (e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");

    if (!authed || !userId) {
      setError("You are not signed in. Please sign in first.");
      return;
    }

    if (locked) {
      setMessage("Already submitted. Please wait for review.");
      return;
    }

    if (!fullName.trim()) {
      setError("Full name is required.");
      return;
    }
    if (!town.trim()) {
      setError("Town is required.");
      return;
    }
    if (!idFrontFile) {
      setError("Please choose an ID front photo.");
      return;
    }
    if (!selfieFile) {
      setError("Please choose a selfie holding your ID.");
      return;
    }

    setSubmitting(true);
    setMessage("Submitting verification…");

    try {
      const body = new FormData();
      body.append("full_name", fullName.trim());
      body.append("town", town.trim());
      body.append("id_front", idFrontFile);
      body.append("selfie_with_id", selfieFile);

      const res = await fetch("/api/public/passenger/verification/request", {
        method: "POST",
        body,
      });

      const j: any = await res.json().catch(async () => {
        const t = await res.text().catch(() => "");
        return { ok: false, error: t || "Unknown error" };
      });

      if (!res.ok || !j?.ok) {
        setError(String(j?.error || "Submit failed"));
        setMessage("");
        return;
      }

      setMessage("Submitted. Please wait for review.");
      await refresh();
    } catch (e: any) {
      setError("Submit error: " + (e?.message || String(e)));
      setMessage("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-4 text-sm max-w-xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">Passenger Verification</h1>
          <p className="text-xs text-gray-600 mt-1">
            Upload your ID details so JRide can verify you. Verified passengers can book rides and access restricted services.
          </p>
        </div>

        <button
          type="button"
          className="border rounded px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
          onClick={refresh}
          disabled={loading || submitting}
        >
          Refresh
        </button>
      </div>

      <div className="mt-4 p-3 rounded border bg-white">
        <div className="text-xs text-gray-600">User ID (UUID)</div>
        <div className="font-mono text-xs break-all mt-1">{userId || "(not signed in)"}</div>

        <div className="mt-3 text-xs">
          Current status:{" "}
          <span className="font-semibold">
            {loading ? "Loading…" : niceStatus(current?.status || null)}
          </span>
          {current?.status === "rejected" && current?.admin_notes ? (
            <div className="text-red-700 mt-1">
              Reason/notes: {current.admin_notes}
            </div>
          ) : null}
        </div>

        {locked ? (
          <div className="mt-2 text-xs text-blue-700">
            Already submitted. Please wait for review.
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mt-3 p-3 rounded border border-red-200 bg-red-50 text-xs text-red-800">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="mt-3 p-3 rounded border border-blue-200 bg-blue-50 text-xs text-blue-800">
          {message}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-3 mt-4">
        <div className="flex flex-col">
          <label className="text-xs mb-1">Full name (same as ID)</label>
          <input
            name="full_name"
            className="border rounded px-2 py-2 text-sm disabled:bg-gray-50"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={loading || submitting || locked}
            placeholder="e.g., Juan Dela Cruz"
          />
        </div>

        <div className="flex flex-col">
          <label className="text-xs mb-1">Town</label>
          <input
            name="town"
            className="border rounded px-2 py-2 text-sm disabled:bg-gray-50"
            value={town}
            onChange={(e) => setTown(e.target.value)}
            disabled={loading || submitting || locked}
            placeholder="e.g., Lagawe"
          />
        </div>

        <div className="flex flex-col">
          <label className="text-xs mb-1">ID photo (front of your ID)</label>
          <input
            name="id_front"
            type="file"
            accept="image/*"
            className="border rounded px-2 py-2 text-sm disabled:bg-gray-50"
            onChange={(e) => setIdFrontFile(e.target.files?.[0] ?? null)}
            disabled={loading || submitting || locked}
          />
          {idFrontFile ? (
            <div className="text-[11px] text-gray-600 mt-1">Selected: {idFrontFile.name}</div>
          ) : null}
        </div>

        <div className="flex flex-col">
          <label className="text-xs mb-1">Selfie photo (you holding your ID)</label>
          <input
            name="selfie_with_id"
            type="file"
            accept="image/*"
            className="border rounded px-2 py-2 text-sm disabled:bg-gray-50"
            onChange={(e) => setSelfieFile(e.target.files?.[0] ?? null)}
            disabled={loading || submitting || locked}
          />
          {selfieFile ? (
            <div className="text-[11px] text-gray-600 mt-1">Selected: {selfieFile.name}</div>
          ) : null}
        </div>

        <button
          type="submit"
          className="w-full bg-green-600 text-white rounded px-3 py-2 text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={loading || submitting || locked}
        >
          {submitting ? "Submitting…" : locked ? "Submitted" : "Submit for verification"}
        </button>

        {current?.status ? (
          <div className="text-[11px] text-gray-600">
            Tip: If you need to change details after submitting, ask admin to reject so you can re-submit.
          </div>
        ) : null}
      </form>
    </div>
  );
}
