param(
  [string]$WebRoot = "."
)

$ErrorActionPreference = "Stop"

function Backup-File {
  param([string]$PathValue)

  $dir = Split-Path $PathValue
  $bakDir = Join-Path $dir "_patch_bak"
  if (!(Test-Path $bakDir)) {
    New-Item -ItemType Directory -Path $bakDir | Out-Null
  }

  $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $bakPath = Join-Path $bakDir ("page.tsx.bak.UNDO_FORCE_RENDER_" + $timestamp)
  Copy-Item $PathValue $bakPath -Force
  Write-Host "[OK] Backup created: $bakPath" -ForegroundColor Green
}

$target = Join-Path $WebRoot "app\ride\page.tsx"

if (!(Test-Path $target)) {
  throw "ABORT: target file not found: $target"
}

Backup-File -PathValue $target

$replacement = @'
"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "jride_active_booking_code";

function getStoredCode() {
  if (typeof window === "undefined") return "";
  try {
    return String(localStorage.getItem(STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

function setStoredCode(code: string) {
  if (typeof window === "undefined") return;
  try {
    if (code) localStorage.setItem(STORAGE_KEY, code);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function readUrlCode() {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  return String(
    url.searchParams.get("code") ||
    url.searchParams.get("booking_code") ||
    ""
  ).trim();
}

export default function RidePage() {
  const [input, setInput] = useState("");
  const [activeCode, setActiveCode] = useState("");

  useEffect(() => {
    const urlCode = readUrlCode();
    if (urlCode) {
      setInput(urlCode);
      setActiveCode(urlCode);
      setStoredCode(urlCode);
      return;
    }

    const stored = getStoredCode();
    if (stored) {
      setInput(stored);
      setActiveCode(stored);
    }
  }, []);

  function handleTrack() {
    const code = input.trim();
    if (!code) return;

    setActiveCode(code);
    setStoredCode(code);
  }

  function handleClear() {
    setInput("");
    setActiveCode("");
    setStoredCode("");
  }

  return (
    <div className="mx-auto max-w-2xl p-4 space-y-4">
      <div className="rounded-xl border border-black/10 bg-white p-4">
        <div className="text-sm font-semibold">Track Booking</div>

        <input
          className="mt-2 w-full rounded-lg border border-black/10 px-3 py-2"
          placeholder="Enter booking code"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />

        <div className="mt-3 flex gap-2">
          <button
            onClick={handleTrack}
            className="rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white"
          >
            Track
          </button>

          <button
            onClick={handleClear}
            className="rounded-lg border border-black/10 px-3 py-2 text-sm"
          >
            Clear
          </button>
        </div>
      </div>

      {activeCode && (
        <iframe
          key={activeCode}
          src={`/ride/track?code=${encodeURIComponent(activeCode)}`}
          className="h-[600px] w-full rounded-xl border border-black/10"
          title="JRide Tracking"
        />
      )}
    </div>
  );
}
'@

Set-Content -Path $target -Value $replacement -Encoding UTF8

Write-Host ""
Write-Host "[SUCCESS] Restored app\ride\page.tsx to safe conditional render state." -ForegroundColor Cyan