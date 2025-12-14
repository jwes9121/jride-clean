param()

function Fail($msg) { throw $msg }
function Require($cond, $msg) { if (-not $cond) { Fail $msg } }

function Read-EnvFile($path) {
  $map = @{}
  if (-not (Test-Path $path)) { return $map }
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0) { return }
    if ($line.StartsWith("#")) { return }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { return }
    $k = $line.Substring(0, $eq).Trim()
    $v = $line.Substring($eq + 1).Trim()
    if ($v.StartsWith('"') -and $v.EndsWith('"') -and $v.Length -ge 2) { $v = $v.Substring(1, $v.Length - 2) }
    if ($v.StartsWith("'") -and $v.EndsWith("'") -and $v.Length -ge 2) { $v = $v.Substring(1, $v.Length - 2) }
    $map[$k] = $v
  }
  return $map
}

function FirstNonEmpty([object[]]$vals) {
  foreach ($v in $vals) {
    if ($null -ne $v -and ("" + $v).Trim().Length -gt 0) { return ("" + $v).Trim() }
  }
  return $null
}

Write-Host ""
Write-Host "JRide Fix: driver_admin_approve_payout() via npx supabase" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

$root = $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }

$envPath = Join-Path $root ".env.local"
$envMap  = Read-EnvFile $envPath

$projectRef = FirstNonEmpty @(
  $envMap["SUPABASE_PROJECT_REF"],
  $env:SUPABASE_PROJECT_REF
)

Require ($projectRef) "Missing SUPABASE_PROJECT_REF in .env.local (example: SUPABASE_PROJECT_REF=gxaullwnxbkbjqbjotsr)"

# Sanity: node + npx must exist
$node = Get-Command node -ErrorAction SilentlyContinue
$npx  = Get-Command npx  -ErrorAction SilentlyContinue
Require ($node) "node not found. Install Node.js 20+ and reopen PowerShell."
Require ($npx)  "npx not found. Install Node.js 20+ and reopen PowerShell."

# Sanity: supabase CLI via npx
Write-Host ""
Write-Host "Checking supabase CLI via npx..." -ForegroundColor DarkCyan
& npx supabase --version
if ($LASTEXITCODE -ne 0) { Fail "npx supabase failed. Fix Node installation first." }

# SQL patch (DROP+CREATE to avoid 42P13)
$sql = @"
begin;

drop function if exists public.driver_admin_approve_payout(bigint, text, text, text, text);

create function public.driver_admin_approve_payout(
  p_request_id    bigint,
  p_admin_note    text default null,
  p_payout_method text default null,
  p_payout_ref    text default null,
  p_receipt_url   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as \$\$
declare
  v_req record;
  v_driver record;
  v_new_wallet numeric;
begin
  select * into v_req
  from public.driver_payout_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Payout request not found: %', p_request_id;
  end if;

  if coalesce(v_req.status, '') not in ('pending', 'requested', 'processing', '') then
    raise exception 'Payout request % has invalid status for approval: %', p_request_id, v_req.status;
  end if;

  select id, wallet_balance, min_wallet_required
    into v_driver
  from public.drivers
  where id = v_req.driver_id
  for update;

  if not found then
    raise exception 'Driver not found for payout request % (driver_id=%)', p_request_id, v_req.driver_id;
  end if;

  if v_req.amount is null or v_req.amount <= 0 then
    raise exception 'Invalid payout amount for request %: %', p_request_id, v_req.amount;
  end if;

  v_new_wallet := (v_driver.wallet_balance - v_req.amount);

  if v_new_wallet < v_driver.min_wallet_required then
    raise exception 'Insufficient wallet for payout. driver=% wallet=% min=% amount=% new=%',
      v_driver.id, v_driver.wallet_balance, v_driver.min_wallet_required, v_req.amount, v_new_wallet;
  end if;

  update public.drivers
  set wallet_balance = v_new_wallet
  where id = v_driver.id;

  update public.driver_payout_requests
  set
    status        = 'paid',
    processed_at  = now(),
    admin_note    = coalesce(p_admin_note, admin_note),
    payout_method = coalesce(p_payout_method, payout_method),
    payout_ref    = coalesce(p_payout_ref, payout_ref),
    receipt_url   = coalesce(p_receipt_url, receipt_url)
  where id = p_request_id;

  return jsonb_build_object('ok', true, 'request_id', p_request_id, 'status', 'paid');
end;
\$\$;

grant execute on function public.driver_admin_approve_payout(bigint, text, text, text, text) to authenticated;
grant execute on function public.driver_admin_approve_payout(bigint, text, text, text, text) to anon;

do \$\$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end \$\$;

commit;
"@

$tmpSql = Join-Path $env:TEMP ("jride_fix_" + [guid]::NewGuid().ToString("n") + ".sql")
$sql | Out-File -FilePath $tmpSql -Encoding UTF8

try {
  Write-Host ""
  Write-Host "Applying patch to project: $projectRef" -ForegroundColor DarkCyan
  Write-Host "NOTE: You must have run: npx supabase login" -ForegroundColor DarkGray

  & npx supabase db execute --project-ref $projectRef --file $tmpSql
  if ($LASTEXITCODE -ne 0) { Fail "npx supabase db execute failed." }

  Write-Host ""
  Write-Host "✅ Patch applied successfully." -ForegroundColor Green
}
finally {
  if (Test-Path $tmpSql) { Remove-Item $tmpSql -Force -ErrorAction SilentlyContinue }
}
