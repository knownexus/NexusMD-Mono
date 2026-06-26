Set-Location $PSScriptRoot
Write-Host "Building frontend..."
npm run build
if ($LASTEXITCODE -ne 0) { Write-Error "Vite build failed"; exit 1 }

Write-Host "Starting backend..."
Set-Location "$PSScriptRoot\NexusMD-Web"
dotnet run
