param(
    [string]$Serial = 'emulator-5554',
    [Parameter(Mandatory = $true)][string]$OutDir,
    [switch]$Record
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$adbCommand = Get-Command adb -ErrorAction SilentlyContinue
$adbExe = if ($adbCommand) { $adbCommand.Source } else { Join-Path $env:LOCALAPPDATA 'Android/Sdk/platform-tools/adb.exe' }
if (!(Test-Path -LiteralPath $adbExe)) { throw 'Android SDK platform-tools/adb.exe is required.' }
function Invoke-Adb {
    $result = & $adbExe -s $Serial @args
    if ($LASTEXITCODE -ne 0) { throw "adb failed: $args" }
    return $result
}
function Get-IslandFrame([string]$Title = 'LuvLyrics island') {
    $windows = (Invoke-Adb shell dumpsys window windows) -join "`n"
    $name = [regex]::Escape($Title)
    $block = [regex]::Match($windows, "(?s)Window #\d+ Window\{[^\n]* u0 $name\}:(.*?)(?=\n\s*Window #|\z)").Groups[1].Value
    $frame = [regex]::Match($block, 'mAttrs=\{\((-?\d+),(-?\d+)\)\((\d+)x(\d+)\)')
    if (!$frame.Success) { throw "No '$Title' window. Enable the LuvLyrics island accessibility service and Show the island." }
    return @{ x = [int]$frame.Groups[1].Value; width = [int]$frame.Groups[3].Value; height = [int]$frame.Groups[4].Value }
}

# Read attached windows rather than a debug-only (or stale) geometry log, so the release APK is testable too.
$touchFrame = Get-IslandFrame 'LuvLyrics island touch'
$drawingFrame = Get-IslandFrame
$densityMatches = [regex]::Matches(((Invoke-Adb shell wm density) -join "`n"), '(?:Physical|Override) density:\s*(\d+)')
$sizeMatches = [regex]::Matches(((Invoke-Adb shell wm size) -join "`n"), '(?:Physical|Override) size:\s*(\d+)x(\d+)')
if (!$densityMatches.Count -or !$sizeMatches.Count) { throw 'Could not read the display size and density.' }
$density = [int]$densityMatches[$densityMatches.Count - 1].Groups[1].Value / 160.0
$screenHeight = [int]$sizeMatches[$sizeMatches.Count - 1].Groups[2].Value
$anchor = $touchFrame.x + $touchFrame.width / 2.0
# The right side clears the camera; twenty dp above the window's bottom is inside the resting pill.
$tapX = [int]($touchFrame.x + $touchFrame.width * 0.84)
$tapY = [int][Math]::Max(1, $touchFrame.height - 20 * $density)
$outsideY = [int][Math]::Min($screenHeight - 64 * $density, $drawingFrame.height + 80 * $density)
$baseline = $null
$frames = [Collections.Generic.List[object]]::new()
function Assert-Stable([string]$State) {
    $frame = Get-IslandFrame
    $frames.Add(@{ state = $State; x = $frame.x; width = $frame.width; height = $frame.height })
    if ($frame.x -ne $baseline.x -or $frame.width -ne $baseline.width) {
        throw "Horizontal drawing frame moved during $State"
    }
    if ([Math]::Abs($frame.x + $frame.width / 2 - $anchor) -gt 1) { throw 'Drawing frame is not centred on the camera anchor.' }
    if ($State -like 'expanded*' -and $frame.height -le $baseline.height + 20 * $density) {
        throw "The card did not expand during $State"
    }
    if ($State -like 'collapsed*' -and [Math]::Abs($frame.height - $baseline.height) -gt 2) {
        throw "The card did not finish closing during $State"
    }
}

$recording = $null
$remoteVideo = '/sdcard/luvlyrics-island-' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmss') + '.mp4'
try {
    Invoke-Adb shell input keyevent KEYCODE_HOME | Out-Null
    Invoke-Adb shell input tap ([int]$anchor) $outsideY | Out-Null
    Invoke-Adb shell input keyevent KEYCODE_HOME | Out-Null
    Start-Sleep -Milliseconds 1200
    $baseline = Get-IslandFrame
    if ($Record) {
        $recording = Start-Process -FilePath $adbExe -WindowStyle Hidden -PassThru -ArgumentList @(
            '-s', $Serial, 'shell', 'screenrecord', '--size', '720x1600', '--bit-rate', '4000000', '--time-limit', '18', $remoteVideo
        )
    }
    Assert-Stable 'collapsed before cycles'
    for ($cycle = 1; $cycle -le 3; $cycle++) {
        Invoke-Adb shell input tap $tapX $tapY | Out-Null
        Start-Sleep -Milliseconds 100
        Assert-Stable "opening $cycle"
        Start-Sleep -Milliseconds 900
        Assert-Stable "expanded $cycle"
        if ($cycle -eq 1) {
            Invoke-Adb shell screencap -p /sdcard/luvlyrics-island-expanded.png | Out-Null
            Invoke-Adb pull /sdcard/luvlyrics-island-expanded.png (Join-Path $OutDir 'glow-expanded.png') | Out-Null
        }
        $expandedHeight = $frames[$frames.Count - 1].height
        $outsideY = [int][Math]::Min($screenHeight - 64 * $density, $expandedHeight + 80 * $density)
        Invoke-Adb shell input tap ([int]$anchor) $outsideY | Out-Null
        Start-Sleep -Milliseconds 100
        Assert-Stable "closing $cycle"
        Start-Sleep -Milliseconds 1100
        Assert-Stable "collapsed $cycle"
    }
    Write-Output 'PASS: drawing surface x and width remain fixed through three open/close cycles.'
} finally {
    $frames | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutDir 'motion-frames.json')
    if ($recording) {
        if (!$recording.WaitForExit(30000)) { throw 'Screen recording did not finish.' }
        Invoke-Adb pull $remoteVideo (Join-Path $OutDir 'island-motion.mp4') | Out-Null
    }
}
