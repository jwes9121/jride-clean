# PATCH-JRIDE_ADMIN_CC_VERIFICATION_COUNTERS_V1_2.ps1
# ASCII-only | UTF8 NO BOM
# UI-only: add verification counters to Admin Control Center link titles.
# Anchor strategy:
# 1) Insert after role state line: const [role, setRole] = useState(...)
# 2) Fallback: insert after the first useEffect(() => { ... } line
# Badges added to "Admin Verification" and "Dispatcher Verification" titles.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function TS(){ (Get-Date).ToString("yyyyMMdd_HHmmss") }
function ReadT($p){ if(!(Test-Path -LiteralPath $p)){ Fail "Missing $p" }; [IO.File]::ReadAllText($p) }
function WriteUtf8NoBom($p,$t){ $enc = New-Object Text.UTF8Encoding($false); [IO.File]::WriteAllText($p,$t,$enc) }

$target = "app\admin\control-center\page.tsx"
if(!(Test-Path -LiteralPath $target)){ Fail "Target not found: $target" }

$bak = "$target.bak.$(TS)"
Copy-Item -Force $target $bak
Write-Host "[OK] Backup: $bak"

$txt = ReadT $target
$orig = $txt

# ---- Inject state + loader (once) ----
if($txt -notmatch '\bverificationCounts\b'){
$inject = @'
  const [verificationCounts, setVerificationCounts] = useState<{ admin: number; dispatcher: number }>({
    admin: 0,
    dispatcher: 0,
  });

  useEffect(() => {
    (async () => {
      try {
        const a = await supabase
          .from("passenger_verifications")
          .select("id", { count: "exact", head: true })
          .in("status", ["pending", "pre_approved_dispatcher"]);

        const d = await supabase
          .from("passenger_verifications")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending");

        setVerificationCounts({
          admin: (a as any)?.count ?? 0,
          dispatcher: (d as any)?.count ?? 0,
        });
      } catch {
        // ignore
      }
    })();
  }, []);

'@

  $insertAt = -1

  # Prefer: insert after role state line
  $rxRole = [regex]::new('(?m)^\s*const\s*\[\s*role\s*,\s*setRole\s*\]\s*=\s*useState[^\r\n]*\r?\n', 'Singleline')
  $mRole = $rxRole.Match($txt)
  if($mRole.Success){
    $insertAt = $mRole.Index + $mRole.Length
    Write-Host "[OK] Anchor: role state line."
  } else {
    # Fallback: after first useEffect line
    $rxUE = [regex]::new('(?m)^\s*useEffect\s*\(\s*\(\s*\)\s*=>\s*\{\s*\r?\n', 'Singleline')
    $mUE = $rxUE.Match($txt)
    if($mUE.Success){
      $insertAt = $mUE.Index
      Write-Host "[OK] Anchor: first useEffect block."
    } else {
      Fail "ANCHOR NOT FOUND: could not find role state line or any useEffect(() => { block."
    }
  }

  $txt = $txt.Substring(0,$insertAt) + $inject + $txt.Substring($insertAt)
  Write-Host "[OK] Injected verificationCounts state + loader."
} else {
  Write-Host "[OK] verificationCounts already exists (skipped inject)."
}

# ---- Add badges to the link titles we inserted earlier ----
# Match exact title divs to avoid accidental replacements elsewhere.
$adminTitle = '<div className="text-sm font-semibold">Admin Verification</div>'
$dispTitle  = '<div className="text-sm font-semibold">Dispatcher Verification</div>'

if($txt -match [regex]::Escape($adminTitle) -and $txt -notmatch 'verificationCounts\.admin'){
  $adminNew = '<div className="text-sm font-semibold">Admin Verification {verificationCounts.admin > 0 ? <span className="ml-2 inline-block rounded-full border border-black/10 px-2 py-0.5 text-xs">{verificationCounts.admin}</span> : null}</div>'
  $txt = $txt -replace [regex]::Escape($adminTitle), [regex]::Escape($adminNew).Replace('\','\')
  # The above escape is overkill; do safer direct replace using .Replace on the string:
  $txt = $txt.Replace($adminTitle, $adminNew)
  Write-Host "[OK] Added Admin badge."
} else {
  Write-Host "[WARN] Admin title anchor not found or already patched (skipped)."
}

if($txt -match [regex]::Escape($dispTitle) -and $txt -notmatch 'verificationCounts\.dispatcher'){
  $dispNew = '<div className="text-sm font-semibold">Dispatcher Verification {verificationCounts.dispatcher > 0 ? <span className="ml-2 inline-block rounded-full border border-black/10 px-2 py-0.5 text-xs">{verificationCounts.dispatcher}</span> : null}</div>'
  $txt = $txt.Replace($dispTitle, $dispNew)
  Write-Host "[OK] Added Dispatcher badge."
} else {
  Write-Host "[WARN] Dispatcher title anchor not found or already patched (skipped)."
}

if($txt -eq $orig){ Fail "No changes applied." }

WriteUtf8NoBom $target $txt
Write-Host "[OK] Control Center verification counters patched."
Write-Host ""
Write-Host "NEXT:"
Write-Host "  npm.cmd run build"
