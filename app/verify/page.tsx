"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

type VerifyRequest = {
  passenger_id?: string;
  full_name?: string | null;
  town?: string | null;
  status?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  admin_notes?: string | null;
  id_front_path?: string | null;
  selfie_with_id_path?: string | null;
};

function s(v: any) {
  return String(v ?? "");
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

async function shrinkImageFile(file: File, maxWidth = 1400, maxHeight = 1400, quality = 0.72): Promise<File> {
  const type = (file.type || "").toLowerCase();
  if (!type.startsWith("image/")) return file;

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(fr.error || new Error("FileReader failed"));
    fr.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Image decode failed"));
    el.src = dataUrl;
  });

  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;
  if (!width || !height) return file;

  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;

  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  ctx.drawImage(img, 0, 0, targetW, targetH);

  const outType = "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), outType, quality);
  });

  if (!blob) return file;

  const baseName = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}.jpg`, {
    type: outType,
    lastModified: Date.now(),
  });
}

export default function VerifyPage() {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [userId, setUserId] = useState("");
  const [status, setStatus] = useState("unknown");
  const [reqData, setReqData] = useState<VerifyRequest | null>(null);

  const [fullName, setFullName] = useState("");
  const [town, setTown] = useState("");
  const [idFrontFile, setIdFrontFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setRefreshing(true);
    setError("");
    try {
      const res = await fetchWithTimeout(`/api/public/passenger/verification/request?passenger_id=${encodeURIComponent(userId)}`, {}, 30000);
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok || j?.ok === false) {
        throw new Error(s(j?.error || j?.message || `HTTP ${res.status}`));
      }

      const row = (j?.request || null) as VerifyRequest | null;
      setReqData(row);
      setStatus(s(row?.status || "not_submitted"));

      if (row?.full_name) setFullName(s(row.full_name));
      if (row?.town) setTown(s(row.town));
    } catch (e: any) {
      setError(s(e?.message || "Failed to load verification request."));
    } finally {
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetchWithTimeout("/api/verify/session-user", {}, 30000);
        const j: any = await res.json().catch(() => ({}));
        const uid = s(j?.userId || j?.user_id || "");
        if (!mounted) return;
        setUserId(uid);
      } catch {
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (userId) refresh();
  }, [userId, refresh]);

  const canSubmit = useMemo(() => {
    return !!userId && !!fullName.trim() && !!town.trim() && !!idFrontFile && !!selfieFile && !loading;
  }, [userId, fullName, town, idFrontFile, selfieFile, loading]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");

    try {
      if (!userId) throw new Error("User session missing.");
      if (!fullName.trim()) throw new Error("Full name required.");
      if (!town.trim()) throw new Error("Town required.");
      if (!idFrontFile) throw new Error("ID front photo required.");
      if (!selfieFile) throw new Error("Selfie holding ID required.");

      setMessage("Compressing images before upload...");

      const shrunkIdFront = await shrinkImageFile(idFrontFile, 1400, 1400, 0.72);
      const shrunkSelfie = await shrinkImageFile(selfieFile, 1400, 1400, 0.72);

      setMessage(
        `Uploading compressed files: ID ${Math.round(shrunkIdFront.size / 1024)} KB, Selfie ${Math.round(shrunkSelfie.size / 1024)} KB...`
      );

      const fd = new FormData();
      fd.append("full_name", fullName.trim());
      fd.append("town", town.trim());
      fd.append("id_front", shrunkIdFront);
      fd.append("selfie_with_id", shrunkSelfie);

      const res = await fetchWithTimeout(
        "/api/public/passenger/verification/request",
        {
          method: "POST",
          body: fd,
        },
        120000
      );

      const rawText = await res.text().catch(() => "");
      let j: any = null;

      try {
        j = rawText ? JSON.parse(rawText) : null;
      } catch {
        j = null;
      }

      if (!res.ok || !j?.ok) {
        const parts: string[] = [];

        if (!res.ok) {
          parts.push("HTTP " + String(res.status));
        }

        if (j?.error) {
          parts.push(String(j.error));
        } else if (j?.message) {
          parts.push(String(j.message));
        } else if (rawText) {
          parts.push(rawText);
        } else {
          parts.push("Empty or non-JSON response from verification API");
        }

        if (j?.hint) {
          parts.push("Hint: " + String(j.hint));
        }

        setError(parts.join(" | "));
        setMessage("");
        return;
      }

      setMessage(String(j?.message || "Submitted. Please wait for review."));
      await refresh();
    } catch (e: any) {
      const msg = s(e?.message || "");
      if (msg.toLowerCase().includes("aborted")) {
        setError("Submit timed out. Please try again.");
      } else {
        setError(msg || "Submit failed.");
      }
      setMessage("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Passenger Verification</h1>
          <p className="mt-2 text-gray-700">Upload your ID details so JRide can verify you.</p>
        </div>
        <button
          type="button"
          className="rounded border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          onClick={() => refresh()}
          disabled={refreshing || !userId}
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="mb-4 rounded border bg-white p-4">
        <div className="text-sm text-gray-700">User ID (UUID)</div>
        <div className="mt-1 text-2xl font-semibold tracking-wide">{userId || "-"}</div>
        <div className="mt-4 text-sm">
          Current status: <span className="font-semibold">{status || "unknown"}</span>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-4 text-blue-700">
          {message}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="rounded border bg-white p-4">
        <div className="mb-4">
          <label className="mb-2 block text-sm font-medium">Full name</label>
          <input
            className="w-full rounded border px-3 py-2"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Full name"
          />
        </div>

        <div className="mb-4">
          <label className="mb-2 block text-sm font-medium">Town</label>
          <input
            className="w-full rounded border px-3 py-2"
            value={town}
            onChange={(e) => setTown(e.target.value)}
            placeholder="Town"
          />
        </div>

        <div className="mb-4">
          <label className="mb-2 block text-sm font-medium">ID front photo</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setIdFrontFile(e.target.files?.[0] || null)}
          />
          {idFrontFile ? (
            <div className="mt-2 text-xs text-gray-500">
              Original size: {Math.round(idFrontFile.size / 1024)} KB
            </div>
          ) : null}
        </div>

        <div className="mb-4">
          <label className="mb-2 block text-sm font-medium">Selfie holding ID</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setSelfieFile(e.target.files?.[0] || null)}
          />
          {selfieFile ? (
            <div className="mt-2 text-xs text-gray-500">
              Original size: {Math.round(selfieFile.size / 1024)} KB
            </div>
          ) : null}
        </div>

        <button
          type="submit"
          className="rounded bg-black px-5 py-3 text-white disabled:opacity-50"
          disabled={!canSubmit}
        >
          {loading ? "Submitting..." : "Submit for verification"}
        </button>
      </form>
    </div>
  );
}