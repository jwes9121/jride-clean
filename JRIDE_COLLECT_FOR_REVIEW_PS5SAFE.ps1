param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Ensure-Dir([string]$p) {
  if (!(Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$outDir = Join-Path $ProjRoot "_collect"
Ensure-Dir $outDir
$zipPath = Join-Path $outDir ("JRIDE_REVIEW_COLLECT_{0}.zip" -f $ts)

# Add/adjust paths here as needed, but keep them explicit
$paths = @(
  "app\admin\livetrips\LiveTripsClient.tsx",
  "app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx",
  "app\admin\livetrips\components\TripLifecycleActions.tsx",
  "app\admin\livetrips\components\TripWalletPanel.tsx",

  "app\api\admin\livetrips\page-data\route.ts",
  "app\api\dispatch\assign\route.ts",
  "app\api\dispatch\status\route.ts",
  "app\api\driver\status\route.ts",
  "app\api\driver\fare\propose\route.ts",
  "app\api\passenger\track\route.ts"
)

$tmp = Join-Path $outDir ("_staging_{0}" -f $ts)
Ensure-Dir $tmp

foreach ($rel in $paths) {
  $src = Join-Path $ProjRoot $rel
  if (Test-Path -LiteralPath $src) {
    $dst = Join-Path $tmp $rel
    $dstDir = Split-Path -Parent $dst
    Ensure-Dir $dstDir
    Copy-Item -LiteralPath $src -Destination $dst -Force
  }
}

# Also include a quick schema snapshot query file (so we don’t assume columns)
$schemaTxt = @"
-- Run these in Supabase SQL editor and paste results
select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name in ('bookings','driver_locations','dispatch_actions')
order by table_name, ordinal_position;

select t.tgname, t.tgenabled
from pg_trigger t
join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='bookings' and not t.tgisinternal
order by t.tgname;

select routine_schema, routine_name, routine_type
from information_schema.routines
where routine_schema='public'
  and routine_name ilike '%assign%'
order by routine_name;
"@
$schemaFile = Join-Path $tmp "_SCHEMA_SNAPSHOT_QUERIES.sql"
[IO.File]::WriteAllText($schemaFile, $schemaTxt, (New-Object System.Text.UTF8Encoding($false)))

if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $tmp "*") -DestinationPath $zipPath -Force
Remove-Item -LiteralPath $tmp -Recurse -Force

Write-Host ("[OK] Collected zip: {0}" -f $zipPath)
