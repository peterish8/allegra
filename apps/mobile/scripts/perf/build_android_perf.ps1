param(
    [string]$OutputPath = ""
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$gradlePath = Join-Path $workspaceRoot 'apps\mobile\android\gradlew.bat'
$jdkPath = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.9.10-hotspot'
$apkDirectory = Join-Path $workspaceRoot 'apps\mobile\android\app\build\outputs\apk\release'
$apkPath = Join-Path $apkDirectory 'app-release.apk'
$artifactDirectory = Join-Path $workspaceRoot 'output\performance\android'
$buildLog = Join-Path $artifactDirectory 'release-build.log'

if (-not $OutputPath) {
    $OutputPath = Join-Path $artifactDirectory 'allegra-android-perf-release.apk'
}
if (-not (Test-Path -LiteralPath $gradlePath -PathType Leaf)) {
    throw 'The Android Gradle wrapper is missing.'
}
if (-not (Test-Path -LiteralPath (Join-Path $jdkPath 'bin\java.exe') -PathType Leaf)) {
    throw 'The configured local JDK 21 installation is missing.'
}

New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $OutputPath) -Force | Out-Null
$backupPath = Join-Path $artifactDirectory 'preexisting-app-release.apk'
$hadExistingApk = Test-Path -LiteralPath $apkPath -PathType Leaf
if ($hadExistingApk) {
    Copy-Item -LiteralPath $apkPath -Destination $backupPath -Force
}

$oldJavaHome = $env:JAVA_HOME
$oldPath = $env:PATH
$oldNodeEnv = $env:NODE_ENV
$oldTraceFlag = $env:EXPO_PUBLIC_PERF_TRACE
$exitCode = 1
try {
    $env:JAVA_HOME = $jdkPath
    $env:PATH = "$jdkPath\bin;$oldPath"
    $env:NODE_ENV = 'production'
    $env:EXPO_PUBLIC_PERF_TRACE = '1'
    Push-Location (Split-Path -Parent $gradlePath)
    try {
        $previousErrorPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & $gradlePath '--no-daemon' '--max-workers=2' '--console=plain' ':app:assembleRelease' '-PreactNativeArchitectures=x86_64' *> $buildLog
            $exitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousErrorPreference
        }
    }
    finally {
        Pop-Location
    }

    if ($exitCode -eq 0 -and (Test-Path -LiteralPath $apkPath -PathType Leaf)) {
        Copy-Item -LiteralPath $apkPath -Destination $OutputPath -Force
        $artifactHash = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash
        Write-Output "Diagnostic APK saved: $OutputPath"
        Write-Output "Diagnostic APK SHA256: $artifactHash"
    }
    elseif ($exitCode -eq 0) {
        $exitCode = 1
        Write-Output 'Gradle succeeded but did not produce the expected release APK.'
    }
    else {
        Write-Output "Gradle exited with code $exitCode; see $buildLog"
    }
}
finally {
    if ($hadExistingApk -and (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
        Copy-Item -LiteralPath $backupPath -Destination $apkPath -Force
        $backupHash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash
        $restoredHash = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash
        if ($backupHash -ne $restoredHash) {
            $exitCode = 1
            Write-Output 'The pre-existing release APK failed its restoration hash check.'
        }
    }
    $env:JAVA_HOME = $oldJavaHome
    $env:PATH = $oldPath
    $env:NODE_ENV = $oldNodeEnv
    $env:EXPO_PUBLIC_PERF_TRACE = $oldTraceFlag
}

exit $exitCode
