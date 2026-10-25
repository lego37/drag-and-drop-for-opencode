#requires -Version 5.1
<#
.SYNOPSIS
    Closes OpenCode Desktop completely, including tray-only instances.

.DESCRIPTION
    Requests a normal window close first, waits for the app to exit, then
    force-stops any remaining OpenCode.exe processes that belong to the
    installed desktop app. The opencode-cli.exe background service is not
    touched: it is separate from the Electron app and does not lock app.asar.
    The script never starts OpenCode.

.PARAMETER GraceSeconds
    Seconds to wait for a normal close before force-stopping. Default: 8.

.PARAMETER InstallRoot
    OpenCode installation directory. Defaults to the standard Windows install.

.EXAMPLE
    .\close-opencode.ps1

.EXAMPLE
    .\close-opencode.ps1 -WhatIf

.EXAMPLE
    .\close-opencode.ps1 -GraceSeconds 15
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "Medium")]
param(
    [ValidateRange(0, 120)]
    [int]$GraceSeconds = 8,

    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "Programs\@opencodedesktop")
)

$ErrorActionPreference = "Stop"

function Write-Status([string]$Message) {
    Write-Host $Message
}

function Fail([string]$Message) {
    Write-Host $Message -ForegroundColor Red
    exit 1
}

if (-not (Test-Path -LiteralPath $InstallRoot -PathType Container)) {
    Fail "OpenCode install not found: $InstallRoot"
}

$prefix = [System.IO.Path]::GetFullPath($InstallRoot).TrimEnd('\') + '\'

function Get-OpenCodeProcesses {
    @(Get-Process -Name OpenCode -ErrorAction SilentlyContinue | Where-Object {
        $path = $null
        try {
            $path = $_.Path
        }
        catch {
            # A process can exit while its properties are being read.
        }
        $path -and $path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
    })
}

function Show-Processes($Processes) {
    foreach ($process in $Processes) {
        $kind = if ([int64]$process.MainWindowHandle -ne 0) { "window" } else { "background" }
        Write-Host ("  PID {0} ({1})" -f $process.Id, $kind)
    }
}

$processes = Get-OpenCodeProcesses
if ($processes.Count -eq 0) {
    Write-Status "OpenCode is not running. Nothing to close."
    exit 0
}

Write-Status ("OpenCode processes for {0}:" -f $InstallRoot)
Show-Processes $processes

$windows = @($processes | Where-Object { [int64]$_.MainWindowHandle -ne 0 })
foreach ($process in $windows) {
    if ($PSCmdlet.ShouldProcess("PID $($process.Id)", "Request window close")) {
        [void]$process.CloseMainWindow()
    }
}

if ($WhatIfPreference) {
    Write-Status "WhatIf: would wait $GraceSeconds second(s), then force-stop any remaining OpenCode processes."
    exit 0
}

if ($windows.Count -gt 0) {
    Write-Status ("Waiting up to {0} second(s) for OpenCode to exit..." -f $GraceSeconds)
    $deadline = (Get-Date).AddSeconds($GraceSeconds)
    while ((Get-Date) -lt $deadline) {
        if ((Get-OpenCodeProcesses).Count -eq 0) {
            Write-Status "OpenCode is fully closed."
            exit 0
        }
        Start-Sleep -Milliseconds 250
    }
}

for ($attempt = 1; $attempt -le 3; $attempt++) {
    $remaining = Get-OpenCodeProcesses
    if ($remaining.Count -eq 0) {
        break
    }

    if ($attempt -eq 1) {
        Write-Status "Force-stopping remaining OpenCode processes:"
        Show-Processes $remaining
    }

    if ($PSCmdlet.ShouldProcess("OpenCode processes", "Force stop")) {
        Stop-Process -Id $remaining.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 700
}

$left = Get-OpenCodeProcesses
if ($left.Count -gt 0) {
    Fail ("Could not close these OpenCode processes: " + (($left | ForEach-Object { $_.Id }) -join ", "))
}

Write-Status "OpenCode is fully closed."

$service = @(Get-Process -Name opencode-cli -ErrorAction SilentlyContinue)
if ($service.Count -gt 0) {
    Write-Status (
        "Note: opencode-cli.exe background service (PID {0}) was not touched; it does not lock app.asar." -f (
            ($service | ForEach-Object { $_.Id }) -join ", "
        )
    )
}

exit 0
