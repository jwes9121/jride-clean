# DIAG-JRIDE_FIND_SUPABASE_CLIENT_PATTERN_V1.ps1
# ASCII-only
$ErrorActionPreference = "Stop"

Write-Host "== Searching for Supabase client patterns =="

$patterns = @(
  "createClientComponentClient",
  "createClient",
  "supabaseClient",
  "@/lib/supabaseClient",
  "@supabase/auth-helpers-nextjs",
  "createBrowserClient",
  "createServerComponentClient"
)

foreach($p in $patterns){
  Write-Host ""
  Write-Host ("--- Pattern: " + $p + " ---")
  try {
    Select-String -Path ".\app\**\*.tsx", ".\app\**\*.ts" -Pattern $p -SimpleMatch |
      Select-Object -First 20 |
      ForEach-Object { "{0}:{1}: {2}" -f $_.Path, $_.LineNumber, $_.Line.Trim() }
  } catch {}
}
