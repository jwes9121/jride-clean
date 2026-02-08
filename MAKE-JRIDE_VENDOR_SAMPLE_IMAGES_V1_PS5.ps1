# MAKE-JRIDE_VENDOR_SAMPLE_IMAGES_V1_PS5.ps1
# Creates simple non-AI-looking sample menu images (PNG) in public/vendor-samples
# Requires no downloads. Uses built-in .NET drawing.

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$root = (Get-Location).Path
$dst = Join-Path $root "public\vendor-samples"
New-Item -ItemType Directory -Force -Path $dst | Out-Null

$items = @(
  @{ slug="dinakdakan";         title="Dinakdakan";           price="P180" },
  @{ slug="native-chicken-soup";title="Native Chicken Soup";  price="P220" },
  @{ slug="pinapaitan";         title="Pinapaitan";           price="P200" },
  @{ slug="hamburger";          title="Hamburger";            price="P120" },
  @{ slug="milktea";            title="Milk Tea";             price="P99"  }
)

function New-CardImage($path, $title, $price) {
  $w = 900
  $h = 600
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = "AntiAlias"

  $bg = [System.Drawing.Color]::FromArgb(245, 247, 250)
  $g.Clear($bg)

  $cardRect = New-Object System.Drawing.Rectangle(60, 60, ($w-120), ($h-120))
  $cardBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220,225,232), 3)

  # Shadow
  $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(25, 0,0,0))
  $shadowRect = New-Object System.Drawing.Rectangle(68, 68, ($w-120), ($h-120))
  $g.FillRectangle($shadowBrush, $shadowRect)

  # Card
  $g.FillRectangle($cardBrush, $cardRect)
  $g.DrawRectangle($borderPen, $cardRect)

  # Header bar
  $hdrRect = New-Object System.Drawing.Rectangle(60, 60, ($w-120), 110)
  $hdrBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(18, 24, 38))
  $g.FillRectangle($hdrBrush, $hdrRect)

  $fontTitle = New-Object System.Drawing.Font("Segoe UI", 40, [System.Drawing.FontStyle]::Bold)
  $fontPrice = New-Object System.Drawing.Font("Segoe UI", 28, [System.Drawing.FontStyle]::Bold)
  $fontHint  = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Regular)

  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $dark  = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(20, 26, 38))
  $muted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(90, 100, 120))

  $g.DrawString($title, $fontTitle, $white, 90, 85)
  $g.DrawString($price, $fontPrice, $dark, 90, 220)
  $g.DrawString("Sample photo (optimized for demo)", $fontHint, $muted, 90, 290)

  # Simple “plate” circle to feel like food but still not AI
  $platePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(200,205,215), 8)
  $plateRect = New-Object System.Drawing.Rectangle(520, 210, 280, 280)
  $g.DrawEllipse($platePen, $plateRect)

  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

Write-Host "== Creating vendor sample images ==" -ForegroundColor Cyan
foreach ($it in $items) {
  $out = Join-Path $dst ($it.slug + ".png")
  New-CardImage -path $out -title $it.title -price $it.price
  Write-Host ("[OK] {0}" -f $out) -ForegroundColor Green
}

Write-Host ""
Write-Host "Done. Files in public/vendor-samples:" -ForegroundColor Cyan
Get-ChildItem $dst | Select-Object Name,Length
