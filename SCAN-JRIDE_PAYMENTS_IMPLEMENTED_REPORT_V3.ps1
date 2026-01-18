# SCAN-JRIDE_PAYMENTS_IMPLEMENTED_REPORT_V3.ps1
# Read-only scan: searches codebase for payment providers, webhooks, payouts, wallet topup/cashout, env/config hints.
# Produces a report folder with text + JSON. No repo changes.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info($m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host "[OK]   $m" -ForegroundColor Green }
function Write-Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m)       { throw $m }

# --- Repo root detection ---
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = $scriptDir
if (-not (Test-Path (Join-Path $root "package.json"))) { $root = (Get-Location).Path }

# --- Output folder ---
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$outDir = Join-Path $root ("_payments_scan_report_" + $ts)
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$reportTxt  = Join-Path $outDir "payments_implementation_report.txt"
$reportJson = Join-Path $outDir "payments_implementation_report.json"

Write-Info "Repo root: $root"
Write-Info "Output:   $outDir"

# --- Scope ---
$excludeDirs = @("\node_modules\","\ .next\","\dist\","\build\","\out\","\ .git\","\coverage\","\ .turbo\","\ .vercel\")
# Fix accidental spaces if any (defensive)
$excludeDirs = @($excludeDirs | ForEach-Object { $_.Replace(" ", "") })

$includeExt = @(
  "*.ts","*.tsx","*.js","*.jsx","*.mjs","*.cjs",
  "*.json","*.env","*.env.*","*.md","*.sql","*.prisma","*.yml","*.yaml","*.txt"
)

function Get-RepoFiles {
  param([string]$base)
  $all = Get-ChildItem -Path $base -Recurse -File -ErrorAction SilentlyContinue
  $kept = New-Object System.Collections.ArrayList
  foreach ($f in @($all)) {
    $full = $f.FullName
    $skip = $false
    foreach ($x in $excludeDirs) {
      if ($full -like ("*" + $x + "*")) { $skip = $true; break }
    }
    if ($skip) { continue }

    $ok = $false
    foreach ($ext in $includeExt) {
      if ($f.Name -like $ext) { $ok = $true; break }
    }
    if (-not $ok) { continue }

    [void]$kept.Add($f)
  }
  return ,$kept.ToArray()
}

function Read-FileText {
  param([string]$path)
  try { return Get-Content -Path $path -Raw -ErrorAction Stop } catch { return $null }
}

function Find-Matches {
  param(
    [System.IO.FileInfo[]]$repoFiles,
    [string[]]$terms
  )

  $out = New-Object System.Collections.ArrayList
  $termsLower = @($terms | ForEach-Object { $_.ToLowerInvariant() })

  foreach ($f in @($repoFiles)) {
    $txt = Read-FileText -path $f.FullName
    if ($null -eq $txt -or $txt.Length -eq 0) { continue }

    $lower = $txt.ToLowerInvariant()

    # prefilter
    $hit = $false
    foreach ($t in $termsLower) {
      if ($lower.Contains($t)) { $hit = $true; break }
    }
    if (-not $hit) { continue }

    $lines = $txt -split "`r?`n"
    for ($i=0; $i -lt $lines.Length; $i++) {
      $ln = $lines[$i]
      $lnLower = $ln.ToLowerInvariant()
      $matched = New-Object System.Collections.ArrayList

      for ($k=0; $k -lt $termsLower.Length; $k++) {
        if ($lnLower.Contains($termsLower[$k])) {
          [void]$matched.Add($terms[$k])
        }
      }

      if ($matched.Count -gt 0) {
        $obj = [pscustomobject]@{
          file  = $f.FullName
          rel   = $f.FullName.Substring($root.Length).TrimStart("\","/")
          line  = ($i + 1)
          terms = @($matched | Select-Object -Unique)
          text  = $ln.Trim()
        }
        [void]$out.Add($obj)
      }
    }
  }

  return ,$out.ToArray()
}

function Group-ByFileSummary {
  param([object[]]$hits)
  $hits = @($hits)
  if ($hits.Count -eq 0) { return @() }

  $byFile = $hits | Group-Object -Property rel | Sort-Object Count -Descending
  $summary = New-Object System.Collections.ArrayList

  foreach ($g in @($byFile)) {
    $sample = @($g.Group | Select-Object -First 5)
    $terms = @($g.Group | ForEach-Object { $_.terms } | ForEach-Object { $_ } | Select-Object -Unique)

    $obj = [pscustomobject]@{
      file = $g.Name
      hits = $g.Count
      terms = $terms
      sample_lines = @($sample | ForEach-Object { ("L" + $_.line + ": " + $_.text) })
    }
    [void]$summary.Add($obj)
  }

  return ,$summary.ToArray()
}

# --- Patterns ---
$providerPatterns = @(
  "gcash","g-cash","g cash",
  "paymongo","pay mongo",
  "xendit",
  "dragonpay","dragon pay",
  "maya","paymaya","pay maya",
  "grabpay","grab pay",
  "stripe",
  "paypal","pay pal",
  "adyen","braintree","razorpay",
  "checkout","payment intent","payment_intent",
  "webhook","callback","signature","hmac",
  "payout","withdraw","cashout","cash-out","disburse","transfer",
  "topup","top-up","cashin","cash-in","load wallet","load_wallet",
  "wallet","wallet_transactions","driver_wallet","vendor_wallet",
  "billing","invoice","merchant","api key","secret key","client secret"
)

$envPatterns = @(
  "GCASH","PAYMONGO","XENDIT","DRAGONPAY","MAYA","PAYMAYA","GRABPAY",
  "STRIPE","PAYPAL","ADYEN","BRAINTREE",
  "WEBHOOK","CHECKOUT","PAYMENT","PAYOUT","DISBURSE","TRANSFER","WALLET"
)

$routePatterns = @(
  "\/api\/",
  "export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(",
  "NextResponse",
  "Request\)"
)

# --- Scan ---
$files = Get-RepoFiles -base $root
if (@($files).Count -eq 0) { Fail "No scannable files found under $root" }
Write-Info ("Scanning " + @($files).Count + " files...")

$providerHits = Find-Matches -repoFiles $files -terms $providerPatterns

$envFiles = @($files | Where-Object { $_.Name -like ".env*" -or $_.FullName -match "\\vercel\.json$" -or $_.Name -like "next.config.*" })
$envHitsA = @()
if ($envFiles.Count -gt 0) { $envHitsA = Find-Matches -repoFiles $envFiles -terms $envPatterns }

# Also catch code references like process.env.XENDIT...
$envHitsB = Find-Matches -repoFiles $files -terms (@($envPatterns | ForEach-Object { $_.ToLowerInvariant() }))

$routeCandidateHits = Find-Matches -repoFiles $files -terms @("checkout","webhook","callback","payout","withdraw","cashout","cashin","topup","wallet","payment")
$apiRouteFiles = @(
  $routeCandidateHits |
    Select-Object -ExpandProperty file -Unique |
    Where-Object { $_ -match "\\app\\api\\" -or $_ -match "\\pages\\api\\" } |
    ForEach-Object { Get-Item $_ -ErrorAction SilentlyContinue } |
    Where-Object { $_ -ne $null }
)

$apiRouteMeta = @()
foreach ($rf in $apiRouteFiles) {
  $t = Read-FileText $rf.FullName
  if ($null -eq $t) { continue }
  $tl = $t.ToLowerInvariant()
  $apiRouteMeta += [pscustomobject]@{
    file = $rf.FullName
    rel  = $rf.FullName.Substring($root.Length).TrimStart("\","/")
    hasApiPathSignal = [bool]($t -match ($routePatterns -join "|"))
    hasWebhookWord   = [bool]($tl.Contains("webhook"))
    hasCheckoutWord  = [bool]($tl.Contains("checkout"))
    hasPayoutWord    = [bool]($tl.Contains("payout") -or $tl.Contains("withdraw") -or $tl.Contains("cashout"))
    hasWalletWord    = [bool]($tl.Contains("wallet"))
  }
}

$sqlFiles = @($files | Where-Object { $_.Extension -in @(".sql",".prisma") -or $_.Name -like "*migration*" })
$sqlHits = @()
if ($sqlFiles.Count -gt 0) {
  $sqlHits = Find-Matches -repoFiles $sqlFiles -terms @("wallet","transactions","payout","withdraw","cashout","cashin","topup","gcash","paymongo","xendit","dragonpay","stripe")
}

# --- Summaries ---
$providerByFile = Group-ByFileSummary -hits $providerHits
$sqlByFile      = Group-ByFileSummary -hits $sqlHits
$envByFileA     = Group-ByFileSummary -hits $envHitsA
$envByFileB     = Group-ByFileSummary -hits $envHitsB
$routeByFile    = Group-ByFileSummary -hits $routeCandidateHits

# --- Write TXT ---
$sb = New-Object System.Text.StringBuilder
$null = $sb.AppendLine("JRIDE PAYMENTS IMPLEMENTATION SCAN REPORT")
$null = $sb.AppendLine("Generated: " + (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"))
$null = $sb.AppendLine("Repo root:  " + $root)
$null = $sb.AppendLine("")
$null = $sb.AppendLine("=== 1) Provider / Payment Keywords Found ===")

if (@($providerByFile).Count -eq 0) {
  $null = $sb.AppendLine("No obvious provider/payment keywords found.")
} else {
  foreach ($s in @($providerByFile)) {
    $null = $sb.AppendLine("")
    $null = $sb.AppendLine("- " + $s.file + "  (hits=" + $s.hits + ")")
    $null = $sb.AppendLine("  terms: " + (@($s.terms) -join ", "))
    foreach ($ln in @($s.sample_lines)) { $null = $sb.AppendLine("  " + $ln) }
  }
}

$null = $sb.AppendLine("")
$null = $sb.AppendLine("=== 2) API Route Candidates (payments/wallet/webhooks) ===")
if (@($apiRouteMeta).Count -eq 0) {
  $null = $sb.AppendLine("No app/api or pages/api files matched payment-like terms.")
} else {
  foreach ($r in @($apiRouteMeta | Sort-Object rel)) {
    $null = $sb.AppendLine("- " + $r.rel)
    $null = $sb.AppendLine("    signals: api=" + $r.hasApiPathSignal + " webhook=" + $r.hasWebhookWord + " checkout=" + $r.hasCheckoutWord + " payout=" + $r.hasPayoutWord + " wallet=" + $r.hasWalletWord)
  }
}

$null = $sb.AppendLine("")
$null = $sb.AppendLine("=== 3) Env / Config Hints ===")
$null = $sb.AppendLine("3A) .env* / vercel.json / next.config.*")
if (@($envByFileA).Count -eq 0) {
  $null = $sb.AppendLine("No env hints found in env/config files.")
} else {
  foreach ($s in @($envByFileA)) {
    $null = $sb.AppendLine("")
    $null = $sb.AppendLine("- " + $s.file + "  (hits=" + $s.hits + ")")
    $null = $sb.AppendLine("  terms: " + (@($s.terms) -join ", "))
    foreach ($ln in @($s.sample_lines)) { $null = $sb.AppendLine("  " + $ln) }
  }
}

$null = $sb.AppendLine("")
$null = $sb.AppendLine("3B) code references (process.env, etc.)")
if (@($envByFileB).Count -eq 0) {
  $null = $sb.AppendLine("No env-term references found in code.")
} else {
  foreach ($s in @($envByFileB | Select-Object -First 25)) {
    $null = $sb.AppendLine("")
    $null = $sb.AppendLine("- " + $s.file + "  (hits=" + $s.hits + ")")
    $null = $sb.AppendLine("  terms: " + (@($s.terms) -join ", "))
    foreach ($ln in @($s.sample_lines)) { $null = $sb.AppendLine("  " + $ln) }
  }
  if (@($envByFileB).Count -gt 25) {
    $null = $sb.AppendLine("")
    $null = $sb.AppendLine("... (truncated env/code section to first 25 files in TXT report; see JSON for full)")
  }
}

$null = $sb.AppendLine("")
$null = $sb.AppendLine("=== 4) SQL / DB (wallet/transactions/payout) Hints ===")
if (@($sqlByFile).Count -eq 0) {
  $null = $sb.AppendLine("No SQL/prisma hints found.")
} else {
  foreach ($s in @($sqlByFile | Select-Object -First 25)) {
    $null = $sb.AppendLine("")
    $null = $sb.AppendLine("- " + $s.file + "  (hits=" + $s.hits + ")")
    $null = $sb.AppendLine("  terms: " + (@($s.terms) -join ", "))
    foreach ($ln in @($s.sample_lines)) { $null = $sb.AppendLine("  " + $ln) }
  }
  if (@($sqlByFile).Count -gt 25) {
    $null = $sb.AppendLine("")
    $null = $sb.AppendLine("... (truncated SQL section to first 25 files in TXT report; see JSON for full)")
  }
}

$null = $sb.AppendLine("")
$null = $sb.AppendLine("=== 5) Quick Interpretation Guide ===")
$null = $sb.AppendLine("- Provider names + webhook/checkout routes => some payment integration likely exists.")
$null = $sb.AppendLine("- Only wallet tables/functions but no provider/webhook => wallet is likely internal + cash-in/out is manual/admin-driven.")
$null = $sb.AppendLine("- Payout/withdraw endpoints + provider calls => drivers/vendors can likely cash out via that provider.")
$null = $sb.AppendLine("")
$null = $sb.AppendLine("End of report.")

[System.IO.File]::WriteAllText($reportTxt, $sb.ToString(), [System.Text.Encoding]::UTF8)
Write-Ok "Wrote TXT report: $reportTxt"

# --- Write JSON ---
$payload = [pscustomobject]@{
  generated_at = (Get-Date).ToString("o")
  repo_root = $root
  output_dir = $outDir
  counts = [pscustomobject]@{
    scanned_files = @($files).Count
    provider_hits = @($providerHits).Count
    route_candidate_hits = @($routeCandidateHits).Count
    api_route_files = @($apiRouteMeta).Count
    env_hits_envfiles = @($envHitsA).Count
    env_hits_code = @($envHitsB).Count
    sql_hits = @($sqlHits).Count
  }
  summaries = [pscustomobject]@{
    provider_by_file = $providerByFile
    routes_by_file = $routeByFile
    env_by_file_envfiles = $envByFileA
    env_by_file_code = $envByFileB
    sql_by_file = $sqlByFile
    api_route_meta = $apiRouteMeta
  }
  raw_hits = [pscustomobject]@{
    provider_hits = $providerHits
    route_candidate_hits = $routeCandidateHits
    env_hits_envfiles = $envHitsA
    env_hits_code = $envHitsB
    sql_hits = $sqlHits
  }
}

$payload | ConvertTo-Json -Depth 12 | Set-Content -Path $reportJson -Encoding UTF8
Write-Ok "Wrote JSON report: $reportJson"

Write-Host ""
Write-Ok "DONE. Open:"
Write-Host "  $reportTxt"
Write-Host "  $reportJson"
