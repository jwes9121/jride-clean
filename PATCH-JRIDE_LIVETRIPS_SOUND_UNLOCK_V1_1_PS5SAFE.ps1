param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

function EnsureDir([string]$p){
  if (!(Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

function WriteUtf8NoBom([string]$Path, [string]$Content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

if (!(Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }
$ProjRoot = (Resolve-Path -LiteralPath $ProjRoot).Path

Info "== JRIDE Patch: LiveTrips sound path + unlock + booking_code id fixes (V1.1 / PS5-safe) =="
Info "Root: $ProjRoot"

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bakDir = Join-Path $ProjRoot "_patch_bak"
EnsureDir $bakDir

# ---- 1) Ensure public\sounds\jride_audio.mp3 exists ----
$soundsDir = Join-Path $ProjRoot "public\sounds"
if (!(Test-Path -LiteralPath $soundsDir)) {
  Fail "[FAIL] Missing folder: $soundsDir"
}

$canonical = Join-Path $soundsDir "jride_audio.mp3"

if (!(Test-Path -LiteralPath $canonical)) {
  $mp3s = @(Get-ChildItem -LiteralPath $soundsDir -File -Filter "*.mp3" -ErrorAction SilentlyContinue)
  if ($mp3s.Length -lt 1) {
    Fail "[FAIL] No .mp3 found in $soundsDir. Put at least one mp3 there."
  }
  $src = $mp3s[0].FullName
  Copy-Item -LiteralPath $src -Destination $canonical -Force
  Ok "[OK] Created canonical sound: $canonical (copied from: $src)"
} else {
  Ok "[OK] Canonical sound exists: $canonical"
}

# ---- 2) Find the correct LiveTripsMap.tsx ----
$mapCandidates = @(Get-ChildItem -LiteralPath $ProjRoot -Recurse -File -Filter "LiveTripsMap.tsx" -ErrorAction SilentlyContinue)
$map = $null
foreach ($m in $mapCandidates) {
  $txt = Get-Content -LiteralPath $m.FullName -Raw -ErrorAction SilentlyContinue
  if ($txt -and $txt -match "Driver live overview" -and $txt -match "alertAudioRef") { $map = $m.FullName; break }
}
if (!$map) { Fail "[FAIL] Could not find the correct LiveTripsMap.tsx (expected Driver live overview + alertAudioRef)." }

Info "Target Map: $map"
$bak = Join-Path $bakDir ("LiveTripsMap.tsx.bak.SOUND_UNLOCK_V1_1.$ts")
Copy-Item -LiteralPath $map -Destination $bak -Force
Ok "Backup: $bak"

$src2 = Get-Content -LiteralPath $map -Raw -ErrorAction Stop

# ---- 3) Fix any old sound path references ----
$src2 = $src2 -replace '"/audio/jride_audio\.mp3"', '"/sounds/jride_audio.mp3"'
$src2 = $src2 -replace "'/audio/jride_audio\.mp3'", "'/sounds/jride_audio.mp3'"
$src2 = $src2 -replace 'src="/audio/jride_audio\.mp3"', 'src="/sounds/jride_audio.mp3"'
$src2 = $src2 -replace "src='/audio/jride_audio\.mp3'", "src='/sounds/jride_audio.mp3'"

# ---- 4) booking_code id fallbacks in this file ----
# raw.id ?? raw.bookingCode ?? i  -> include raw.booking_code
$src2 = $src2 -replace 'raw\.id\s*\?\?\s*raw\.bookingCode\s*\?\?\s*i', 'raw.id ?? raw.bookingCode ?? raw.booking_code ?? i'
# (t as any).id ?? (t as any).bookingCode ?? idx -> include booking_code
$src2 = $src2 -replace '\(t as any\)\.id\s*\?\?\s*\(t as any\)\.bookingCode\s*\?\?\s*idx', '(t as any).id ?? (t as any).bookingCode ?? (t as any).booking_code ?? idx'
# tRaw.id ?? tRaw.bookingCode ?? "" -> include booking_code
$src2 = $src2 -replace 'tRaw\.id\s*\?\?\s*tRaw\.bookingCode\s*\?\?\s*""', 'tRaw.id ?? tRaw.bookingCode ?? tRaw.booking_code ?? ""'
# String(tRaw.id ?? tRaw.bookingCode ?? "") -> include booking_code
$src2 = $src2 -replace 'String\(tRaw\.id\s*\?\?\s*tRaw\.bookingCode\s*\?\?\s*""\)', 'String(tRaw.id ?? tRaw.bookingCode ?? tRaw.booking_code ?? "")'
# String(t.id ?? t.bookingCode ?? "") -> include booking_code
$src2 = $src2 -replace 'String\(t\.id\s*\?\?\s*t\.bookingCode\s*\?\?\s*""\)', 'String(t.id ?? t.bookingCode ?? (t as any).booking_code ?? "")'
# String(selectedTrip.id ?? selectedTrip.bookingCode ?? "") -> include booking_code
$src2 = $src2 -replace 'String\(selectedTrip\.id\s*\?\?\s*selectedTrip\.bookingCode\s*\?\?\s*""\)', 'String(selectedTrip.id ?? selectedTrip.bookingCode ?? (selectedTrip as any).booking_code ?? "")'

# ---- 5) Inject sound unlock + soundEnabled (anchor: const alertAudioRef = useRef...) ----
if ($src2 -notmatch "JRIDE_SOUND_UNLOCK_BEGIN") {
  $patAlertRef = 'const\s+alertAudioRef\s*=\s*useRef<[^>]+>\(null\);\s*'
  if ($src2 -notmatch $patAlertRef) {
    Fail "[FAIL] Could not find alertAudioRef useRef(...) anchor in LiveTripsMap.tsx"
  }

  $inject = @'
const alertAudioRef = useRef<HTMLAudioElement | null>(null);

// ===== JRIDE_SOUND_UNLOCK_BEGIN =====
const [soundEnabled, setSoundEnabled] = useState(false);

// Unlock audio after the first user gesture (browser autoplay policy)
useEffect(() => {
  const unlock = () => {
    try {
      const a = alertAudioRef.current;
      if (!a) { setSoundEnabled(true); return; }
      const prevVol = a.volume;
      a.volume = 0;

      const p = a.play();
      if (p && typeof (p as any).then === "function") {
        (p as any).then(() => {
          try { a.pause(); a.currentTime = 0; } catch {}
          a.volume = prevVol;
          setSoundEnabled(true);
        }).catch(() => {
          a.volume = prevVol;
          setSoundEnabled(true);
        });
      } else {
        try { a.pause(); a.currentTime = 0; } catch {}
        a.volume = prevVol;
        setSoundEnabled(true);
      }
    } catch {
      setSoundEnabled(true);
    }
  };

  window.addEventListener("pointerdown", unlock, { once: true } as any);
  return () => {
    try { window.removeEventListener("pointerdown", unlock as any); } catch {}
  };
}, []);
// ===== JRIDE_SOUND_UNLOCK_END =====

'@

  $src2 = [System.Text.RegularExpressions.Regex]::Replace($src2, $patAlertRef, $inject, 1)
  Ok "[OK] Injected sound unlock + soundEnabled state (alertAudioRef)"
} else {
  Info "[SKIP] sound unlock block already present"
}

# ---- 6) Gate the actual play() call used by problem-trip alert ----
# Replace:
#   audio.currentTime = 0;
#   void audio.play();
# With guarded version.
$patPlayBlock = '(?s)audio\.currentTime\s*=\s*0\s*;\s*void\s+audio\.play\(\)\s*;'
if ($src2 -match $patPlayBlock) {
  $repPlayBlock = @'
audio.currentTime = 0;
        if (soundEnabled) {
          void audio.play();
        }
'@
  $src2 = [System.Text.RegularExpressions.Regex]::Replace($src2, $patPlayBlock, $repPlayBlock, 1)
  Ok "[OK] Gated alert audio play() behind soundEnabled"
} else {
  Info "[WARN] Could not locate exact audio.currentTime=0; void audio.play(); block to gate (file may already be modified)."
}

WriteUtf8NoBom -Path $map -Content $src2
Ok "[OK] Patched: $map"
Ok "[OK] Done."
