# PATCH-JRIDE_VENDOR_ORDERS_REMEMBER_VENDORID_CLEAN_URL.ps1
$ErrorActionPreference = "Stop"

function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function Fail($m){ throw $m }

$target = "app\vendor-orders\page.tsx"
if(!(Test-Path $target)){ Fail "Missing file: $target" }

$bak = "$target.bak.$(Stamp)"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$lines = Get-Content $target

# Find where vendorIdFromQuery is defined
$idxQ = -1
for($i=0; $i -lt $lines.Count; $i++){
  if($lines[$i] -match 'const\s+vendorIdFromQuery\s*=\s*String\('){
    $idxQ = $i
    break
  }
}
if($idxQ -lt 0){ Fail "Could not find const vendorIdFromQuery = String(searchParams?.get(""vendor_id"") ... )" }

# Prevent double insert if already applied
$already = $false
for($i=0; $i -lt $lines.Count; $i++){
  if($lines[$i] -match 'JRIDE_VENDOR_ID'){
    $already = $true
    break
  }
}
if($already){ Fail "JRIDE_VENDOR_ID already present in file (patch already applied?)" }

# Insert after vendorIdFromQuery line
$insert = @(
'  // PHASE15_VENDORID_REMEMBER: store vendor_id once then keep URL clean (/vendor-orders)',
'  const [vendorId, setVendorId] = useState<string>("");',
'',
'  useEffect(() => {',
'    try {',
'      if (typeof window === "undefined") return;',
'      const fromQuery = String(vendorIdFromQuery || "").trim();',
'      const stored = String(window.localStorage.getItem("JRIDE_VENDOR_ID") || "").trim();',
'      const resolved = (fromQuery || stored).trim();',
'',
'      if (fromQuery) {',
'        window.localStorage.setItem("JRIDE_VENDOR_ID", fromQuery);',
'        // Clean the page URL (do not keep vendor_id in address bar)',
'        try {',
'          const clean = window.location.pathname;',
'          window.history.replaceState({}, "", clean);',
'        } catch {}',
'      }',
'',
'      setVendorId(resolved);',
'    } catch {',
'      setVendorId(String(vendorIdFromQuery || "").trim());',
'    }',
'    // eslint-disable-next-line react-hooks/exhaustive-deps',
'  }, [vendorIdFromQuery]);',
''
)

$before = $lines[0..$idxQ]
$after  = @()
if($idxQ+1 -le $lines.Count-1){ $after = $lines[($idxQ+1)..($lines.Count-1)] }
$lines = @($before + $insert + $after)

Write-Host "[OK] Inserted vendorId localStorage + clean URL effect" -ForegroundColor Green

# Replace vendorIdFromQuery checks/usage inside loadOrders
for($i=0; $i -lt $lines.Count; $i++){
  if($lines[$i] -match 'if\s*\(\s*!\s*vendorIdFromQuery\s*\)'){
    $lines[$i] = '      if (!vendorId) {'
    # Next line should be throw; replace message to instruct one-time setup
    if($i+1 -lt $lines.Count -and $lines[$i+1] -match 'throw\s+new\s+Error'){
      $lines[$i+1] = '        throw new Error("vendor_id_required: open /vendor-orders?vendor_id=YOUR_VENDOR_UUID once, then it will be remembered and the URL will be cleaned.");'
    }
    Write-Host "[OK] Updated vendorId required check" -ForegroundColor Green
    break
  }
}

# Replace fetch URL vendorIdFromQuery -> vendorId
$replacedFetch = $false
for($i=0; $i -lt $lines.Count; $i++){
  if($lines[$i] -match 'fetch\(\"\/api\/vendor-orders\?vendor_id=\"\s*\+\s*encodeURIComponent\(vendorIdFromQuery\)'){
    $lines[$i] = $lines[$i] -replace 'encodeURIComponent\(vendorIdFromQuery\)', 'encodeURIComponent(vendorId)'
    $replacedFetch = $true
    break
  }
  if($lines[$i] -match '\/api\/vendor-orders\?vendor_id=\"\s*\+\s*encodeURIComponent\(vendorIdFromQuery\)'){
    $lines[$i] = $lines[$i] -replace 'encodeURIComponent\(vendorIdFromQuery\)', 'encodeURIComponent(vendorId)'
    $replacedFetch = $true
    break
  }
}
if($replacedFetch){
  Write-Host "[OK] Updated API fetch to use vendorId (resolved)" -ForegroundColor Green
} else {
  Write-Host "[WARN] Could not find fetch(...) line using vendorIdFromQuery (skipped)" -ForegroundColor Yellow
}

# Write UTF-8 NO BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllBytes((Resolve-Path $target), $utf8NoBom.GetBytes(($lines -join "`r`n")))
Write-Host "[OK] Wrote UTF-8 no BOM" -ForegroundColor Green
Write-Host "[OK] Patched: $target" -ForegroundColor Green
