param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot,

  [Parameter(Mandatory=$false)]
  [string]$Tag = "JRIDE_LIFECYCLE_LOGGING_LOCKDOWN_GREEN_V1"
)

$ErrorActionPreference = "Stop"

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

Write-Host "== RESTORE dispatch/status route.ts from tag (V1 / PS5-safe) =="
Write-Host "Repo: $ProjRoot"
Write-Host "Tag:  $Tag"

Push-Location $ProjRoot

try {
  # Sanity: ensure git exists + tag exists
  $null = & git --version
  $tags = & git tag
  if ($tags -notcontains $Tag) {
    throw "Tag not found: $Tag`nAvailable tags:`n$($tags -join "`n")"
  }

  $rel = "app/api/dispatch/status/route.ts"

  # Restore the file from tag (this overwrites the corrupted file)
  & git checkout $Tag -- $rel
  if ($LASTEXITCODE -ne 0) { throw "git checkout failed restoring $rel from $Tag" }

  $path = Join-Path $ProjRoot $rel
  if (!(Test-Path $path)) { throw "Restored file missing: $path" }

  # Read + strip BOM if any
  $src = Get-Content -Raw -LiteralPath $path
  if ($src.Length -gt 0 -and [int]$src[0] -eq 0xFEFF) { $src = $src.Substring(1) }

  # Patch: accept both x-jride-admin-secret and x-admin-secret (safe, minimal)
  $src2 = $src -replace 'const\s+gotSecret\s*=\s*String\(req\.headers\.get\("x-jride-admin-secret"\)\s*\|\|\s*""\)\.trim\(\)\s*;',
                       'const gotSecret = String(req.headers.get("x-jride-admin-secret") || req.headers.get("x-admin-secret") || "").trim();'

  Write-Utf8NoBom -Path $path -Content $src2

  # Quick corruption check: first line must not contain garbage
  $firstLine = (Get-Content -LiteralPath $path -TotalCount 1)
  if ($firstLine -match 'm\{NxR\}|SRq=|k_\?:\|;') {
    throw "File still looks corrupted after restore. First line: $firstLine"
  }

  Write-Host "[OK] Restored + patched: $rel"
  Write-Host ""
  Write-Host "[NEXT] Build:"
  Write-Host "  npm.cmd run build"
}
finally {
  Pop-Location
}
