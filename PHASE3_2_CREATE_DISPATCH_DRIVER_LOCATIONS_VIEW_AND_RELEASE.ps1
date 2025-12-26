# PHASE3_2_CREATE_DISPATCH_DRIVER_LOCATIONS_VIEW_AND_RELEASE.ps1
# Phase 3.2:
# - Create a stable view: public.dispatch_driver_locations_view
# - View points to whichever realtime driver locations relation exists (schema-flex)
# - Reversible: includes DOWN section (drop view)
# - Then: npm.cmd run build, git commit, git tag

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

# ---- CONFIG (edit if you want different commit/tag) ----
$CommitMessage = "JRIDE_DISPATCH_PHASE3_2 dispatch_driver_locations_view (schema-flex)"
$TagName = "JRIDE_DISPATCH_PHASE3_2_VIEW_$(Get-Date -Format 'yyyyMMdd_HHmmss')"

# ---- paths ----
$SqlOut = "supabase\migrations\$(Get-Date -Format 'yyyyMMddHHmmss')_phase3_2_dispatch_driver_locations_view.sql"
$SqlDir = Split-Path -Parent $SqlOut

# Ensure we're at repo root by checking a known path
if (!(Test-Path "app\api\dispatch\drivers-live\route.ts")) {
  Fail "Run this from repo root (expected app\api\dispatch\drivers-live\route.ts)."
}

New-Item -ItemType Directory -Force -Path $SqlDir | Out-Null

# ---- SQL (single migration-safe block + reversible DOWN) ----
$sql = @'
-- Phase 3.2: Stable realtime driver locations view (schema-flex)
-- Creates: public.dispatch_driver_locations_view
-- Strategy: pick first existing relation among known candidates, then create/replace view as SELECT * FROM that relation.
-- Reversible: DOWN drops the view.

-- =========================
-- UP
-- =========================
DO $$
DECLARE
  candidates text[] := ARRAY[
    'public.driver_locations',
    'public.driver_locations_view',
    'public.dispatch_driver_locations',
    'public.dispatch_driver_locations_view',
    'public.drivers_locations',
    'public.drivers_location',
    'public.driver_location',
    'public.admin_driver_locations'
  ];
  src text := NULL;
  i int;
BEGIN
  -- Find first existing relation
  FOR i IN 1..array_length(candidates, 1) LOOP
    IF to_regclass(candidates[i]) IS NOT NULL THEN
      src := candidates[i];
      EXIT;
    END IF;
  END LOOP;

  IF src IS NULL THEN
    RAISE EXCEPTION 'Phase 3.2: No realtime driver locations source found. Tried: %', candidates;
  END IF;

  EXECUTE format('CREATE OR REPLACE VIEW public.dispatch_driver_locations_view AS SELECT * FROM %s', src);

  -- Grants (safe to run even if roles vary)
  BEGIN
    EXECUTE 'GRANT SELECT ON public.dispatch_driver_locations_view TO anon';
  EXCEPTION WHEN undefined_object THEN
    -- ignore
  END;

  BEGIN
    EXECUTE 'GRANT SELECT ON public.dispatch_driver_locations_view TO authenticated';
  EXCEPTION WHEN undefined_object THEN
    -- ignore
  END;

  COMMENT ON VIEW public.dispatch_driver_locations_view IS
    'JRIDE Phase 3.2: Stable dispatch view pointing to realtime driver locations source: ' || src;

END $$;

-- =========================
-- DOWN (manual rollback)
-- =========================
-- DROP VIEW IF EXISTS public.dispatch_driver_locations_view;
'@

Set-Content -LiteralPath $SqlOut -Value $sql -Encoding UTF8
Write-Host "[OK] Wrote migration: $SqlOut"

# ---- OPTIONAL EXECUTION (only if psql + DATABASE_URL are available) ----
$hasPsql = $false
try { $null = (Get-Command psql -ErrorAction Stop); $hasPsql = $true } catch { $hasPsql = $false }

if ($hasPsql -and $env:DATABASE_URL) {
  Write-Host "[INFO] DATABASE_URL detected + psql available. Applying migration now..."
  & psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f $SqlOut
  Write-Host "[OK] Migration applied via psql."
} else {
  Write-Host "[INFO] Skipping auto-apply (need psql + DATABASE_URL)."
  Write-Host "      Apply the SQL in Supabase SQL Editor using the migration file above."
}

# ---- Build ----
Write-Host ""
Write-Host "[STEP] npm.cmd run build"
& npm.cmd run build

# ---- Git commit + tag ----
Write-Host ""
Write-Host "[STEP] git add -A"
& git add -A

Write-Host "[STEP] git commit"
& git commit -m $CommitMessage

Write-Host "[STEP] git tag"
& git tag $TagName

Write-Host ""
Write-Host "[DONE] Phase 3.2 complete."
Write-Host "Commit: $CommitMessage"
Write-Host "Tag:    $TagName"
Write-Host ""
Write-Host "If you need rollback:"
Write-Host "  Run in Supabase SQL Editor:"
Write-Host "    DROP VIEW IF EXISTS public.dispatch_driver_locations_view;"
