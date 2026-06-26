param([string]$TargetRid = "win-x64")

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$apiProject = "$scriptDir\..\..\NexusMD-Web\NexusMD-Web\NexusMDWeb.Api.csproj"
$outputDir = "$scriptDir\..\api\$TargetRid"

dotnet publish $apiProject -c Release -r $TargetRid --self-contained true -o $outputDir
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Published to: $outputDir"
