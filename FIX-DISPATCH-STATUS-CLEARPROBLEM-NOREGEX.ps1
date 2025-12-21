# FIX-DISPATCH-STATUS-CLEARPROBLEM-NOREGEX.ps1
$ErrorActionPreference = "Stop"

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$path = Join-Path $root "app\api\dispatch\status\route.ts"
if (-not (Test-Path $path)) { throw "File not found: $path" }

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$path.bak-$ts"
Copy-Item $path $bak -Force
Write-Host "Backup: $bak" -ForegroundColor Yellow

$s = Get-Content $path -Raw

if ($s -match "JRIDE_CLEAR_PROBLEM_ON_FINISH") {
  Write-Host "Already patched (JRIDE_CLEAR_PROBLEM_ON_FINISH found). Nothing to do." -ForegroundColor Green
  exit 0
}

$needle = "return NextResponse.json("
$idx = $s.LastIndexOf($needle)
if ($idx -lt 0) { throw "Could not find '$needle' in route.ts to anchor insertion." }

# Find indentation of the line containing the return
$lineStart = $s.LastIndexOf("`n", $idx)
if ($lineStart -lt 0) { $lineStart = 0 } else { $lineStart = $lineStart + 1 }
$linePrefix = $s.Substring($lineStart, $idx - $lineStart)
$indent = ""
if ($linePrefix -match '^\s+') { $indent = $Matches[0] }

$patch = @"
$indent// JRIDE_CLEAR_PROBLEM_ON_FINISH
$indent// When finishing a trip, try to clear problem/stuck flags without assuming columns exist.
$indentif (toStatus === "completed" || toStatus === "cancelled") {
$indent  const tryClear = async (payload: any) => {
$indent    try {
$indent      const r = await supabase.from("bookings").update(payload).eq("booking_code", bookingCode);
$indent      const e: any = (r as any)?.error;
$indent      if (e) {
$indent        const msg = String(e?.message || "").toLowerCase();
$indent        const code = String(e?.code || "");
$indent        const missingCol = code === "42703" || (msg.includes("column") && msg.includes("does not exist"));
$indent        if (!missingCol) throw e;
$indent      }
$indent    } catch (e: any) {
$indent      const msg = String(e?.message || "").toLowerCase();
$indent      const code = String(e?.code || "");
$indent      const missingCol = code === "42703" || (msg.includes("column") && msg.includes("does not exist"));
$indent      if (!missingCol) throw e;
$indent    }
$indent  };
$indent
$indent  // Common snake_case
$indent  await tryClear({ is_problem: false });
$indent  await tryClear({ problem_reason: null });
$indent  await tryClear({ problem_at: null });
$indent
$indent  // Common camelCase
$indent  await tryClear({ isProblem: false });
$indent  await tryClear({ problemReason: null });
$indent  await tryClear({ problemAt: null });
$indent}
"@

$s2 = $s.Insert($idx, $patch + "`r`n")
Set-Content -Path $path -Value $s2 -Encoding UTF8

Write-Host "Patched: $path" -ForegroundColor Green
Write-Host "Restart your dev server (Ctrl+C then npm run dev) and test completing a PROBLEM trip." -ForegroundColor Cyan
