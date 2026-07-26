# Richtet den Autostart der HDDatenbank ein.
# Bewusst als Skript zum selbst Ausfuehren: es aendert eine Windows-Einstellung,
# und das soll nicht ungefragt im Hintergrund passieren.
#
#   Rechtsklick auf diese Datei -> "Mit PowerShell ausfuehren"
#   Entfernen:  Unregister-ScheduledTask -TaskName "HDDatenbank" -Confirm:$false

$ErrorActionPreference = 'Stop'

$ordner = Split-Path -Parent $MyInvocation.MyCommand.Path
$skript = Join-Path $ordner 'start-hidden.vbs'

if (-not (Test-Path $skript)) {
    Write-Host "start-hidden.vbs nicht gefunden in $ordner" -ForegroundColor Red
    Read-Host "Enter zum Schliessen"
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js wurde nicht gefunden. Bitte zuerst Node installieren." -ForegroundColor Red
    Read-Host "Enter zum Schliessen"
    exit 1
}

$aktion  = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$skript`"" -WorkingDirectory $ordner
$ausloes = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$option  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName 'HDDatenbank' -Action $aktion -Trigger $ausloes -Settings $option `
    -Description 'Startet die HDDatenbank beim Anmelden und oeffnet das Dashboard.' -Force | Out-Null

Write-Host "Autostart eingerichtet. Beim naechsten Anmelden startet die HDDatenbank automatisch." -ForegroundColor Green
Read-Host "Enter zum Schliessen"
