# PATCH-JRIDE_PHASE7H3_INSERT_FORCE_BUTTONS_BY_LABEL.ps1
# Inserts Force start/end buttons right after the existing Start trip / Drop off buttons
# by locating the button label text and the next </button>.
# NO REGEX.

$ErrorActionPreference = "Stop"
function Fail($m){ throw "[FAIL] $m" }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$client = "app\admin\livetrips\LiveTripsClient.tsx"
if(!(Test-Path $client)){ Fail "Missing: $client (run from repo root)" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $client "$client.bak.$stamp" -Force
Ok "Backup: $client.bak.$stamp"

$txt = Get-Content $client -Raw

if($txt.IndexOf("async function forceTripStatus(") -lt 0){
  Fail "forceTripStatus() not found in LiveTripsClient.tsx. (We need that helper before adding buttons.)"
}

function InsertAfterButtonLabel([string]$src, [string]$label, [string]$insertion, [string]$alreadyNeedle) {
  if($src.IndexOf($alreadyNeedle) -ge 0){
    return @{ Text=$src; Changed=$false; Note="Already contains '$alreadyNeedle'"; }
  }

  $pLabel = $src.IndexOf($label)
  if($pLabel -lt 0){
    return @{ Text=$src; Changed=$false; Note="Label '$label' not found"; }
  }

  # Find the next closing </button> after the label
  $pClose = $src.IndexOf("</button>", $pLabel)
  if($pClose -lt 0){
    return @{ Text=$src; Changed=$false; Note="Could not find </button> after '$label'"; }
  }

  $insertPos = $pClose + "</button>".Length
  $newText = $src.Insert($insertPos, $insertion)
  return @{ Text=$newText; Changed=$true; Note="Inserted after '$label'"; }
}

# Buttons to insert (kept simple; uses t.* and forceTripStatus)
$forceStartBtn = @"

                            <button
                              className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                const code = (t as any).booking_code ?? (t as any).bookingCode;
                                if (!code) return;
                                forceTripStatus(String(code), "on_trip").catch((err) => setLastAction(String(err?.message || err)));
                              }}
                              title="Admin override: force on_trip"
                            >
                              Force start
                            </button>
"@

$forceEndBtn = @"

                            <button
                              className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                const code = (t as any).booking_code ?? (t as any).bookingCode;
                                if (!code) return;
                                forceTripStatus(String(code), "completed").catch((err) => setLastAction(String(err?.message || err)));
                              }}
                              title="Admin override: force completed"
                            >
                              Force end
                            </button>
"@

$changedAny = $false

$r1 = InsertAfterButtonLabel -src $txt -label "Start trip" -insertion $forceStartBtn -alreadyNeedle "Force start"
$txt = $r1.Text
if($r1.Changed){ Ok $r1.Note; $changedAny = $true } else { Ok $r1.Note }

$r2 = InsertAfterButtonLabel -src $txt -label "Drop off" -insertion $forceEndBtn -alreadyNeedle "Force end"
$txt = $r2.Text
if($r2.Changed){ Ok $r2.Note; $changedAny = $true } else { Ok $r2.Note }

if(-not $changedAny){
  Fail "No changes applied. This means either the labels are different (e.g. 'Start Trip', 'Dropoff') or buttons are rendered without those exact label texts."
}

Set-Content -LiteralPath $client -Value $txt -Encoding UTF8
Ok "Wrote: $client"
Ok "Phase 7H3 complete."
