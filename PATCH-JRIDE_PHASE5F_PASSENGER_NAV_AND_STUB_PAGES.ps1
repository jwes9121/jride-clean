# PATCH-JRIDE_PHASE5F_PASSENGER_NAV_AND_STUB_PAGES.ps1
# Purpose:
# - Fix "blank pages" by creating real stub pages for /ride, /takeout, /errand
# - Ensure passenger dashboard navigates to those routes
# - ASCII-safe (no mojibake characters)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Fail($m){ throw $m }

$root = Get-Location

$targets = @(
  "app\passenger\page.tsx",
  "app\ride\page.tsx",
  "app\takeout\page.tsx",
  "app\errand\page.tsx"
)

# Ensure folders exist
@("app\passenger","app\ride","app\takeout","app\errand") | ForEach-Object {
  if (!(Test-Path $_)) { New-Item -ItemType Directory -Path $_ | Out-Null }
}

# Backup existing files if they exist
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
foreach($p in $targets){
  if(Test-Path $p){
    Copy-Item $p "$p.bak.$stamp" -Force
    Ok "[OK] Backup: $p.bak.$stamp"
  }
}

# 1) Passenger dashboard page (real nav)
$passengerPage = @'
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function PassengerDashboardPage() {
  const router = useRouter();
  const [choice, setChoice] = React.useState<"ride" | "takeout" | "errand">("ride");

  function go() {
    if (choice === "ride") router.push("/ride");
    if (choice === "takeout") router.push("/takeout");
    if (choice === "errand") router.push("/errand");
  }

  function Card(props: { id: "ride" | "takeout" | "errand"; title: string; desc: string }) {
    const active = choice === props.id;
    return (
      <button
        type="button"
        onClick={() => setChoice(props.id)}
        className={
          "text-left rounded-xl border px-4 py-3 transition " +
          (active ? "border-blue-500 bg-blue-500/10" : "border-black/10 bg-white hover:bg-black/5")
        }
      >
        <div className="font-semibold">{props.title}</div>
        <div className="text-sm opacity-70">{props.desc}</div>
      </button>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-white">
      <div className="w-full max-w-2xl rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold mb-1">Passenger Dashboard</h1>
        <p className="text-sm opacity-70 mb-5">Choose what you want to do.</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card id="ride" title="Book Ride" desc="Go to ride booking" />
          <Card id="takeout" title="Takeout" desc="Food delivery (pilot)" />
          <Card id="errand" title="Errands" desc="Pabili / padala (pilot)" />
        </div>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={go}
            className="rounded-xl bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 font-semibold"
          >
            Continue
          </button>

          <button
            type="button"
            onClick={() => router.push("/passenger-login")}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-5 py-2 font-semibold"
            title="Use this if you want to switch accounts"
          >
            Switch Account
          </button>
        </div>

        <div className="mt-4 text-xs opacity-70">
          Note: Next step is to connect verification + night rules (8PM-5AM).
        </div>
      </div>
    </main>
  );
}
'@

Set-Content -Path "app\passenger\page.tsx" -Value $passengerPage -Encoding utf8
Ok "[OK] Wrote: app\passenger\page.tsx"

# 2) Stub pages so they are not blank

$ridePage = @'
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function RidePage() {
  const router = useRouter();

  return (
    <main className="min-h-screen p-6 bg-white">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold">My Rides</h1>
        <p className="mt-2 text-sm opacity-70">
          This is a pilot stub page. Next step: booking form + live trip tracking.
        </p>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => router.push("/passenger")}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-5 py-2 font-semibold"
          >
            Back to Passenger Dashboard
          </button>
        </div>
      </div>
    </main>
  );
}
'@

$takeoutPage = @'
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function TakeoutPage() {
  const router = useRouter();

  return (
    <main className="min-h-screen p-6 bg-white">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold">Takeout (Pilot)</h1>
        <p className="mt-2 text-sm opacity-70">
          This is a pilot stub page. Next step: vendor list + cart + checkout.
        </p>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => router.push("/passenger")}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-5 py-2 font-semibold"
          >
            Back to Passenger Dashboard
          </button>
        </div>
      </div>
    </main>
  );
}
'@

$errandPage = @'
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function ErrandPage() {
  const router = useRouter();

  return (
    <main className="min-h-screen p-6 bg-white">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold">Errand Dashboard</h1>
        <p className="mt-2 text-sm opacity-70">
          This is a pilot stub page. Next step: create errand request + pricing + assignment.
        </p>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => router.push("/passenger")}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-5 py-2 font-semibold"
          >
            Back to Passenger Dashboard
          </button>
        </div>
      </div>
    </main>
  );
}
'@

Set-Content -Path "app\ride\page.tsx" -Value $ridePage -Encoding utf8
Ok "[OK] Wrote: app\ride\page.tsx"

Set-Content -Path "app\takeout\page.tsx" -Value $takeoutPage -Encoding utf8
Ok "[OK] Wrote: app\takeout\page.tsx"

Set-Content -Path "app\errand\page.tsx" -Value $errandPage -Encoding utf8
Ok "[OK] Wrote: app\errand\page.tsx"

Ok "`n[DONE] Phase 5F passenger nav + stub pages are in place."
Info "Next: npm run build, commit, push, vercel deploy."
