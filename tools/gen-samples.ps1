# Renders template samples (rotating the 4 public-domain demo photos) and
# normalized thumbnails. Derived artifacts: gitignored except web/thumbs.
# Usage: pwsh tools/gen-samples.ps1   (run from repo root)
$ErrorActionPreference = "Stop"
$cliName = if ($IsWindows -or $env:OS -eq "Windows_NT") { "framegeist.exe" } else { "framegeist" }
$cli = if (Test-Path "target/release/$cliName") { "target/release/$cliName" }
       elseif (Test-Path "target/debug/$cliName") { "target/debug/$cliName" }
       else { cargo build --release -p framegeist-cli; "target/release/$cliName" }

$photos = @("landscape", "portrait", "square", "night") | ForEach-Object { "templates/assets/photos/$_.jpg" }
if (-not (Test-Path $photos[0])) {
  Write-Error "demo photos missing: run 'node tools/fetch-pd-photos.mjs' first"
  exit 1
}

New-Item -ItemType Directory -Force templates/samples | Out-Null
Get-ChildItem templates/samples -Filter *.jpg -ErrorAction SilentlyContinue | Remove-Item -Force
New-Item -ItemType Directory -Force templates/thumbs | Out-Null
Get-ChildItem templates/thumbs -Filter *.jpg -ErrorAction SilentlyContinue | Remove-Item -Force

$ids = & $cli templates | ForEach-Object { ($_ -split "`t")[0] }
$done = 0; $failed = @(); $i = 0
foreach ($id in $ids) {
  $photo = $photos[$i % $photos.Count]
  & $cli render $photo --template $id --max-edge 900 -o "templates/samples/$id.jpg" 2>$null
  if ($LASTEXITCODE -eq 0) { $done++ } else { $failed += $id }
  & $cli render $photos[0] --template $id --max-edge 240 -o "templates/thumbs/$id.jpg" 2>$null
  $i++
}
Write-Output "rendered=$done failed=$($failed.Count)"
if ($failed.Count -gt 0) { Write-Output $failed; exit 1 }

New-Item -ItemType Directory -Force web/thumbs | Out-Null
Get-ChildItem web/thumbs -Filter *.jpg -ErrorAction SilentlyContinue | Remove-Item -Force
Copy-Item templates/thumbs/*.jpg web/thumbs/ -Force
Write-Output "thumbs mirrored to web/thumbs"
