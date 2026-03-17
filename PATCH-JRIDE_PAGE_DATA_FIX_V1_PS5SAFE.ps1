param(
  [string]$WebRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

$target = Join-Path $WebRoot "app\api\admin\livetrips\page-data\route.ts"
if (-not (Test-Path $target)) {
    throw "FATAL: page-data route not found at $target"
}

Write-Host "Found: $target" -ForegroundColor Green

# backup
$ts     = Get-Date -Format "yyyyMMdd_HHmmss"
$bakDir = Join-Path $WebRoot "_backups\pagedata"
if (-not (Test-Path $bakDir)) {
    New-Item -ItemType Directory -Path $bakDir -Force | Out-Null
}
$bakFile = Join-Path $bakDir "route.ts.$ts.bak"
Copy-Item $target $bakFile -Force
Write-Host "BACKUP: $bakFile" -ForegroundColor Green

$content = [System.IO.File]::ReadAllText($target, [System.Text.UTF8Encoding]::new($false))

if ($content -notmatch 'getExistingColumns') {
    throw "FATAL: getExistingColumns function not found"
}

if ($content -notmatch 'information_schema') {
    Write-Host "OK: information_schema reference already removed." -ForegroundColor Yellow
    exit 0
}

$oldFnPattern = '(?s)async function getExistingColumns\([^)]*\)\s*:\s*Promise<Set<string>>\s*\{.*?\n\}'

$newFnBody = @'
async function getExistingColumns(supabase: ReturnType<typeof supabaseAdmin>, table: string): Promise<Set<string>> {
  try {
    const { data, error } = await supabase.from(table).select("*").limit(1);
    if (error) {
      return new Set<string>();
    }
    if (!data || !data.length) {
      return new Set<string>();
    }
    return new Set<string>(Object.keys(data[0]).filter(Boolean));
  } catch (e: any) {
    console.error("getExistingColumns error for table:", table, e?.message);
    return new Set<string>();
  }
}
'@

$newContent = [regex]::Replace($content, $oldFnPattern, $newFnBody, 1)

if ($newContent -eq $content) {
    throw "FATAL: getExistingColumns function replacement failed"
}

[System.IO.File]::WriteAllText($target, $newContent, [System.Text.UTF8Encoding]::new($false))

Write-Host "PATCHED: $target" -ForegroundColor Green
Write-Host ""
Write-Host "Run next:" -ForegroundColor Cyan
Write-Host "npm run build"