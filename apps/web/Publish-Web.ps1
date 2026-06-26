Set-Location "$PSScriptRoot\NexusMD-Web"

Write-Host "Publishing NexusMD Web (Release)..."
dotnet publish -c Release -o "$PSScriptRoot\..\dist\web"
if ($LASTEXITCODE -ne 0) { Write-Error "dotnet publish failed"; exit 1 }

Write-Host "Done. Output is in dist/web/."
