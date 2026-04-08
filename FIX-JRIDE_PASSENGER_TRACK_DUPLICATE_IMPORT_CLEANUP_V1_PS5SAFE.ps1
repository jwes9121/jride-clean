param(
  [Parameter(Mandatory=$true)]
  [string]$WebRoot
)

$ErrorActionPreference = "Stop"

function Backup-File {
  param([string]$Path)

  $dir = Split-Path -Parent $Path
  $bakDir = Join-Path $dir "_patch_bak"
  if (!(Test-Path $bakDir)) {
    New-Item -Path $bakDir -ItemType Directory | Out-Null
  }

  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $leaf = Split-Path $Path -Leaf
  $bak = Join-Path $bakDir ($leaf + ".PASSENGER_TRACK_DUP_IMPORT_CLEANUP_V1." + $stamp + ".bak")
  Copy-Item $Path $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Write-Utf8NoBom {
  param(
    [string]$Path,
    [string]$Content
  )
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $enc)
}

function Cleanup-TrackFile {
  param([string]$Path)

  if (!(Test-Path $Path)) {
    throw "File not found: $Path"
  }

  Backup-File $Path

  $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8

  # Normalize duplicate createSupabaseClient imports down to exactly one.
  $lines = Get-Content -LiteralPath $Path -Encoding UTF8
  $out = New-Object System.Collections.Generic.List[string]
  $seenCreateSupabaseImport = $false

  foreach ($line in $lines) {
    if ($line -match '^\s*import\s+\{\s*createClient\s+as\s+createSupabaseClient\s*\}\s+from\s+["'']@supabase/supabase-js["''];?\s*$') {
      if (-not $seenCreateSupabaseImport) {
        $out.Add('import { createClient as createSupabaseClient } from "@supabase/supabase-js";')
        $seenCreateSupabaseImport = $true
      }
    } else {
      $out.Add($line)
    }
  }

  if (-not $seenCreateSupabaseImport) {
    # Insert after next/server import if possible, else prepend.
    $inserted = $false
    for ($i = 0; $i -lt $out.Count; $i++) {
      if ($out[$i] -match '^\s*import\s+\{[^}]*NextRequest[^}]*NextResponse[^}]*\}\s+from\s+["'']next/server["''];?\s*$') {
        $out.Insert($i + 1, 'import { createClient as createSupabaseClient } from "@supabase/supabase-js";')
        $inserted = $true
        break
      }
    }
    if (-not $inserted) {
      $out.Insert(0, 'import { createClient as createSupabaseClient } from "@supabase/supabase-js";')
    }
  }

  $updated = [string]::Join("`r`n", $out)

  # Safety: ensure no getUser(bearer) remains.
  $updated = [regex]::Replace($updated, 'auth\.getUser\s*\(\s*bearer\s*\)', 'auth.getUser()')

  Write-Utf8NoBom -Path $Path -Content $updated
  Write-Host "[OK] Cleaned: $Path"
}

$route1 = Join-Path $WebRoot "app\api\passenger\track\route.ts"
$route2 = Join-Path $WebRoot "app\api\passenger\track\track_route.ts"

Cleanup-TrackFile -Path $route1
Cleanup-TrackFile -Path $route2

Write-Host ""
Write-Host "=== VERIFY ==="
Select-String -Path $route1, $route2 -Pattern 'createClient as createSupabaseClient|getUser\(bearer\)|Authorization: `Bearer `${bearer}|auth.getUser\(\)' -CaseSensitive:$false

Write-Host ""
Write-Host "[DONE] Duplicate import removed and bearer-auth track files normalized."