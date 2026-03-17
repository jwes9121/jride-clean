param(
  [string]$WebRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

function Read-Text([string]$Path) {
  if (!(Test-Path $Path)) { throw "Missing file: $Path" }
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $enc)
}

function Backup-File([string]$Path, [string]$Tag) {
  $dir = Split-Path -Parent $Path
  $bakDir = Join-Path $dir "_patch_bak"
  if (!(Test-Path $bakDir)) {
    New-Item -ItemType Directory -Path $bakDir -Force | Out-Null
  }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = Split-Path $Path -Leaf
  $bak = Join-Path $bakDir "$name.bak.$Tag.$stamp"
  Copy-Item $Path $bak -Force
  return $bak
}

Write-Host "== JRIDE PAGE-DATA FIX V1 (PS5-safe) =="

$target = Join-Path $WebRoot "app\api\admin\livetrips\page-data\route.ts"
if (!(Test-Path $target)) {
  throw "Target file not found: $target"
}

$bak = Backup-File -Path $target -Tag "PAGE_DATA_FIX_V1"
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$text = Read-Text $target
$original = $text

$pattern = '(?s)async function getExistingColumns\([^)]*\)\s*:\s*Promise<Set<string>>\s*\{.*?\n\}'
$replacement = @'
async function getExistingColumns(
  supabase: any,
  table: string
): Promise<Set<string>> {
  try {
    const { data, error } = await supabase.from(table).select("*").limit(1)
    if (error) {
      console.error("PAGE_DATA_SCHEMA_COLUMNS_ERROR", {
        table,
        message: error.message,
      })
      return new Set<string>()
    }
    if (!data || !data.length) {
      return new Set<string>()
    }
    return new Set<string>(Object.keys(data[0] || {}))
  } catch (e: any) {
    console.error("PAGE_DATA_SCHEMA_COLUMNS_ERROR", {
      table,
      message: String(e?.message || e),
    })
    return new Set<string>()
  }
}
'@

$newText = [regex]::Replace($text, $pattern, $replacement, 1)

if ($newText -eq $text) {
  throw "Could not find getExistingColumns(...) block to replace safely."
}

Write-Utf8NoBom -Path $target -Content $newText
Write-Host "[OK] Wrote: $target" -ForegroundColor Green
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "1) npm run build"
Write-Host "2) deploy and recheck Vercel logs"