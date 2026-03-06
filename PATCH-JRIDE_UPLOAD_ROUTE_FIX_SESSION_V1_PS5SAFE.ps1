# JRIDE PATCH
# Fix upload route authentication (NextAuth v5)

param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference="Stop"

$target = Join-Path $ProjRoot "app\api\public\passenger\verification\upload\route.ts"

if (!(Test-Path $target)) {
  throw "upload route not found"
}

$bak = "$target.bak.$(Get-Date -Format yyyyMMdd_HHmmss)"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup created: $bak"

$content = Get-Content $target -Raw

# Ensure auth import
if ($content -notmatch 'from "@/auth"') {
  $content = 'import { auth } from "@/auth";' + "`n" + $content
}

# Replace session extraction
$content = $content -replace 'const\s+session\s*=\s*await\s*getServerSession\([^\)]*\);', 'const session = await auth();'
$content = $content -replace 'const\s+session\s*=\s*await\s*auth\([^\)]*\);', 'const session = await auth();'

Set-Content -Path $target -Value $content -Encoding UTF8

Write-Host "[OK] Upload route patched."