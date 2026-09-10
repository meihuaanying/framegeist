# Generates perf test photos (24MP + 60MP JPEG) into tools/perf/.
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force tools/perf | Out-Null
function Make-Photo($w, $h, $path) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(30, 60, 160), [System.Drawing.Color]::FromArgb(220, 120, 40), 30)
  $g.FillRectangle($brush, $rect)
  $g.Dispose()
  $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $p = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]88)
  $bmp.Save($path, $enc, $p)
  $bmp.Dispose()
  Write-Output "$path $([math]::Round((Get-Item $path).Length/1MB,1)) MB"
}
Make-Photo 6008 4008 "tools/perf/photo-24mp.jpg"
Make-Photo 9504 6336 "tools/perf/photo-60mp.jpg"
