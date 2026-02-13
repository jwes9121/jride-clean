# PATCH-DISPATCH-DEDUPE-BUTTON-PROPS.ps1
# Robustly removes duplicate JSX props inside the opening <button ...> tag
# for the Dispatch export buttons + LGU Fix button.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Stamp(){ Get-Date -Format "yyyyMMdd-HHmmss" }
function Backup($p){
  if(!(Test-Path $p)){ throw "Missing file: $p" }
  $bak = "$p.bak.$(Stamp)"
  Copy-Item $p $bak -Force
  Write-Host "[OK] Backup: $bak"
}
function ReadAll($p){ [IO.File]::ReadAllText($p,[Text.Encoding]::UTF8) }
function WriteAll($p,$s){ [IO.File]::WriteAllText($p,$s,[Text.Encoding]::UTF8) }

# Dedup repeated props in a single opening tag
function DedupPropInTag([string]$tag, [string]$propName){
  # Matches like: propName=... (JSX), including {...} or "..."
  $rx = New-Object System.Text.RegularExpressions.Regex(
    "(?s)\s+$propName\s*=\s*(\{.*?\}|""[^""]*"")",
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  $ms = $rx.Matches($tag)
  if($ms.Count -le 1){ return $tag }

  # Keep first occurrence; remove the rest from end to start
  for($i = $ms.Count-1; $i -ge 1; $i--){
    $m = $ms[$i]
    $tag = $tag.Remove($m.Index, $m.Length)
  }
  return $tag
}

function FixButtonByOnClick([string]$text, [string]$onClickToken){
  # Find opening <button ...> that contains onClick={...}
  $rxBtn = New-Object System.Text.RegularExpressions.Regex(
    "(?s)<button\b[^>]*\bonClick\s*=\s*\{$onClickToken\}[^>]*>",
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )

  $matches = $rxBtn.Matches($text)
  if($matches.Count -eq 0){ return ,@($text, 0) }

  # Replace from end to start
  for($k = $matches.Count-1; $k -ge 0; $k--){
    $m = $matches[$k]
    $tag = $m.Value

    foreach($p in @("disabled","title","onClick","className")){
      $tag = DedupPropInTag $tag $p
    }

    $text = $text.Remove($m.Index, $m.Length).Insert($m.Index, $tag)
  }
  return ,@($text, $matches.Count)
}

$root = Get-Location
$f = Join-Path $root "app\dispatch\page.tsx"
Backup $f

$txt = ReadAll $f
$orig = $txt

# Fix CSV export button
$r1 = FixButtonByOnClick $txt "exportLguCsv"
$txt = $r1[0]; $n1 = $r1[1]

# Fix Excel export button
$r2 = FixButtonByOnClick $txt "exportLguExcel"
$txt = $r2[0]; $n2 = $r2[1]

# Fix LGU Fix button (onClick={() => openFixer(b)}) – match the onClick token loosely via openFixer\(b\)
$rxLguBtn = New-Object System.Text.RegularExpressions.Regex(
  "(?s)<button\b[^>]*\bonClick\s*=\s*\{\(\)\s*=>\s*openFixer\(b\)\}[^>]*>",
  [System.Text.RegularExpressions.RegexOptions]::Singleline
)
$ms3 = $rxLguBtn.Matches($txt)
$n3 = $ms3.Count
if($n3 -gt 0){
  for($k=$n3-1; $k -ge 0; $k--){
    $m = $ms3[$k]
    $tag = $m.Value
    foreach($p in @("disabled","title","onClick","className")){
      $tag = DedupPropInTag $tag $p
    }
    $txt = $txt.Remove($m.Index, $m.Length).Insert($m.Index, $tag)
  }
}

if($txt -eq $orig){
  throw "No changes produced (no matching buttons found or no duplicates)."
}

WriteAll $f $txt
Write-Host "[DONE] Deduped props in buttons. CSV tags fixed: $n1 | Excel tags fixed: $n2 | LGU Fix tags fixed: $n3"
Write-Host "Next: npm run build"
