# Builds contact sheets (grids of labeled thumbnails) for visual template audit.
# Usage: pwsh tools/make-contact-sheets.ps1 -Src <dir> -Out <dir> [-Pattern <prefix>] [-Title <text>]
param(
  [Parameter(Mandatory = $true)][string]$Src,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Pattern = "*",
  [string]$Title = "",
  [int]$Cols = 6,
  [int]$TileW = 340,
  [int]$TileH = 280
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

New-Item -ItemType Directory -Force $Out | Out-Null
$files = Get-ChildItem $Src -Filter *.png | Where-Object { $_.BaseName -like $Pattern } | Sort-Object Name
if ($files.Count -eq 0) { Write-Error "no files match $Pattern in $Src"; exit 1 }

$labelH = 26
$headerH = if ($Title) { 46 } else { 0 }
$rows = [Math]::Ceiling($files.Count / $Cols)
$sheetW = $Cols * $TileW
$sheetH = $headerH + $rows * ($TileH + $labelH)
$bmp = New-Object System.Drawing.Bitmap($sheetW, $sheetH)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(248, 248, 250))
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

$titleFont = New-Object System.Drawing.Font("Segoe UI", 20, [System.Drawing.FontStyle]::Bold)
$labelFont = New-Object System.Drawing.Font("Segoe UI", 9)
$titleBrush = [System.Drawing.Brushes]::Black
$labelBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(60, 64, 72))
$borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 222, 228))

if ($Title) {
  $g.DrawString($Title, $titleFont, $titleBrush, 14, 10)
}

for ($i = 0; $i -lt $files.Count; $i++) {
  $col = $i % $Cols
  $row = [Math]::Floor($i / $Cols)
  $x = $col * $TileW
  $y = $headerH + $row * ($TileH + $labelH)
  $img = [System.Drawing.Image]::FromFile($files[$i].FullName)
  $scale = [Math]::Min(($TileW - 16) / $img.Width, ($TileH - 12) / $img.Height)
  $dw = [int]($img.Width * $scale)
  $dh = [int]($img.Height * $scale)
  $dx = $x + [int](($TileW - $dw) / 2)
  $dy = $y + [int](($TileH - $dh) / 2)
  $g.DrawImage($img, $dx, $dy, $dw, $dh)
  $g.DrawRectangle($borderPen, $dx - 1, $dy - 1, $dw + 1, $dh + 1)
  $label = $files[$i].BaseName
  $g.DrawString($label, $labelFont, $labelBrush, $x + 8, $y + $TileH + 4)
  $img.Dispose()
}

$name = if ($Title) { $Title -replace '[^\w\u4e00-\u9fa5-]+', '_' } else { $Pattern -replace '[^a-zA-Z0-9]+', '_' }
$outPath = Join-Path $Out "$name.jpg"
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 82)
$bmp.Save($outPath, $enc, $params)
$g.Dispose(); $bmp.Dispose()
Write-Output "$outPath ($($files.Count) tiles)"
