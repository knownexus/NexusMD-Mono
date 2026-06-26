$viteJob = Start-Job -ScriptBlock {
    Set-Location $using:PSScriptRoot
    npm run dev
}

Write-Host "Waiting for Vite renderer..."
Start-Sleep -Seconds 3

$electronJob = Start-Job -ScriptBlock {
    Set-Location $using:PSScriptRoot
    npm run start
}

Write-Host "NexusMD Desktop dev started. Press Ctrl+C to stop."

try {
    while ($true) {
        if ($viteJob.State -eq 'Failed' -or $electronJob.State -eq 'Failed') {
            Write-Host "A process failed. Stopping..."
            break
        }
        Start-Sleep -Seconds 1
    }
}
finally {
    Stop-Job $viteJob, $electronJob -ErrorAction SilentlyContinue
    Remove-Job $viteJob, $electronJob -ErrorAction SilentlyContinue
    Write-Host "Stopped."
}
