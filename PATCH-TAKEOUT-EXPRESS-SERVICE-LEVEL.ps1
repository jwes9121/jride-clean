# ================================
# PATCH: TAKEOUT REGULAR vs EXPRESS
# ================================
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }

$root = Get-Location
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "_backup_takeout_express_$stamp"
New-Item -ItemType Directory -Path $backup | Out-Null

$files = @(
  "app\takeout\orders\page.tsx",
  "app\takeout\orders\[bookingCode]\page.tsx",
  "app\takeout\orders\[bookingCode]\receipt\page.tsx",
  "app\api\rides\create\route.ts",
  "app\api\rides\fare\route.ts",
  "app\api\rides\fare-response\route.ts"
)

foreach ($f in $files) {
  if (-not (Test-Path $f)) { Fail "Missing $f" }
  Copy-Item $f "$backup\$($f.Replace('\','_'))"
}

Write-Host "[OK] Backup created at $backup" -ForegroundColor Green

# ------------------------------------------------
# 1) UI: add service level selector (Regular/Express)
# ------------------------------------------------
$ui = "app\takeout\orders\page.tsx"
$txt = Get-Content $ui -Raw

if ($txt -notmatch "takeout_service_level") {
  $insert = @'
  const [serviceLevel, setServiceLevel] = useState<"regular" | "express">("regular");
'@

  $txt = $txt -replace "(useState<.*?>\()", "`$1`n$insert"

  $txt = $txt -replace "const payload = \{", @'
const payload = {
  takeout_service_level: serviceLevel,
'@
}

Set-Content $ui $txt -Encoding UTF8
Write-Host "[OK] UI selector wired" -ForegroundColor Green

# ----------------------------------------
# 2) API create: persist service level
# ----------------------------------------
$create = "app\api\rides\create\route.ts"
$txt = Get-Content $create -Raw

if ($txt -notmatch "takeout_service_level") {
  $txt = $txt -replace "const booking = \{", @'
const booking = {
  takeout_service_level: body.takeout_service_level ?? "regular",
'@
}

Set-Content $create $txt -Encoding UTF8
Write-Host "[OK] booking.create persistence added" -ForegroundColor Green

# ----------------------------------------
# 3) Fare logic: min fare override only
# ----------------------------------------
$fare = "app\api\rides\fare\route.ts"
$txt = Get-Content $fare -Raw

if ($txt -notmatch "takeout_service_level") {
  $inject = @'
  if (trip.trip_type === "takeout") {
    const level = trip.takeout_service_level ?? "regular";
    const minFare = level === "express" ? 55 : 70;
    const companyCut = level === "express" ? 15 : 20;

    if (fare < minFare) fare = minFare;
    out.company_cut_amount = companyCut;
  }
'@

  $txt = $txt -replace "return out;", "$inject`nreturn out;"
}

Set-Content $fare $txt -Encoding UTF8
Write-Host "[OK] Fare override applied" -ForegroundColor Green

# ----------------------------------------
# 4) Fare response passthrough
# ----------------------------------------
$resp = "app\api\rides\fare-response\route.ts"
$txt = Get-Content $resp -Raw

if ($txt -notmatch "takeout_service_level") {
  $txt = $txt -replace "fare:", "fare:`n    takeout_service_level:"
}

Set-Content $resp $txt -Encoding UTF8
Write-Host "[OK] Fare response extended" -ForegroundColor Green

# ----------------------------------------
# 5) Receipt + details label
# ----------------------------------------
$labelFiles = @(
  "app\takeout\orders\[bookingCode]\page.tsx",
  "app\takeout\orders\[bookingCode]\receipt\page.tsx"
)

foreach ($f in $labelFiles) {
  $txt = Get-Content $f -Raw
  if ($txt -notmatch "Takeout \\(") {
    $txt = $txt -replace "Takeout", 'Takeout (${order.takeout_service_level === "express" ? "Express" : "Regular"})'
    Set-Content $f $txt -Encoding UTF8
  }
}

Write-Host "[OK] Labels updated" -ForegroundColor Green

Write-Host "`n[DONE] TAKEOUT REGULAR vs EXPRESS PATCH COMPLETE" -ForegroundColor Cyan
