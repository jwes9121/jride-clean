param(
  [Parameter(Mandatory=$true)]
  [string]$WebRoot,

  [Parameter(Mandatory=$true)]
  [string]$AndroidRoot
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

function Backup-File([string]$path, [string]$tag){
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$path.bak.$tag.$ts"
  Copy-Item -LiteralPath $path -Destination $bak -Force | Out-Null
  Ok ("Backup: " + $bak)
}

function Read-Text([string]$path){
  return Get-Content -LiteralPath $path -Raw -Encoding UTF8
}

function Write-Text([string]$path, [string]$text){
  # write UTF8 with CRLF
  $out = $text -replace "`n","`r`n"
  Set-Content -LiteralPath $path -Value $out -Encoding UTF8
}

Info "== PATCH JRIDE: Unify Android lifecycle + fare to /api/dispatch/status (V2 ROBUST / PS5-safe) =="

$web = (Resolve-Path -LiteralPath $WebRoot).Path
$and = (Resolve-Path -LiteralPath $AndroidRoot).Path
Info ("WebRoot:     " + $web)
Info ("AndroidRoot: " + $and)

# ---------------- WEB ----------------
$webFile = Join-Path $web "app\api\dispatch\status\route.ts"
if (-not (Test-Path -LiteralPath $webFile)) { throw "Missing web file: $webFile" }

Info ("WEB target: " + $webFile)
Backup-File $webFile "UNIFY_DISPATCH_STATUS_V2"

$src = Read-Text $webFile
$srcN = $src -replace "`r`n","`n"

if ($srcN -notmatch 'export\s+async\s+function\s+POST\s*\(') {
  throw "Safety failed: POST handler not found in dispatch/status route.ts"
}

# Extract POST block roughly (from POST to next export or EOF)
$idxPost = $srcN.IndexOf("export async function POST")
if ($idxPost -lt 0) { throw "Safety failed: cannot locate POST index" }

$tail = $srcN.Substring($idxPost)
$nextExport = [regex]::Match($tail, "(?m)^\s*export\s+(async\s+)?function\s+(GET|PUT|DELETE)\b")
$cutLen = $tail.Length
if ($nextExport.Success) { $cutLen = $nextExport.Index }
$postBlock = $tail.Substring(0, $cutLen)

# Count req.json occurrences inside POST
$matches = [regex]::Matches($postBlock, "\breq\.json\s*\(")
$cnt = $matches.Count
Info ("WEB: req.json() occurrences inside POST: " + $cnt)

# Ensure there is a single rawBody read. If none, add one at start of POST body.
if ($postBlock -notmatch '\bconst\s+rawBody\s*=') {
  # Insert right after opening "{"
  $mOpen = [regex]::Match($postBlock, "export\s+async\s+function\s+POST\s*\([^\)]*\)\s*\{")
  if (-not $mOpen.Success) { throw "Could not locate POST opening brace to insert rawBody." }

  $insertAt = $mOpen.Index + $mOpen.Length
  $ins = "`n  const rawBody = (await req.json().catch(() => ({}))) as any;`n"
  $postBlock = $postBlock.Insert($insertAt, $ins)
  $cnt = ([regex]::Matches($postBlock, "\breq\.json\s*\(")).Count
  Info ("WEB: inserted rawBody; req.json occurrences now: " + $cnt)
}

# Now enforce: only one req.json in POST.
# Strategy:
# - Keep the first req.json occurrence that is part of rawBody assignment.
# - Replace any OTHER "await req.json(...)" / "req.json(...)" inside POST with "rawBody".
# This avoids brittle block matching.
#
# 1) Identify the rawBody assignment line and protect it.
$lines = $postBlock.Split("`n")
$protectedLineIdx = -1
for ($i=0; $i -lt $lines.Length; $i++) {
  if ($lines[$i] -match '\bconst\s+rawBody\s*=\s*\(await\s+req\.json') { $protectedLineIdx = $i; break }
  if ($lines[$i] -match '\bconst\s+rawBody\s*=\s*await\s+req\.json') { $protectedLineIdx = $i; break }
}
if ($protectedLineIdx -lt 0) { throw "Safety failed: rawBody assignment not found after insertion." }

# 2) Replace other req.json() usage lines (conservative: line-level)
for ($i=0; $i -lt $lines.Length; $i++) {
  if ($i -eq $protectedLineIdx) { continue }

  if ($lines[$i] -match '\breq\.json\s*\(') {
    # Replace whole expression patterns with rawBody.
    $lines[$i] = $lines[$i] -replace 'await\s+req\.json\s*\(\)\.catch\([^\)]*\)', 'rawBody'
    $lines[$i] = $lines[$i] -replace 'await\s+req\.json\s*\(\)', 'rawBody'
    $lines[$i] = $lines[$i] -replace 'req\.json\s*\(\)', 'rawBody'
    # If still contains req.json( (complex), neutralize to rawBody
    if ($lines[$i] -match '\breq\.json\s*\(') {
      $lines[$i] = "  // [PATCH V2] Removed extra req.json() call (was causing body to be read twice). Use rawBody instead."
    }
  }
}

$postBlockPatched = ($lines -join "`n")

# Inject action->status mapping if the original has "const status = rawBody?.status ?? null;"
if ($postBlockPatched -match 'const\s+status\s*=\s*rawBody\?\.(status)\s*\?\?\s*null;') {
  $postBlockPatched = [regex]::Replace(
    $postBlockPatched,
    "(?m)^\s*const status = rawBody\?\.(status) \?\? null;\s*$",
@'
  const actionRaw = (rawBody?.action ?? rawBody?.key ?? null);
  const action = (actionRaw ? String(actionRaw).trim().toLowerCase() : null);

  const mapActionToStatus = (a: string | null): string | null => {
    if (!a) return null;
    if (a === "on_the_way") return "on_the_way";
    if (a === "arrived") return "arrived";
    if (a === "start_trip") return "on_trip";
    if (a === "complete_trip") return "completed";
    if (a === "cancel_trip") return "cancelled";
    if (a === "accept_fare") return "accepted";
    if (a === "fare_proposed" || a === "propose_fare") return "fare_proposed";
    return null;
  };

  let status: any = (rawBody?.status ?? null);
  if (!status && action) status = mapActionToStatus(action);
'@,
    1
  )
  Ok "WEB: Added Android action->status mapping."
} else {
  Warn "WEB: Did not find exact 'const status = rawBody?.status ?? null;' line. Skipping action->status injection."
}

# Write back web file by replacing original POST block region
$head = $srcN.Substring(0, $idxPost)
$rest = $srcN.Substring($idxPost + $cutLen)
$finalWeb = $head + $postBlockPatched + $rest

Write-Text $webFile $finalWeb
Ok "WEB patched: POST now reads JSON once (rawBody) and extra req.json() calls removed."

# ---------------- ANDROID ----------------
$andFile = Join-Path $and "app\src\main\java\com\jride\app\MainActivity.kt"
if (-not (Test-Path -LiteralPath $andFile)) { throw "Missing android file: $andFile" }

Info ("ANDROID target: " + $andFile)
Backup-File $andFile "UNIFY_DISPATCH_STATUS_V2"

$a = Read-Text $andFile

if ($a -notmatch "/api/driver/trip-lifecycle") { throw "Safety failed: /api/driver/trip-lifecycle not found in MainActivity.kt" }
if ($a -notmatch "/api/driver/fare-offer") { throw "Safety failed: /api/driver/fare-offer not found in MainActivity.kt" }

$a2 = $a -replace "/api/driver/trip-lifecycle", "/api/dispatch/status"
$a2 = $a2 -replace "/api/driver/fare-offer", "/api/dispatch/status"

# Ensure lifecycle payload has status mapped (inject right after action put)
$anchor = '_payload.put("action", _key)'
if ($a2.IndexOf($anchor) -lt 0) { throw "Safety failed: could not find lifecycle payload action line." }

$inject = @'
                _payload.put("action", _key)

                // Map known actions to server booking status
                val mappedStatus = when (_key) {
                    "on_the_way" -> "on_the_way"
                    "arrived" -> "arrived"
                    "start_trip" -> "on_trip"
                    "complete_trip" -> "completed"
                    "cancel_trip" -> "cancelled"
                    "accept_fare" -> "accepted"
                    "propose_fare" -> "fare_proposed"
                    else -> null
                }
                if (mappedStatus != null) _payload.put("status", mappedStatus)
'@

$a2 = $a2 -replace [regex]::Escape($anchor), $inject

# Ensure fare proposal includes status=fare_proposed
if ($a2 -notmatch 'put\("proposed_fare", totalFare\)') {
  throw "Safety failed: proposed_fare payload not found (put(""proposed_fare"", totalFare))."
}
$a2 = $a2 -replace 'put\("proposed_fare", totalFare\)', 'put("status", "fare_proposed")' + "`r`n" + '                        put("proposed_fare", totalFare)'

Write-Text $andFile ($a2 -replace "`r`n","`n")
Ok "ANDROID patched: lifecycle + fare proposal now post to /api/dispatch/status with status mapping."

Ok "DONE."