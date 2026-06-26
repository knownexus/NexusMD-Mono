param(
    [ValidateSet('win', 'mac', 'linux')]
    [string]$Platform = 'win'
)

Set-Location $PSScriptRoot

Write-Host "Building Vite renderer..."
npm run build
if ($LASTEXITCODE -ne 0) { Write-Error "Vite build failed"; exit 1 }

Write-Host "Building API sidecar and packaging with electron-builder ($Platform)..."
npm run "build:$Platform"
if ($LASTEXITCODE -ne 0) { Write-Error "electron-builder failed"; exit 1 }

Write-Host "Done. Installer is in dist/desktop/."
