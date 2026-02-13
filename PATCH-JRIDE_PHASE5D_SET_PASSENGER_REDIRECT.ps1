$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

if (!(Test-Path ".\app\passenger-login\page.tsx")) { Fail "Missing app\passenger-login\page.tsx" }

$ts = (Get-Date).ToString("yyyyMMdd_HHmmss")
$path = ".\app\passenger-login\page.tsx"
Copy-Item $path "$path.bak.$ts" -Force
Ok "[OK] Backup: $path.bak.$ts"

$txt = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)

# change ONLY the router.push target
$txt2 = $txt -replace 'router\.push\(\"\/\"\)', 'router.push("/passenger")'

if ($txt2 -eq $txt) { Fail "No router.push(""/"") found to replace. Paste file content if path differs." }

[IO.File]::WriteAllText($path, $txt2, [Text.Encoding]::UTF8)
Ok "[OK] Patched redirect to /passenger"
Info "NEXT: npm.cmd run build"
