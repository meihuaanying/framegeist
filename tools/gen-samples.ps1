# Renders template samples using the v0.5.0 per-template showcase photos.
# Thin wrapper kept for CI compatibility (pages.yml); real logic in Node:
#   node tools/gen-samples.mjs
# Usage: pwsh tools/gen-samples.ps1
node tools/gen-samples.mjs @args
exit $LASTEXITCODE
