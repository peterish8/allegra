$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))

$apiPort = 8082
$nextPort = 5174
$gatewayPort = 5175
$outputDirectory = Join-Path (Get-Location) 'output\performance\search-to-play'
$serverLogDirectory = Join-Path $outputDirectory 'server'
New-Item -ItemType Directory -Force -Path $serverLogDirectory | Out-Null

$startedProcesses = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
$oldEnvironment = @{}
foreach ($name in @('NEXT_PUBLIC_PERF_TRACE', 'PERF_BASE_URL', 'PERF_SAMPLES', 'PERF_API_PORT', 'PERF_NEXT_PORT', 'PERF_GATEWAY_PORT', 'PORT', 'ALLEGRA_ORIGIN')) {
  $oldEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

function Test-HttpEndpoint([string] $Uri) {
  try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri $Uri).StatusCode -eq 200 }
  catch { return $false }
}

function Test-Listener([int] $Port) {
  return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue).Count -gt 0
}

function Start-HiddenNpm([string] $Arguments, [string] $Name) {
  $process = Start-Process -FilePath $env:ComSpec `
    -ArgumentList @('/d', '/s', '/c', "npm.cmd $Arguments") `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $serverLogDirectory "$Name.stdout.log") `
    -RedirectStandardError (Join-Path $serverLogDirectory "$Name.stderr.log")
  $startedProcesses.Add($process)
}

function Wait-ForHttp([string] $Uri, [string] $Name) {
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-HttpEndpoint $Uri) { return }
    Start-Sleep -Milliseconds 750
  }
  throw "$Name did not become healthy. Check ignored logs under output/performance/search-to-play/server."
}

try {
  foreach ($port in @($apiPort, $nextPort, $gatewayPort)) {
    if (Test-Listener $port) { throw "Benchmark port $port is occupied; refusing to replace its listener." }
  }

  $env:PORT = [string]$apiPort
  $env:ALLEGRA_ORIGIN = "http://127.0.0.1:$gatewayPort"
  Start-HiddenNpm 'run dev --prefix apps/api' 'api'
  Wait-ForHttp "http://127.0.0.1:$apiPort/api/health" 'Local API'
  $env:PORT = $oldEnvironment.PORT
  $env:ALLEGRA_ORIGIN = $oldEnvironment.ALLEGRA_ORIGIN

  $env:NEXT_PUBLIC_PERF_TRACE = '1'
  & npm.cmd run build --prefix apps/web
  if ($LASTEXITCODE -ne 0) { throw "Production web build failed with exit code $LASTEXITCODE." }

  Start-HiddenNpm "run start --prefix apps/web -- --hostname 127.0.0.1 --port $nextPort" 'web'
  Wait-ForHttp "http://127.0.0.1:$nextPort/" 'Production Next server'

  $env:PERF_API_PORT = [string]$apiPort
  $env:PERF_NEXT_PORT = [string]$nextPort
  $env:PERF_GATEWAY_PORT = [string]$gatewayPort
  $gateway = Start-Process -FilePath 'node.exe' -ArgumentList @('tests/performance/local-vercel-gateway.mjs') `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $serverLogDirectory 'gateway.stdout.log') `
    -RedirectStandardError (Join-Path $serverLogDirectory 'gateway.stderr.log')
  $startedProcesses.Add($gateway)
  $env:PERF_BASE_URL = "http://127.0.0.1:$gatewayPort"
  Wait-ForHttp "$($env:PERF_BASE_URL)/" 'Local Vercel-routing gateway'

  & node tests/performance/verify-local-gateway.mjs
  if ($LASTEXITCODE -ne 0) { throw "Gateway route check failed with exit code $LASTEXITCODE." }

  if (-not $env:PERF_SAMPLES) { $env:PERF_SAMPLES = '20' }
  & .\node_modules\.bin\playwright.cmd test -c tests/performance/playwright.config.ts
  if ($LASTEXITCODE -ne 0) { throw "Web performance Playwright run failed with exit code $LASTEXITCODE." }
} finally {
  foreach ($name in $oldEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($name, $oldEnvironment[$name], 'Process')
  }
  foreach ($process in $startedProcesses) {
    try {
      if (-not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F | Out-Null }
    } catch {
      # Preserve the command result; check only these PIDs if startup was interrupted.
    }
  }
}
