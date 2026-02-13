# PATCH-JRIDE_ADMIN_CC_VERIFICATION_COUNTERS_LIBCLIENT_V1.ps1
# ASCII-only | UTF8 NO BOM
# UI-only: Admin Control Center verification counters using "@/lib/supabaseClient"

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

# 1) Ensure supabase import exists (exact pattern used elsewhere)
if($txt -notmatch 'from\s+["'']@/lib/supabaseClient["'']'){
  # Insert after last import
  $m = [regex]::Matches($txt, '(?m)^\s*import\s+.*?;\s*$')
  if($m.Count -eq 0){ Fail "ANCHOR NOT FOUND: no import lines found to insert supabase import." }
  $last = $m[$m.Count - 1]
  $ins = $last.Index + $last.Length
  $txt = $txt.Substring(0,$ins) + "`r`nimport { supabase } from `"@/lib/supabaseClient`";" + $txt.Substring($ins)
  Write-Host "[OK] Added import { supabase } from `"@/lib/supabaseClient`";"
} else {
  Write-Host "[OK] supabase import already present (skipped)."
}

# 2) Remove any previous verificationCounts hook block (if present)
$rxRemove = [regex]::new(
  '(\r?\n\s*)const\s*\[\s*verificationCounts\s*,\s*setVerificationCounts\s*\]\s*=\s*useState<[\s\S]*?\);\s*\r?\n\s*useEffect\([\s\S]*?\r?\n\s*\}\s*,\s*\[\s*\]\s*\)\s*;\s*\r?\n',
  'Singleline'
)
if($rxRemove.IsMatch($txt)){
  $txt = $rxRemove.Replace($txt, "`r`n", 1)
  Write-Host "[OK] Removed existing verificationCounts hook block."
}

# 3) Insert clean block BEFORE first "return ("
$rxReturn = [regex]::new('(\r?\n\s*)return\s*\(\s*\r?\n', 'Singleline')
$mRet = $rxReturn.Match($txt)
if(-not $mRet.Success){ Fail "ANCHOR NOT FOUND: could not locate 'return ('." }

$block = @'
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

if($txt -match '\bverificationCounts\b'){
  Write-Host "[OK] verificationCounts still present (skipped insert)."
} else {
  $insertAt = $mRet.Index + $mRet.Groups[1].Value.Length
  $txt = $txt.Substring(0,$insertAt) + $block + $txt.Substring($insertAt)
  Write-Host "[OK] Inserted verificationCounts block before return()."
}

# 4) Add badges to link title divs (exact anchors from our panel)
$adminTitle = '<div className="text-sm font-semibold">Admin Verification</div>'
$dispTitle  = '<div className="text-sm font-semibold">Dispatcher Verification</div>'

if($txt.Contains($adminTitle) -and ($txt -notmatch 'verificationCounts\.admin')){
  $adminNew = '<div className="text-sm font-semibold">Admin Verification {verificationCounts.admin > 0 ? <span className="ml-2 inline-block rounded-full border border-black/10 px-2 py-0.5 text-xs">{verificationCounts.admin}</span> : null}</div>'
  $txt = $txt.Replace($adminTitle, $adminNew)
  Write-Host "[OK] Added Admin badge."
} else {
  Write-Host "[WARN] Admin title not found or already patched (skipped)."
}

if($txt.Contains($dispTitle) -and ($txt -notmatch 'verificationCounts\.dispatcher')){
  $dispNew = '<div className="text-sm font-semibold">Dispatcher Verification {verificationCounts.dispatcher > 0 ? <span className="ml-2 inline-block rounded-full border border-black/10 px-2 py-0.5 text-xs">{verificationCounts.dispatcher}</span> : null}</div>'
  $txt = $txt.Replace($dispTitle, $dispNew)
  Write-Host "[OK] Added Dispatcher badge."
} else {
  Write-Host "[WARN] Dispatcher title not found or already patched (skipped)."
}

if($txt -eq $orig){ Fail "No changes applied." }

WriteUtf8NoBom $target $txt
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "NEXT:"
Write-Host "  npm.cmd run build"
