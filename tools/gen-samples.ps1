# Renders template samples with per-category demo photos (v0.4.0):
#   samples/<id>.jpg   900px  (site wall + golden visual reference)
#   previews/<id>.jpg  640px  (wall cards + in-app Lightbox)
#   thumbs/<id>.jpg    240px  (picker grid)
# Photos: real photography via Lorem Picsum (Unsplash License) — landscape,
# architecture, street, mist, dusk city, portrait, people, square.
# Usage: pwsh tools/gen-samples.ps1   (run from repo root)
$ErrorActionPreference = "Continue"
$cliName = if ($IsWindows -or $env:OS -eq "Windows_NT") { "framegeist.exe" } else { "framegeist" }
$cli = if (Test-Path "target/release/$cliName") { "target/release/$cliName" }
       elseif (Test-Path "target/debug/$cliName") { "target/debug/$cliName" }
       else { cargo build --release -p framegeist-cli; "target/release/$cliName" }

$photoDir = "templates/assets/photos"
$landscape = @("$photoDir/landscape-1.jpg", "$photoDir/landscape-2.jpg", "$photoDir/landscape-3.jpg")
$architecture = @("$photoDir/architecture-1.jpg", "$photoDir/architecture-2.jpg")
$portrait = @("$photoDir/portrait-1.jpg")
$people = @("$photoDir/people-1.jpg")
$street = @("$photoDir/street-1.jpg")
$mist = @("$photoDir/mist-1.jpg")
$night = @("$photoDir/night-1.jpg")
$square = @("$photoDir/square-1.jpg")
if (-not (Test-Path $landscape[0])) {
  Write-Error "demo photos missing: run 'node tools/fetch-demo-photos.mjs' first"
  exit 1
}

$categoryPhotos = @{
  "white-border"      = $architecture
  "camera"            = $street
  "phone"             = $portrait
  "drone"             = $landscape
  "fuji"              = $landscape
  "film"              = $landscape
  "colorwalk"         = $architecture
  "colorful"          = $square
  "classic-watermark" = $architecture
  "portfolio"         = $mist
  "black-frame"       = $mist
  "sports"            = $landscape
  "calendar"          = $architecture
  "magazine"          = $people
  "minimal"           = $landscape
  "borderless"        = $people
  "master"            = $architecture
  "personal"          = $portrait
  "polaroid"          = $portrait
  "festival"          = $square
  "effect"            = $night
  "colorcard"         = $square
  "blur-bg"           = $night
  "ticket"            = $street
}
$gamePhotos = @{
  "genshin"   = $landscape
  "zzz"       = $architecture
  "honkai"    = $architecture
  "arknights" = $architecture
  "wwmeet"    = $landscape
  "wukong"    = $landscape
}

foreach ($dir in @("templates/samples", "templates/previews", "templates/thumbs")) {
  New-Item -ItemType Directory -Force $dir | Out-Null
  Get-ChildItem $dir -Filter *.jpg -ErrorAction SilentlyContinue | Remove-Item -Force
}

$ids = & $cli templates | ForEach-Object { ($_ -split "`t")[0] }
$done = 0; $failed = @(); $i = 0
foreach ($id in $ids) {
  $photo = $null
  foreach ($cat in $categoryPhotos.Keys) {
    if ($id -like "$cat-*") { $photo = $categoryPhotos[$cat]; break }
  }
  if (-not $photo -and $id -like "game-*") {
    foreach ($g in $gamePhotos.Keys) {
      if ($id -like "game-$g-*") { $photo = $gamePhotos[$g]; break }
    }
  }
  if (-not $photo) { $photo = $landscape }
  $photoRotated = $photo[$i % $photo.Count]

  & $cli render $photoRotated --template $id --max-edge 900 -o "templates/samples/$id.jpg" 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { $done++ } else { $failed += $id }
  & $cli render $photoRotated --template $id --max-edge 640 -o "templates/previews/$id.jpg" 2>&1 | Out-Null
  & $cli render $photo[0] --template $id --max-edge 240 -o "templates/thumbs/$id.jpg" 2>&1 | Out-Null
  $i++
}
Write-Output "rendered=$done failed=$($failed.Count)"
if ($failed.Count -gt 0) { Write-Output $failed; exit 1 }

foreach ($pair in @(@("thumbs", "web/thumbs"), @("previews", "web/previews"))) {
  New-Item -ItemType Directory -Force $pair[1] | Out-Null
  Get-ChildItem $pair[1] -Filter *.jpg -ErrorAction SilentlyContinue | Remove-Item -Force
  Copy-Item "templates/$($pair[0])/*.jpg" "$($pair[1])/" -Force
}
Write-Output "thumbs + previews mirrored to web/"
