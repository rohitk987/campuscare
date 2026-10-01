param([string]$Serial = 'emulator-5554')

# Run after starting the local CampusCare backend on port 5173 and an Android emulator.
# The coordinates are synthetic test fixtures, not a real organisation's boundary.
$ErrorActionPreference = 'Stop'
$adbPath = (Get-Command adb -ErrorAction Stop).Source
$state = & $adbPath -s $Serial get-state
if ($LASTEXITCODE -ne 0 -or $state -ne 'device') { throw "Emulator $Serial is not ready." }
if (-not $Serial.StartsWith('emulator-')) { throw 'This fixture runner is for an emulator only.' }
& $adbPath -s $Serial reverse tcp:5173 tcp:5173
if ($LASTEXITCODE -ne 0) { throw 'Could not connect the emulator to the local backend.' }

# Keep readings fresh throughout both location checks; a single geo fix expires.
$gpsJob = Start-Job -ArgumentList $adbPath, $Serial -ScriptBlock {
    param($command, $device)
    while ($true) {
        & $command -s $device emu geo fix 77.5946 12.9716 | Out-Null
        Start-Sleep -Seconds 1
    }
}
$previousSerial = $env:ANDROID_SERIAL
try {
    $env:ANDROID_SERIAL = $Serial
    Push-Location (Split-Path $PSScriptRoot -Parent)
    try {
        & .\gradlew.bat --console=plain :app:connectedDebugAndroidTest
        if ($LASTEXITCODE -ne 0) { throw 'Android instrumentation tests failed; inspect the Gradle test report.' }
    } finally { Pop-Location }
} finally {
    $env:ANDROID_SERIAL = $previousSerial
    Stop-Job $gpsJob
    Remove-Job $gpsJob
}
