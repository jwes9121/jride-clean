param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info($m) { Write-Host $m -ForegroundColor Cyan }
function Write-Ok($m) { Write-Host $m -ForegroundColor Green }
function Write-Warn($m) { Write-Host $m -ForegroundColor Yellow }
function Write-Fail($m) { Write-Host $m -ForegroundColor Red }

Write-Info "== JRIDE: Replace verify page with compiling Option-B baseline (V1 / PS5-safe) =="

$proj = (Resolve-Path -LiteralPath $ProjRoot).Path
$target = Join-Path $proj "app\verify\page.tsx"

if (!(Test-Path -LiteralPath $target)) {
  Write-Fail "[FAIL] Not found: $target"
  exit 1
}

# backup
$bakDir = Join-Path $proj "_patch_bak"
if (!(Test-Path -LiteralPath $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("page.tsx.bak.VERIFY_REPLACE_OPTIONB_V1.$stamp")
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Ok "[OK] Backup: $bak"

# Clean, compiling baseline page that uses ONLY Next API Option-B endpoints.
$content = @'
"use client";

import React, { useEffect, useMemo, useState } from "react";

type VerificationRecord = {
  id?: number;
  status?: string;
  reject_reason?: string | null;
  id_photo_url?: string | null;
  selfie_photo_url?: string | null;
  created_at?: string;
};

function safeStatusLabel(status?: string | null) {
  const s = String(status || "").trim();
  if (!s) return "Not submitted";
  switch (s) {
    case "submitted":
      return "Submitted (waiting for review)";
    case "pending_admin":
      return "Pending admin approval";
    case "approved":
      return "VERIFIED";
    case "rejected":
      return "REJECTED (check reason and re-submit)";
    default:
      return s;
  }
}

export default function PassengerVerifyPage() {
  // Auth/session + current request
  const [authUserPresent, setAuthUserPresent] = useState<boolean>(false);
  const [userId, setUserId] = useState<string>("");
  const [current, setCurrent] = useState<VerificationRecord | null>(null);

  // Form fields (must exist because JSX references them)
  const [fullName, setFullName] = useState<string>("");
  const [town, setTown] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [idType, setIdType] = useState<string>("");
  const [idNumber, setIdNumber] = useState<string>("");

  // Uploads or URL fallbacks
  const [idFile, setIdFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [idPhotoUrl, setIdPhotoUrl] = useState<string>("");
  const [selfieUrl, setSelfieUrl] = useState<string>("");

  // UX state
  const [message, setMessage] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);

  const statusText = useMemo(() => safeStatusLabel(current?.status), [current?.status]);

  async function loadSessionAndCurrent() {
    try {
      // 1) Session user (server reads cookie session)
      const sres = await fetch("/api/verify/session-user", { method: "GET" });
      const sj = await sres.json().catch(() => ({} as any));

      const uid = sj?.user_id ? String(sj.user_id) : "";
      if (uid) {
        setAuthUserPresent(true);
        setUserId(uid);
      } else {
        setAuthUserPresent(false);
      }

      // 2) Current verification request (Option B GET)
      const rres = await fetch("/api/public/passenger/verification/request", { method: "GET" });
      const rj = await rres.json().catch(() => ({} as any));

      // Accept common shapes without guessing beyond "request" / "data"
      const req = (rj && (rj.request || rj.data || rj.current || null)) as any;
      if (req && typeof req === "object") setCurrent(req as VerificationRecord);
      else setCurrent(null);
    } catch {
      // non-fatal
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await loadSessionAndCurrent();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage("");
    setSubmitting(true);

    try {
      // Build FormData for Option B API.
      const body = new FormData();

      // If your API ignores user_id and uses session cookie, this is harmless.
      // If your API supports dev/manual userId entry, this helps testing.
      if (userId) body.append("user_id", userId);

      if (fullName.trim()) body.append("full_name", fullName.trim());
      if (town.trim()) body.append("town", town.trim());
      if (phone.trim()) body.append("phone", phone.trim());
      if (idType.trim()) body.append("id_type", idType.trim());
      if (idNumber.trim()) body.append("id_number", idNumber.trim());

      // Prefer file uploads if provided; else send URL fallbacks if provided
      if (idFile) body.append("id_front", idFile);
      else if (idPhotoUrl.trim()) body.append("id_photo_url", idPhotoUrl.trim());

      if (selfieFile) body.append("selfie_with_id", selfieFile);
      else if (selfieUrl.trim()) body.append("selfie_photo_url", selfieUrl.trim());

      setMessage("Submitting verification...");

      const res = await fetch("/api/public/passenger/verification/request", {
        method: "POST",
        body
      });

      const txt = await res.text();

      if (!res.ok) {
        setMessage("Submit failed: " + txt);
        return;
      }

      setMessage("Submitted. Please wait for admin review.");

      // Refresh current status after submit
      await loadSessionAndCurrent();
    } catch (err: any) {
      setMessage("Submit error: " + (err?.message || String(err)));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-4 text-sm max-w-xl mx-auto">
      <h1 className="text-lg font-bold mb-2">Passenger Verification</h1>

      <p className="text-xs text-gray-600 mb-3">
        Upload your ID details so JRide can verify you. Verified passengers can book rides and access restricted services.
      </p>

      {!authUserPresent && (
        <div className="mb-3 text-xs text-orange-700">
          No logged-in user detected. For testing, you may paste a passenger <b>user UUID</b> below.
        </div>
      )}

      <div className="flex flex-col mb-3">
        <label className="text-xs mb-1">User ID (UUID)</label>
        <input
          className="border rounded px-2 py-1 text-xs font-mono"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="auto-filled when logged in"
        />
      </div>

      <div className="mb-4 text-xs">
        Current status: <b>{statusText}</b>
        {current?.status === "rejected" && current.reject_reason && (
          <div className="text-red-600 mt-1">Reason: {current.reject_reason}</div>
        )}
      </div>

      {message && <div className="mb-3 text-xs text-blue-700">{message}</div>}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex flex-col">
          <label className="text-xs mb-1">Full name (same as ID)</label>
          <input
            name="full_name"
            className="border rounded px-2 py-1 text-sm"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>

        <div className="flex flex-col">
          <label className="text-xs mb-1">Town</label>
          <input
            name="town"
            className="border rounded px-2 py-1 text-sm"
            value={town}
            onChange={(e) => setTown(e.target.value)}
            placeholder="e.g., Lagawe / Banaue / Hingyon"
          />
        </div>

        <div className="flex flex-col">
          <label className="text-xs mb-1">Mobile number</label>
          <input
            name="phone"
            className="border rounded px-2 py-1 text-sm"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="09xxxxxxxxx"
          />
        </div>

        <div className="flex flex-col">
          <label className="text-xs mb-1">ID type</label>
          <select
            name="id_type"
            className="border rounded px-2 py-1 text-sm"
            value={idType}
            onChange={(e) => setIdType(e.target.value)}
          >
            <option value="">Select ID type</option>
            <option value="National ID">National ID</option>
            <option value="Driver's License">Driver&apos;s License</option>
            <option value="Passport">Passport</option>
            <option value="UMID">UMID</option>
            <option value="Voter's ID">Voter&apos;s ID</option>
            <option value="Other">Other</option>
          </select>
        </div>

        <div className="flex flex-col">
          <label className="text-xs mb-1">ID number</label>
          <input
            name="id_number"
            className="border rounded px-2 py-1 text-sm"
            value={idNumber}
            onChange={(e) => setIdNumber(e.target.value)}
          />
        </div>

        <div className="flex flex-col">
          <label className="text-xs mb-1">ID photo (front of your ID)</label>
          <input
            name="id_front"
            type="file"
            accept="image/*"
            className="border rounded px-2 py-1 text-sm"
            onChange={(e) => setIdFile(e.target.files?.[0] ?? null)}
          />
          <input
            name="id_photo_url"
            className="border rounded px-2 py-1 text-xs mt-1"
            value={idPhotoUrl}
            onChange={(e) => setIdPhotoUrl(e.target.value)}
            placeholder="Or paste an existing image URL (optional)"
          />
        </div>

        <div className="flex flex-col">
          <label className="text-xs mb-1">Selfie photo (you holding your ID)</label>
          <input
            name="selfie_with_id"
            type="file"
            accept="image/*"
            className="border rounded px-2 py-1 text-sm"
            onChange={(e) => setSelfieFile(e.target.files?.[0] ?? null)}
          />
          <input
            name="selfie_photo_url"
            className="border rounded px-2 py-1 text-xs mt-1"
            value={selfieUrl}
            onChange={(e) => setSelfieUrl(e.target.value)}
            placeholder="Or paste an existing image URL (optional)"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 px-4 py-2 rounded bg-emerald-600 text-white text-sm disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Submit for verification"}
        </button>
      </form>
    </div>
  );
}
'@

# Write as UTF-8 (no BOM handling guarantee in PS5, but Set-Content -Encoding utf8 is best here)
Set-Content -LiteralPath $target -Value $content -Encoding UTF8
Write-Ok "[OK] Replaced: $target"
Write-Info "NOTE: This baseline uses ONLY /api/public/passenger/verification/request (GET+POST) and /api/verify/session-user (GET)."