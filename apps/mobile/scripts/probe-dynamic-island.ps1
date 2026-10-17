param(
    [string]$Serial = 'emulator-5554',
    [Parameter(Mandatory = $true)][string]$OutDir,
    [switch]$Record
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
function Invoke-Adb {
    $result = & adb -s $Serial @args
    if ($LASTEXITCODE -ne 0) { throw "adb failed: $args" }
    return $result
}
function Get-IslandFrame {
    $windows = (Invoke-Adb shell dumpsys window windows) -join "`n"
    $block = [regex]::Match($windows, '(?s)Window #\d+ Window\{[^\n]* u0 LuvLyrics island\}:(.*?)(?=\n\s*Window #|\z)').Groups[1].Value
    $frame = [regex]::Match($block, 'mAttrs=\{\((-?\d+),(-?\d+)\)\((\d+)x(\d+)\)')
    if (!$frame.Success) { throw 'No drawing window. Enable the LuvLyrics island accessibility service and Show the island.' }
    return @{ x = [int]$frame.Groups[1].Value; width = [int]$frame.Groups[3].Value; height = [int]$frame.Groups[4].Value }
}

$windows = (Invoke-Adb shell dumpsys window windows) -join "`n"
if ($windows -notmatch 'LuvLyrics island touch') { throw 'Install a build with the stable drawing surface and compact touch window first.' }
$geometry = ((Invoke-Adb logcat -d -s LyrFlowIsland) | Select-String 'geometry=IslandGeometry' | Select-Object -Last 1).Line
function Read-Geometry([string]$Key) {
    $match = [regex]::Match($geometry, "$Key=([0-9.]+)")
    if (!$match.Success) { throw "Missing $Key in the debug geometry log. Re-enable the service on a debug build." }
    return [double]::Parse($match.Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture)
}
$anchor = Read-Geometry 'anchorX'
$density = Read-Geometry 'density'
$tapX = [int]($anchor + (Read-Geometry 'cameraWidth') / 2 + 12 * $density)
$tapY = [int]((Read-Geometry 'pillTop') + (Read-Geometry 'pillHeight') / 2)
$outsideY = [int]((Read-Geometry 'cardTop') + (Read-Geometry 'cardHeight') + 80 * $density)
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
    Start-Sleep -Milliseconds 1200
    $baseline = Get-IslandFrame
    if ($Record) {
        $recording = Start-Process -FilePath (Get-Command adb).Source -WindowStyle Hidden -PassThru -ArgumentList @(
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
