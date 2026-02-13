# PATCH-JRIDE_PASSENGER_NAME_AUTOFILL_OPTIONAL_V1C_DEFINE_STATE.ps1
# Fix compile: ensure passengerNameAuto state + autofill effect exist at component scope.
# Target: C:\Users\jwes9\Desktop\jride-clean-fresh\app\ride\page.tsx
# PowerShell 5.1 safe, ASCII-only, UTF-8 no BOM

$ErrorActionPreference = "Stop"

$ROOT = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$FILE = Join-Path $ROOT "app\ride\page.tsx"
if (!(Test-Path $FILE)) { throw "Missing file: $FILE" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$FILE.bak.$ts"
Copy-Item $FILE $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content -LiteralPath $FILE -Raw

if ($txt -match "JRIDE_PASSENGER_NAME_AUTOFILL_OPTIONAL_V1C_DEFINE_STATE_APPLIED") {
  Write-Host "[SKIP] Already applied."
  exit 0
}

# IMPORTANT: check DECLARATION, not usage
$declPattern = '(?m)^\s*const\s*\[\s*passengerNameAuto\s*,\s*setPassengerNameAuto\s*\]\s*=\s*(?:React\.)?useState'
$hasDecl = [regex]::IsMatch($txt, $declPattern)

if ($hasDecl) {
  Write-Host "[OK] passengerNameAuto declaration already exists. (No change)"
} else {
  # Find passengerName state line (any initializer)
  $pState = '(?m)^\s*const\s*\[\s*passengerName\s*,\s*setPassengerName\s*\]\s*=\s*(?:React\.)?useState(?:<[^>]+>)?\([^;]*\)\s*;\s*$'
  $m = [regex]::Match($txt, $pState)
  if (!$m.Success) {
    throw "Could not find passengerName state line: const [passengerName, setPassengerName] = useState(...);"
  }

  $insert = @'
const [passengerNameAuto, setPassengerNameAuto] = React.useState<string>("");

// UI-only: auto-fill passenger name from logged-in session (if available)
React.useEffect(() => {
  let cancelled = false;

  async function loadName() {
    try {
      const r = await fetch("/api/public/auth/session", { method: "GET" });
      const j: any = await r.json().catch(() => null);

      const nm =
        String(
          j?.user?.name ??
          j?.user?.full_name ??
          j?.profile?.full_name ??
          j?.profile?.name ??
          j?.name ??
          ""
        ).trim();

      if (!cancelled && nm) {
        setPassengerNameAuto(nm);
        setPassengerName((prev) => {
          const p = String(prev || "").trim();
          if (p && p.toLowerCase() !== "test passenger a") return p;
          return nm;
        });
      }
    } catch {
      // ignore (optional autofill only)
    }
  }

  loadName();
  return () => { cancelled = true; };
}, []);

'@

  # Insert immediately after passengerName state line
  $txt2 = [regex]::Replace(
    $txt,
    $pState,
    [System.Text.RegularExpressions.MatchEvaluator]{
      param($mm)
      return ($mm.Value + "`r`n" + $insert)
    },
    1
  )

  if ($txt2 -eq $txt) { throw "Insertion failed - file unchanged." }
  $txt = $txt2
  Write-Host "[OK] Inserted passengerNameAuto state + autofill effect after passengerName state."
}

# Mark + write UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$txt = $txt + "`r`n/* JRIDE_PASSENGER_NAME_AUTOFILL_OPTIONAL_V1C_DEFINE_STATE_APPLIED */`r`n"
[System.IO.File]::WriteAllText($FILE, $txt, $utf8NoBom)

Write-Host "[OK] Patched: $FILE"
Write-Host ""
Write-Host "[NEXT] Build:"
Write-Host "  Set-Location `"$ROOT`""
Write-Host "  npm.cmd run build"
