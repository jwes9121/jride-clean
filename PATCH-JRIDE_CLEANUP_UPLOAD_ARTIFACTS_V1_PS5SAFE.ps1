param(
  [string]$RepoRoot="."
)

$ErrorActionPreference="Stop"
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

$root = Resolve-Path $RepoRoot

$gitignore = Join-Path $root ".gitignore"
if (-not (Test-Path $gitignore)) { New-Item -ItemType File -Path $gitignore | Out-Null }

$gi = Get-Content -LiteralPath $gitignore -Raw

$add = @"
# JRIDE local debug upload artifacts
UPLOAD_*.ts
UPLOAD_*.zip
UPLOAD_*.txt
UPLOAD_*.md
_patch_bak/
"@

if ($gi -notmatch [regex]::Escape("UPLOAD_*.ts")) {
  Add-Content -LiteralPath $gitignore -Value "`r`n$add" -Encoding UTF8
  Ok "[OK] Added UPLOAD_* + _patch_bak ignores to .gitignore"
} else {
  Ok "[OK] .gitignore already contains UPLOAD_* ignore rules"
}

# Delete local artifact files (safe)
Get-ChildItem -LiteralPath $root -File -Filter "UPLOAD_*" -ErrorAction SilentlyContinue | ForEach-Object {
  Remove-Item -LiteralPath $_.FullName -Force
  Ok ("[OK] Deleted: {0}" -f $_.Name)
}

# Also remove any accidentally tracked UPLOAD_* from git index (but keep working tree clean)
& git rm -r --cached --ignore-unmatch "UPLOAD_*.ts" "UPLOAD_*.zip" "UPLOAD_*.txt" "UPLOAD_*.md" "_patch_bak" | Out-Null
Ok "[OK] git rm --cached cleanup attempted (ignore-unmatch)."
