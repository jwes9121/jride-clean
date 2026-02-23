param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

function Ensure-Dir([string]$p){
  if(-not (Test-Path -LiteralPath $p)){
    New-Item -ItemType Directory -Path $p | Out-Null
  }
}

function Write-TextUtf8NoBom([string]$path, [string]$text){
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $enc)
}

# --- Main ---
if(-not (Test-Path -LiteralPath $ProjRoot)){ Fail "[FAIL] ProjRoot not found: $ProjRoot" }
$ProjRoot = (Resolve-Path -LiteralPath $ProjRoot).Path

# 1) Remove audit bundles so you cannot accidentally build them
Get-ChildItem -LiteralPath $ProjRoot -Directory -Filter "_audit_bundle_*" -ErrorAction SilentlyContinue |
  ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
  }
Ok "[OK] Removed _audit_bundle_* folders (if any)."

# 2) Backup tsconfig.json
$tsconfig = Join-Path $ProjRoot "tsconfig.json"
if(-not (Test-Path -LiteralPath $tsconfig)){ Fail "[FAIL] Missing tsconfig.json at repo root." }

$bakDir = Join-Path $ProjRoot "_patch_bak"
Ensure-Dir $bakDir
$stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bak = Join-Path $bakDir ("tsconfig.json.bak.REPLACE_IGNORE_AUDIT_V1." + $stamp)
Copy-Item -LiteralPath $tsconfig -Destination $bak -Force
Ok "[OK] Backup: $bak"

# 3) Write a full, clean tsconfig.json (based on your screenshot + added excludes)
$new = @'
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts"
  ],
  "exclude": [
    "_collect_*",
    "**/_collect_*",
    "JRIDE_REVIEW_COLLECT_*",
    "**/JRIDE_REVIEW_COLLECT_*",
    "node_modules",
    "backups",
    "backups/**",
    "UPLOAD_TO_CHATGPT",
    "UPLOAD_TO_CHATGPT/**",
    "_patch_bak",
    "**/_patch_bak/**",
    ".next",
    "**/.next/**",

    "_audit_bundle_*",
    "**/_audit_bundle_*",
    "_audit_bundle_*/**",

    "_diag_out_*",
    "**/_diag_out_*",
    "_diag_out_*/**"
  ]
}
'@

Write-TextUtf8NoBom $tsconfig $new
Ok "[OK] Replaced tsconfig.json (UTF-8 no BOM)."

Info "[NEXT] Run: npm.cmd run build"