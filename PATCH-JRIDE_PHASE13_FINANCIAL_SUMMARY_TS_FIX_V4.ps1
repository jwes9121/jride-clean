$ErrorActionPreference = "Stop"

function Timestamp() { Get-Date -Format "yyyyMMdd_HHmmss" }
$ts = Timestamp

function Ensure-Dir($p) { if (!(Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null } }

function Backup-IfExists($path) {
  if (Test-Path $path) {
    $bak = "$path.bak.$ts"
    Copy-Item -Force $path $bak
    Write-Host "[OK] Backup: $bak"
  }
}

function Write-Utf8NoBom($path, $content) {
  Ensure-Dir (Split-Path -Parent $path)
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
  Write-Host "[OK] Wrote: $path"
}

function Fail($m) { throw $m }

$root = (Get-Location).Path
$page = Join-Path $root "app\admin\finance\summary\page.tsx"

if (!(Test-Path $page)) { Fail "Missing file: $page" }

Backup-IfExists $page

$txt = Get-Content -Raw -Path $page

$old = @'
function downloadCsv(filename: string, rows: AnyObj[]) {
  const headers = Array.from(
    rows.reduce((set, r) => {
      Object.keys(r || {}).forEach((k) => set.add(k));
      return set;
    }, new Set<string>())
  );

  const esc = (v: any) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const lines: string[] = [];
  lines.push(headers.map(esc).join(","));
  for (const r of rows) lines.push(headers.map((h) => esc((r as AnyObj)[h])).join(","));

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 500);
}
'@

$new = @'
function downloadCsv(filename: string, rows: AnyObj[]) {
  const set = new Set<string>();
  for (const r of rows) {
    Object.keys(r || {}).forEach((k) => set.add(k));
  }
  const headers = [...set];

  const esc = (v: any) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const lines: string[] = [];
  lines.push(headers.map(esc).join(","));
  for (const r of rows) lines.push(headers.map((h) => esc((r as AnyObj)[h])).join(","));

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 500);
}
'@

if ($txt.IndexOf($old) -lt 0) {
  Fail "Anchor block not found in finance summary page. Paste app/admin/finance/summary/page.tsx so we can patch without guessing."
}

$txt = $txt.Replace($old, $new)

Write-Utf8NoBom $page $txt

Write-Host ""
Write-Host "[DONE] PHASE13: Fixed TypeScript header inference in downloadCsv() (no behavior change)."
