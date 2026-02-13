# PATCH-JRIDE_VERIFICATION_UX_POLISH_V1.ps1
# ASCII-only | UTF8 NO BOM
# UI-only: status pills + disable buttons after action

$ErrorActionPreference = "Stop"
function Patch($path){
  $txt = [IO.File]::ReadAllText($path)
  $orig = $txt

  # Status pill
  $txt = $txt -replace 'Status:\s*<b>\{r.status\}</b>',
'Status: <span className={`inline-block rounded-full px-2 py-0.5 text-xs border ${
  r.status === "pending" ? "bg-yellow-50" :
  r.status === "pre_approved_dispatcher" ? "bg-blue-50" :
  r.status === "approved_admin" ? "bg-green-50" :
  "bg-red-50"
}`}>{r.status}</span>'

  # Disable buttons if not pending
  $txt = $txt -replace '<button([^>]+)onClick=\{\(\)\s*=>\s*(approve|preApprove)\(r.id\)\}',
'<button$1disabled={r.status !== "pending"} onClick={() => $2(r.id)}'

  $txt = $txt -replace '<button([^>]+)onClick=\{\(\)\s*=>\s*reject\(r.id\)\}',
'<button$1disabled={r.status !== "pending"} onClick={() => reject(r.id)}'

  if($txt -ne $orig){
    $bak = "$path.bak.$(Get-Date -Format yyyyMMdd_HHmmss)"
    Copy-Item $path $bak -Force
    [IO.File]::WriteAllText($path, $txt, (New-Object Text.UTF8Encoding($false)))
    Write-Host "[OK] Patched $path"
  } else {
    Write-Host "[SKIP] No changes for $path"
  }
}

Patch "app/admin/verification/page.tsx"
Patch "app/admin/dispatcher-verifications/page.tsx"
