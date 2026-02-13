# PATCH-JRIDE_PHASE6I_STATUS_LIFECYCLE_FIX_V4_SAFE.ps1
# Safe string Replace only (no regex). ASCII only.

$ErrorActionPreference = "Stop"

function Timestamp() { Get-Date -Format "yyyyMMdd_HHmmss" }
function BackupFile($p) {
  if (Test-Path $p) {
    $bak = "$p.bak.$(Timestamp)"
    Copy-Item $p $bak -Force
    Write-Host "[OK] Backup: $bak"
  }
}
function WriteUtf8NoBom($path, $content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}
function Fail($m){ throw $m }

$target = "app\api\dispatch\status\route.ts"
if (!(Test-Path $target)) { Fail "Missing: $target" }

BackupFile $target
$txt = Get-Content $target -Raw

# 1) Replace norm() exactly (from your paste)
$oldNorm = @'
function norm(v: any) {
  return String(v ?? "").trim().toLowerCase();
}
'@

$newNorm = @'
function norm(v: any) {
  let s = String(v ?? "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/[\s\-]+/g, "_");
  if (s === "new") return "requested";
  if (s === "ongoing") return "on_trip";
  return s;
}
'@

if ($txt.Contains($oldNorm)) {
  $txt = $txt.Replace($oldNorm, $newNorm)
  Write-Host "[OK] Updated norm()"
} else {
  Write-Host "[WARN] norm() exact block not found; skipping norm patch."
}

# 2) Insert GET inspector before POST (only if missing)
if ($txt -notmatch "export\s+async\s+function\s+GET\s*\(") {
  $anchor = "export async function POST(req: Request) {"
  $idx = $txt.IndexOf($anchor)
  if ($idx -lt 0) { Fail "POST anchor not found: $anchor" }

  $getBlock = @'
export async function GET(req: Request) {
  const supabase = createClient();
  try {
    const url = new URL(req.url);
    const bookingId = url.searchParams.get("booking_id") || url.searchParams.get("id");
    const bookingCode = url.searchParams.get("booking_code") || url.searchParams.get("code");

    const bk = await fetchBooking(supabase, bookingId ?? null, bookingCode ?? null);
    if (!bk.data) {
      return NextResponse.json(
        { ok: false, code: "BOOKING_NOT_FOUND", message: bk.error || "Booking not found", booking_id: bookingId ?? null, booking_code: bookingCode ?? null },
        { status: 404 }
      );
    }

    const booking: any = bk.data;
    const cur = norm(booking.status) || "requested";
    const allowedNext = NEXT[cur] ?? [];
    const hasDriver = !!booking.driver_id;

    return NextResponse.json({
      ok: true,
      booking_id: String(booking.id),
      booking_code: booking.booking_code ?? null,
      current_status: cur,
      has_driver: hasDriver,
      allowed_next: allowedNext,
      booking
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, code: "SERVER_ERROR", message: e?.message || "Unknown error" }, { status: 500 });
  }
}

'@

  $txt = $txt.Substring(0,$idx) + $getBlock + $txt.Substring($idx)
  Write-Host "[OK] Inserted GET inspector"
} else {
  Write-Host "[OK] GET inspector already present"
}

# 3) Patch fetchBooking call to accept body.id alias
$oldFetch = 'const bk = await fetchBooking(supabase, body.booking_id ?? null, body.booking_code ?? null);'
$newFetch = 'const bk = await fetchBooking(supabase, (body.booking_id ?? (body as any).id ?? null), body.booking_code ?? null);'

if ($txt.Contains($oldFetch)) {
  $txt = $txt.Replace($oldFetch, $newFetch)
  Write-Host "[OK] Added body.id alias"
} else {
  Write-Host "[WARN] fetchBooking call exact line not found; skipping alias patch."
}

# 4) Enhance NO_DRIVER 409 payload (exact block replace)
$oldNoDriver = @'
  if (!hasDriver && target !== "requested" && target !== "cancelled") {
    return NextResponse.json(
      { ok: false, code: "NO_DRIVER", message: "Cannot set status without driver_id", current_status: booking.status ?? null },
      { status: 409 }
    );
  }
'@

$newNoDriver = @'
  if (!hasDriver && target !== "requested" && target !== "cancelled") {
    return NextResponse.json(
      {
        ok: false,
        code: "NO_DRIVER",
        message: "Cannot set status without driver_id",
        booking_id: String(booking.id),
        booking_code: booking.booking_code ?? null,
        current_status: cur,
        target_status: target,
        has_driver: hasDriver,
        allowed_next: NEXT[cur] ?? [],
        current_status_raw: booking.status ?? null
      },
      { status: 409 }
    );
  }
'@

if ($txt.Contains($oldNoDriver)) {
  $txt = $txt.Replace($oldNoDriver, $newNoDriver)
  Write-Host "[OK] Enhanced NO_DRIVER payload"
} else {
  Write-Host "[WARN] NO_DRIVER block exact match not found; skipping."
}

# 5) Enhance INVALID_TRANSITION 409 payload (exact block replace)
$oldBad = @'
  if (!allowedNext.includes(target)) {
    return NextResponse.json(
      { ok: false, code: "INVALID_TRANSITION", message: `Cannot transition ${cur} -> ${target}`, allowed_next: allowedNext },
      { status: 409 }
    );
  }
'@

$newBad = @'
  if (!allowedNext.includes(target)) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_TRANSITION",
        message: `Cannot transition ${cur} -> ${target}`,
        booking_id: String(booking.id),
        booking_code: booking.booking_code ?? null,
        current_status: cur,
        target_status: target,
        has_driver: hasDriver,
        allowed_next: allowedNext
      },
      { status: 409 }
    );
  }
'@

if ($txt.Contains($oldBad)) {
  $txt = $txt.Replace($oldBad, $newBad)
  Write-Host "[OK] Enhanced INVALID_TRANSITION payload"
} else {
  Write-Host "[WARN] INVALID_TRANSITION block exact match not found; skipping."
}

WriteUtf8NoBom $target $txt
Write-Host "[OK] Patched: $target"
Write-Host "[NEXT] Build: npm.cmd run build"
