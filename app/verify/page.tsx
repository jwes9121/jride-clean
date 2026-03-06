"use client";

import React, { FormEvent, useEffect, useMemo, useState } from "react";

type VerificationStatus =
  | "submitted"
  | "pending_admin"
  | "approved"
  | "rejected"
  | null;

type VerificationRequest = {
  passenger_id?: string | null;
  full_name?: string | null;
  town?: string | null;
  status?: VerificationStatus;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  admin_notes?: string | null;
  id_front_path?: string | null;
  selfie_with_id_path?: string | null;
};

function niceStatus(status: VerificationStatus): string {
  const s = String(status || "").trim().toLowerCase();
  if (!s) return "Not submitted";
  if (s === "submitted") return "Pending dispatcher review";
  if (s === "pending_admin") return "Pending admin review";
  if (s === "approved") return "Approved";
  if (s === "rejected") return "Rejected";
  return s;
}

function isLocked(status: VerificationStatus): boolean {
  const s = String(status || "").trim().toLowerCase();
  return s === "submitted" || s === "pending_admin" || s === "approved";
}

export default function VerifyPage() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [userId, setUserId] = useState<string>("");

  const [current, setCurrent] = useState<VerificationRequest | null>(null);

  const [fullName, setFullName] = useState("");
  const [town, setTown] = useState("");
  const [idFrontFile, setIdFrontFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const locked = useMemo(() => isLocked(current?.status || null), [current?.status]);

  async function fetchWithTimeout(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    ms: number
  ) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);

    try {
      const nextInit: RequestInit = {
        ...(init || {}),
        credentials: "include",
        signal: controller.signal,
      };
      return await fetch(input, nextInit);
    } finally {
      clearTimeout(id);
    }
  }

  async function refresh() {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const sres = await fetchWithTimeout(
        "/api/verify/session-user",
        {
          method: "GET",
          cache: "no-store",
        },
        30000
      );

      const sj: any = await sres.json().catch(() => ({}));
      const uid = sj?.user_id ? String(sj.user_id) : "";

      if (!uid) {
        setAuthed(false);
        setUserId("");
        setCurrent(null);
        return;
      }

      setAuthed(true);
      setUserId(uid);

      const rres = await fetchWithTimeout(
        "/api/public/passenger/verification/request",
        {
          method: "GET",
          cache: "no-store",
        },
        30000
      );

      const rj: any = await rres.json().catch(() => ({}));
      const req = rj?.request ? (rj.request as VerificationRequest) : null;
      setCurrent(req);

      if (req) {
        setFullName(String(req.full_name || ""));
        setTown(String(req.town || ""));
      }
    } catch (e: any) {
      setError("Failed to load verification state: " + String(e?.message || e));
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
    setMessage("Submitting verification...");

    try {
      const fd = new FormData();
      fd.append("full_name", fullName.trim());
      fd.append("town", town.trim());
      fd.append("id_front", idFrontFile);
      fd.append("selfie_with_id", selfieFile);

      const res = await fetchWithTimeout(
        "/api/public/passenger/verification/request",
        {
          method: "POST",
          body: fd,
        },
        120000
      );

      const j: any = await res.json().catch(async () => {
        const t = await res.text().catch(() => "");
        return { ok: false, error: t || "Unknown error" };
      });

      if (!res.ok || !j?.ok) {
        setError(String(j?.error || "Submit failed"));
        setMessage("");
        return;
      }

      if (j?.message) {
        setMessage(String(j.message));
      } else {
        setMessage("Submitted. Please wait for review.");
      }

      await refresh();
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      if (msg.toLowerCase().includes("abort")) {
        setError("Submit timed out. Please try again.");
      } else {
        setError("Submit error: " + msg);
      }
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
            Upload your ID details so JRide can verify you.
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
        <div className="font-mono text-xs break-all mt-1">
          {userId || "(not signed in)"}
        </div>

        <div className="mt-3 text-xs">
          Current status:{" "}
          <span className="font-semibold">
            {loading ? "Loading..." : niceStatus(current?.status || null)}
          </span>
          {current?.status === "rejected" && current?.admin_notes ? (
            <div className="mt-1 text-red-600">
              Reason: {String(current.admin_notes)}
            </div>
          ) : null}
        </div>
      </div>

      {message ? (
        <div className="mt-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-4 space-y-4 rounded border bg-white p-4">
        <div>
          <label className="block text-xs text-gray-700 mb-1">Full name</label>
          <input
            className="w-full border rounded px-3 py-2"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={loading || submitting || locked}
          />
        </div>

        <div>
          <label className="block text-xs text-gray-700 mb-1">Town</label>
          <input
            className="w-full border rounded px-3 py-2"
            value={town}
            onChange={(e) => setTown(e.target.value)}
            disabled={loading || submitting || locked}
          />
        </div>

        <div>
          <label className="block text-xs text-gray-700 mb-1">ID front photo</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setIdFrontFile(e.target.files?.[0] || null)}
            disabled={loading || submitting || locked}
          />
        </div>

        <div>
          <label className="block text-xs text-gray-700 mb-1">Selfie holding ID</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setSelfieFile(e.target.files?.[0] || null)}
            disabled={loading || submitting || locked}
          />
        </div>

        <button
          type="submit"
          className="rounded bg-black text-white px-4 py-2 disabled:opacity-50"
          disabled={loading || submitting || locked}
        >
          {submitting ? "Submitting..." : locked ? "Locked" : "Submit for verification"}
        </button>
      </form>
    </div>
  );
}