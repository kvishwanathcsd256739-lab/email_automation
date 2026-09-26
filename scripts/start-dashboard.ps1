$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$dashboardPort = 3000
$configPath = Join-Path $projectDirectory '.env'
if (Test-Path -LiteralPath $configPath) {
    $portMatch = Select-String -LiteralPath $configPath -Pattern '^PORT=(\d+)$' | Select-Object -First 1
    if ($portMatch) { $dashboardPort = [int]$portMatch.Matches[0].Groups[1].Value }
}
$dashboardUrl = "http://localhost:$dashboardPort"
$probeUrl = "http://127.0.0.1:$dashboardPort/api/auth/session"
try {
    $sessionStatus = Invoke-RestMethod $probeUrl -TimeoutSec 2
    if ($sessionStatus.PSObject.Properties.Name -contains 'authenticated') {
        Write-Output "Mailroom is already running at $dashboardUrl"
        exit 0
    }
} catch { }
$logDirectory = Join-Path $projectDirectory 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$serverPath = Join-Path $projectDirectory 'server.js'
$dashboardProcess = Start-Process -FilePath $nodeExecutable -ArgumentList ('"{0}"' -f $serverPath) -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory 'dashboard.stdout.log') -RedirectStandardError (Join-Path $logDirectory 'dashboard.stderr.log') -PassThru
$dashboardProcess.Id | Set-Content -LiteralPath (Join-Path $logDirectory 'dashboard.pid')
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($dashboardProcess.HasExited) { throw 'Dashboard stopped during startup. Check logs/dashboard.stderr.log.' }
    try {
        $sessionStatus = Invoke-RestMethod $probeUrl -TimeoutSec 1
        if ($sessionStatus.PSObject.Properties.Name -contains 'authenticated') {
            Write-Output "Mailroom is running at $dashboardUrl (PID $($dashboardProcess.Id)). No campaigns were started."
            exit 0
        }
    } catch { }
    Start-Sleep -Milliseconds 250
}
throw 'Dashboard did not become ready. Check logs/dashboard.stderr.log.'
