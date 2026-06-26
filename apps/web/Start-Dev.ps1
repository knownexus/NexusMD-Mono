$viteJob = Start-Job -ScriptBlock {
    Set-Location $using:PSScriptRoot
    npm run dev
}

$dotnetJob = Start-Job -ScriptBlock {
    Set-Location "$using:PSScriptRoot\NexusMD-Web"
    dotnet run
}

Write-Host "NexusMD Web dev started. Press Ctrl+C to stop."

try {
    while ($true) {
        if ($viteJob.State -eq 'Failed' -or $dotnetJob.State -eq 'Failed') {
            Write-Host "A process failed. Stopping..."
            break
        }
        Start-Sleep -Seconds 1
    }
}
finally {
    Stop-Job $viteJob, $dotnetJob -ErrorAction SilentlyContinue
    Remove-Job $viteJob, $dotnetJob -ErrorAction SilentlyContinue
    Write-Host "Stopped."
}
