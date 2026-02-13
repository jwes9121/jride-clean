# PATCH-JRIDE_PASSENGER_UI_PHASE_P1_STATUS_CLARITY_V6_FORCE_TOPLEVEL_HELPERS_MARKED.ps1
# Fix: force PHASE P1 helpers into TOP-LEVEL module scope (even if same names exist in inner scopes)
# UI_ONLY / NO_BACKEND_CHANGES / NO_NEW_APIS / NO_MAPBOX_CHANGES
# Patches ONLY: app\ride\page.tsx

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

function Read-Utf8NoBom($path){
  if(!(Test-Path $path)){ Fail "Missing file: $path" }
  [System.IO.File]::ReadAllText($path, [System.Text.UTF8Encoding]::new($false))
}
function Write-Utf8NoBom($path,$text){
  [System.IO.File]::WriteAllText($path,$text,[System.Text.UTF8Encoding]::new($false))
}
function Backup-File($path){
  $ts=(Get-Date).ToString("yyyyMMdd_HHmmss")
  $bak="$path.bak.$ts"
  Copy-Item -Force $path $bak
  Write-Host "[OK] Backup: $bak"
}

$root = (Get-Location).Path
$ride = Join-Path $root "app\ride\page.tsx"
if(!(Test-Path $ride)){ Fail "Not found: $ride" }

Backup-File $ride
$r = Read-Utf8NoBom $ride

$marker = "/* ===== PHASE P1 TOPLEVEL HELPERS (AUTO) ===== */"
if($r.IndexOf($marker) -ge 0){
  Write-Host "[OK] Top-level helpers marker already present (skip)"
  Write-Utf8NoBom $ride $r
  Write-Host "[OK] Wrote: $ride"
  Write-Host "[NEXT] npm.cmd run build"
  exit 0
}

# Find insertion point: after imports (or after 'use client' if no imports)
$useClientPos = $r.IndexOf('"use client"')
if($useClientPos -lt 0){ $useClientPos = $r.IndexOf("'use client'") }

$scanLimit = [Math]::Min($r.Length, 6000)
$head = $r.Substring(0, $scanLimit)

$lastImportPos = $head.LastIndexOf("import ")
if($lastImportPos -lt 0){
  if($useClientPos -ge 0){
    $lineEnd = $r.IndexOf("`n", $useClientPos)
    if($lineEnd -lt 0){ $lineEnd = $useClientPos + 12 }
    $insertPos = $lineEnd + 1
  } else {
    $insertPos = 0
  }
} else {
  $afterLastImportLine = $head.IndexOf("`n", $lastImportPos)
  if($afterLastImportLine -lt 0){ $afterLastImportLine = $lastImportPos }
  $doubleNl = $head.IndexOf("`n`n", $afterLastImportLine)
  if($doubleNl -lt 0){
    $insertPos = $afterLastImportLine + 1
  } else {
    $insertPos = $doubleNl + 2
  }
}

$helpers = @'
/* ===== PHASE P1 TOPLEVEL HELPERS (AUTO) ===== */
const P1_STATUS_STEPS = ["requested", "assigned", "on_the_way", "arrived", "on_trip", "completed"] as const;

function p1NormStatus(s: any): string {
  return String(s || "").trim().toLowerCase();
}

function p1StatusIndex(st: string): number {
  const s = p1NormStatus(st);
  if (s === "cancelled") return -2;
  const idx = (P1_STATUS_STEPS as any).indexOf(s);
  return idx;
}

function p1NowMessage(stRaw: any): string {
  const st = p1NormStatus(stRaw);
  if (st === "requested") return "We’re looking for a nearby driver.";
  if (st === "assigned") return "A driver has accepted your request.";
  if (st === "on_the_way") return "Driver is heading to your pickup point.";
  if (st === "arrived") return "Driver has arrived. Please proceed.";
  if (st === "on_trip") return "You’re on the way to your destination.";
  if (st === "completed") return "Trip completed. Thank you for riding!";
  if (st === "cancelled") return "This trip was cancelled.";
  return "We’re updating your trip status. Please wait.";
}

function p1WaitHint(stRaw: any): string {
  const st = p1NormStatus(stRaw);
  if (!st || st === "requested") return "Most pickups take a few minutes. Please wait while we assign a driver.";
  if (st === "assigned") return "Driver assignment is confirmed. Please prepare at your pickup point.";
  return "";
}

function p1IsNonCancellable(stRaw: any): boolean {
  const st = p1NormStatus(stRaw);
  return st === "on_the_way" || st === "arrived" || st === "on_trip";
}

function p1FriendlyError(raw: any): string {
  const t = String(raw || "").trim();
  const u = t.toUpperCase();
  if (!t) return "";
  if (u.indexOf("CAN_BOOK_BLOCKED") >= 0) return "Booking is temporarily unavailable.";
  if (u.indexOf("GEO_BLOCKED") >= 0) return "Booking is restricted outside the service area.";
  if (u.indexOf("BOOKING_POLL_FAILED") >= 0 || u.indexOf("BOOKING_POLL_ERROR") >= 0) return "We’re having trouble updating trip status.";
  if (u.indexOf("CAN_BOOK_INFO_FAILED") >= 0 || u.indexOf("CAN_BOOK_INFO_ERROR") >= 0) return "We’re having trouble loading booking eligibility.";
  if (u.indexOf("BOOK_FAILED") >= 0) return "Booking failed. Please try again.";
  return "";
}

function p1RenderStepper(stRaw: any) {
  const st = p1NormStatus(stRaw);
  const idx = p1StatusIndex(st);

  if (st === "cancelled") {
    return (
      <div className="mt-3">
        <span className="inline-flex items-center rounded-full bg-red-600 text-white px-3 py-1 text-xs font-semibold">
          Cancelled
        </span>
      </div>
    );
  }

  const cur = idx;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        {P1_STATUS_STEPS.map((s, i) => {
          const done = cur >= 0 && i < cur;
          const now = cur >= 0 && i === cur;

          const bubble =
            "inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold " +
            (now ? "bg-blue-600 text-white" : done ? "bg-black/70 text-white" : "bg-slate-200 text-slate-700");

          const label =
            "text-[11px] " +
            (now ? "font-semibold" : done ? "opacity-80" : "opacity-50");

          const pretty =
            s === "on_the_way" ? "On the way" :
            s === "on_trip" ? "On trip" :
            (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, " ");

          return (
            <div key={s} className="flex items-center gap-2">
              <div className={bubble}>{i + 1}</div>
              <div className={label}>{pretty}</div>
              {i < P1_STATUS_STEPS.length - 1 ? (
                <div className={"w-6 h-[2px] " + (done ? "bg-black/40" : "bg-black/10")} />
              ) : null}
            </div>
          );
        })}
      </div>

      {cur < 0 ? (
        <div className="mt-2 text-xs opacity-70">
          Status: <span className="font-mono">{st || "(loading)"}</span>
        </div>
      ) : null}
    </div>
  );
}
/* ===== END PHASE P1 TOPLEVEL HELPERS (AUTO) ===== */

'@

$r = $r.Substring(0, $insertPos) + $helpers + "`n" + $r.Substring($insertPos)

Write-Utf8NoBom $ride $r
Write-Host "[OK] Inserted TOP-LEVEL PHASE P1 helpers (marker-based)"
Write-Host "[OK] Wrote: $ride"
Write-Host ""
Write-Host "[NEXT] Run:"
Write-Host "  npm.cmd run build"
