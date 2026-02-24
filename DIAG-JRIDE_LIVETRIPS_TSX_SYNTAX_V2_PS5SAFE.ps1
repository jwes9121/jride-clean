<# 
DIAG-JRIDE_LIVETRIPS_TSX_SYNTAX_V2_PS5SAFE.ps1

Runs TypeScript TSX parser on:
  app/admin/livetrips/LiveTripsClient.tsx

Prints:
- first diagnostic with line/col + caret
- next 5 diagnostics
- context +/- 40 lines around the first diagnostic

PS5-safe. Read-only (does not modify files).
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$ProjRoot,

  [Parameter(Mandatory = $false)]
  [int]$Context = 40
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Info([string]$m) { Write-Host $m -ForegroundColor Cyan }
function Ok([string]$m)   { Write-Host $m -ForegroundColor Green }
function Warn([string]$m) { Write-Host $m -ForegroundColor Yellow }
function Fail([string]$m) { Write-Host $m -ForegroundColor Red; throw $m }

function Normalize-Path([string]$p) {
  try { return (Resolve-Path -LiteralPath $p).Path } catch { return $p }
}

Info "== JRIDE LiveTrips: TSX syntax diagnostics (V2 / PS5-safe) =="

$ProjRoot = Normalize-Path $ProjRoot
$target = Normalize-Path (Join-Path $ProjRoot "app\admin\livetrips\LiveTripsClient.tsx")
Info ("Repo:   {0}" -f $ProjRoot)
Info ("Target: {0}" -f $target)
Info ""

if (!(Test-Path -LiteralPath $target)) { Fail "Target file not found: $target" }

$tmp = Join-Path $ProjRoot ("_diag_tsx_syntax_v2_" + (Get-Date).ToString("yyyyMMdd_HHmmss") + ".js")

$js = @'
const fs = require("fs");

const file = process.argv[2];
const ctx = parseInt(process.argv[3] || "40", 10);

let ts;
try { ts = require("typescript"); }
catch (e) {
  console.error("[FAIL] Could not require('typescript') from this repo.");
  console.error(String(e && e.message ? e.message : e));
  process.exit(3);
}

const text = fs.readFileSync(file, "utf8");
const lines = text.split(/\r\n|\n|\r/);

const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const diags = sf.parseDiagnostics || [];

if (!diags.length) {
  console.log("[OK] No TSX parseDiagnostics reported by TypeScript.");
  process.exit(0);
}

console.log(`[WARN] Found ${diags.length} TSX parse diagnostic(s).`);

function showDiag(d, idx) {
  const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
  const start = typeof d.start === "number" ? d.start : 0;
  const lc = sf.getLineAndCharacterOfPosition(start);
  const line = lc.line;
  const ch = lc.character;

  console.log(`\n#${idx+1}  L${line+1}:${ch+1}`);
  console.log(`Message: ${msg}`);

  const srcLine = lines[line] || "";
  const caret = " ".repeat(Math.max(0, ch)) + "^";
  console.log(srcLine);
  console.log(caret);

  return { line, ch, msg };
}

const first = showDiag(diags[0], 0);

for (let i = 1; i < Math.min(6, diags.length); i++) {
  showDiag(diags[i], i);
}

const from = Math.max(0, first.line - ctx);
const to = Math.min(lines.length - 1, first.line + ctx);

console.log(`\n---- CONTEXT L${from+1}-L${to+1} ----`);
for (let i = from; i <= to; i++) {
  const n = String(i+1).padStart(4, " ");
  console.log(`${n} | ${lines[i]}`);
}
console.log("---- END CONTEXT ----");
process.exit(0);
'@

# Write UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tmp, $js, $utf8NoBom)

try {
  Push-Location $ProjRoot
  node.exe $tmp $target $Context
  Pop-Location
} finally {
  if (Test-Path -LiteralPath $tmp) {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue | Out-Null
  }
}

Info ""
Info "Done."