# PATCH-JRIDE_ADMIN_CONTROL_CENTER_ADD_VERIFICATION_LINKS_ASCII_V1.ps1
# ASCII-only | UTF8 NO BOM
# UI-only: Add Admin Verification + Dispatcher Verification quick links to Admin Control Center page.
# Does NOT touch dispatch/status APIs or backend logic.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function TS(){ (Get-Date).ToString("yyyyMMdd_HHmmss") }
function ReadT($p){ if(!(Test-Path -LiteralPath $p)){ Fail "Missing file: $p" }; [IO.File]::ReadAllText($p) }
function WriteUtf8NoBom($p,$t){ $enc = New-Object Text.UTF8Encoding($false); [IO.File]::WriteAllText($p,$t,$enc) }

$target = "app\admin\control-center\page.tsx"
if(!(Test-Path -LiteralPath $target)){ Fail "Target not found: $target" }

$bak = "$target.bak.$(TS)"
Copy-Item -Force $target $bak
Write-Host "[OK] Backup: $bak"

$txt = ReadT $target
$orig = $txt

# 1) Ensure next/link import exists
if($txt -notmatch 'from\s+"next/link"' -and $txt -notmatch "from\s+'next/link'"){
  # Insert after the last import line (best-effort)
  $rxLastImport = [regex]::new('(?s)\A([\s\S]*?\bimport\b[\s\S]*?\r?\n)(?![\s\S]*?\bimport\b)', 'Singleline')
  # Above regex isn't reliable; instead find the last "import ...;" line
  $m = [regex]::Matches($txt, '(?m)^\s*import\s+.*?;\s*$')
  if($m.Count -gt 0){
    $last = $m[$m.Count - 1]
    $insertAt = $last.Index + $last.Length
    $txt = $txt.Substring(0,$insertAt) + "`r`nimport Link from `"next/link`";" + $txt.Substring($insertAt)
    Write-Host "[OK] Added: import Link from `"next/link`";"
  } else {
    # If no imports, add at top
    $txt = 'import Link from "next/link";' + "`r`n" + $txt
    Write-Host "[OK] Added Link import at top."
  }
} else {
  Write-Host "[OK] Link import already present (skipped)."
}

# 2) Insert a "Verification" quick-links section near the top of the JSX return
# Anchor on: return (  then the first opening tag line "<...>"
# We inject immediately after that first opening tag line, so it works whether the root is <main> or <div>.
$panel = @'
      {/* ===== ADMIN CONTROL CENTER: VERIFICATION LINKS ===== */}
      <section className="mt-4 mb-4 rounded-2xl border border-black/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Verification</div>
            <div className="text-xs opacity-70">Review passenger verification queue</div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href="/admin/verification"
            className="rounded-xl border border-black/10 p-3 hover:bg-black/5 transition"
          >
            <div className="text-sm font-semibold">Admin Verification</div>
            <div className="mt-1 text-xs opacity-70">Approve or reject pending + dispatcher pre-approved</div>
          </Link>

          <Link
            href="/admin/dispatcher-verifications"
            className="rounded-xl border border-black/10 p-3 hover:bg-black/5 transition"
          >
            <div className="text-sm font-semibold">Dispatcher Verification</div>
            <div className="mt-1 text-xs opacity-70">Pre-approve or reject new verification requests</div>
          </Link>
        </div>
      </section>
      {/* ===== END VERIFICATION LINKS ===== */}

'@

# Prevent duplicates
if($txt -match 'ADMIN CONTROL CENTER:\s*VERIFICATION LINKS'){
  Write-Host "[OK] Verification panel already present (skipped)."
} else {
  $rx = [regex]::new('return\s*\(\s*\r?\n(\s*<[^>]+>\s*\r?\n)', 'Singleline')
  $m = $rx.Match($txt)
  if(-not $m.Success){ Fail "ANCHOR NOT FOUND: Could not find 'return (' followed by first JSX opening tag line." }

  $firstTagLine = $m.Groups[1].Value
  $insertAt = $m.Index + $m.Length
  $txt = $txt.Substring(0,$insertAt) + $panel + $txt.Substring($insertAt)
  Write-Host "[OK] Inserted Verification links panel near top of return()."
}

if($txt -eq $orig){ Fail "No changes applied." }

WriteUtf8NoBom $target $txt
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "NEXT:"
Write-Host "  npm.cmd run build"
