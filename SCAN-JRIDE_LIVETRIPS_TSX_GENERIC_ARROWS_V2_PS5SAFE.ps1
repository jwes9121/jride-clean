<# 
SCAN-JRIDE_LIVETRIPS_TSX_GENERIC_ARROWS_V2_PS5SAFE.ps1

Finds TSX-poison generic arrow patterns in a .tsx file, like:
  const foo = <T,>(args) => {
  const foo = <T extends X>(args): Y => {
  let foo = <T>(args) => {

These often cause Next/TSX parse errors later at JSX return (<div>).

Outputs:
- Line number
- The header line
- A few lines of context

PS5-safe. ASCII-only script.
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$ProjRoot,

  [Parameter(Mandatory = $false)]
  [int]$Context = 2
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Info([string]$m) { Write-Host $m -ForegroundColor Cyan }
function Ok([string]$m)   { Write-Host $m -ForegroundColor Green }
function Warn([string]$m) { Write-Host $m -ForegroundColor Yellow }
function Fail([string]$m) { Write-Host $m -ForegroundColor Red; throw $m }

function Normalize-Path([string]$p) {
  try { return (Resolve-Path -LiteralPath $p).Path } catch { return $p }
}

function Read-TextUtf8NoBom([string]$path) {
  if (!(Test-Path -LiteralPath $path)) { Fail "File not found: $path" }
  $bytes = [System.IO.File]::ReadAllBytes($path)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $bytes = $bytes[3..($bytes.Length-1)]
  }
  return [System.Text.Encoding]::UTF8.GetString($bytes)
}

Info "== JRIDE LiveTrips: scan TSX generic arrow candidates (V2 / PS5-safe) =="

$ProjRoot = Normalize-Path $ProjRoot
$target = Normalize-Path (Join-Path $ProjRoot "app\admin\livetrips\LiveTripsClient.tsx")

Info ("Repo:   {0}" -f $ProjRoot)
Info ("Target: {0}" -f $target)
Info ""

$content = Read-TextUtf8NoBom $target
$lines = $content -split "`r`n|`n|`r", 0
$total = $lines.Count

# Heuristic match on a SINGLE LINE:
#  (const|let|var) NAME = <...>(... ) ... => {
# We only detect those whose header fits on one line (most common). 
$rx = New-Object System.Text.RegularExpressions.Regex(
  '^\s*(const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*<[^>]+>\s*\([^)]*\)\s*([^=]*?)=>\s*\{',
  [System.Text.RegularExpressions.RegexOptions]::Multiline
)

$hits = @()

for ($i = 1; $i -le $total; $i++) {
  $t = $lines[$i-1]
  if ($rx.IsMatch($t)) {
    $m = $rx.Match($t)
    $hits += [pscustomobject]@{
      Line = $i
      Kind = $m.Groups[1].Value
      Name = $m.Groups[2].Value
      Text = $t.TrimEnd()
    }
  }
}

if ($hits.Count -eq 0) {
  Ok "[OK] No single-line TSX generic-arrow headers found."
  Warn "If the poison header is multi-line, run the FIX script anyway (it scans multi-line headers too)."
} else {
  Warn ("[WARN] Found {0} TSX-generic-arrow header candidate(s):" -f $hits.Count)
  foreach ($h in $hits) {
    ""
    ("L{0}  {1} {2}" -f $h.Line, $h.Kind, $h.Name) | Write-Host
    ("  " + $h.Text) | Write-Host

    $from = [Math]::Max(1, $h.Line - $Context)
    $to   = [Math]::Min($total, $h.Line + $Context)
    for ($j = $from; $j -le $to; $j++) {
      if ($j -eq $h.Line) { continue }
      ("  {0,5} | {1}" -f $j, $lines[$j-1]) | Write-Host
    }
  }
}

Info ""
Info "Done."