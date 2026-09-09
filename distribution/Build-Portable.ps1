#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$OutputDirectory,
  [string]$NodeVersion = '24.20.0',
  [string]$NodeExecutable,
  [switch]$SkipFrontendBuild
)

$ErrorActionPreference = 'Stop'

function Get-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '')
  } finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

$projectRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'dist-portable' }
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
$projectPrefix = $projectRoot.TrimEnd('\') + '\'
if (-not $outputPath.StartsWith($projectPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'OutputDirectory måste ligga inne i projektmappen.'
}

if (-not $SkipFrontendBuild) {
  $packageManager = Get-Command pnpm.cmd, pnpm -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $packageManager) { throw 'pnpm krävs på byggdatorn för att bygga frontend.' }
  Push-Location $projectRoot
  try {
    & $packageManager.Source --dir frontend run build
    if ($LASTEXITCODE -ne 0) { throw 'Produktionsbygget av frontend misslyckades.' }
  } finally { Pop-Location }
}

$frontendDist = Join-Path $projectRoot 'frontend\dist'
if (-not (Test-Path (Join-Path $frontendDist 'index.html'))) {
  throw 'frontend\dist saknas. Kör produktionsbygget först.'
}
if (Test-Path -LiteralPath (Join-Path $frontendDist 'swish')) {
  throw 'frontend\dist innehåller den borttagna statiska Swish-katalogen.'
}
$frontendText = Get-ChildItem -LiteralPath $frontendDist -Recurse -File |
  Where-Object { $_.Extension -in '.css', '.html', '.js' } |
  ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }
if (($frontendText -join "`n") -match '(?i)svenskalag\.se|url\(\s*["'']?https?://|(?:src|href)\s*=\s*["'']https?://') {
  throw 'Frontendbygget innehåller en extern webbresurs.'
}

if (Test-Path -LiteralPath $outputPath) { Remove-Item -LiteralPath $outputPath -Recurse -Force }
$runtimePath = New-Item -ItemType Directory -Path (Join-Path $outputPath 'runtime') -Force
$serverPath = New-Item -ItemType Directory -Path (Join-Path $outputPath 'app\server') -Force
$frontendPath = New-Item -ItemType Directory -Path (Join-Path $outputPath 'app\frontend\dist') -Force
$dataPath = New-Item -ItemType Directory -Path (Join-Path $outputPath 'data') -Force

if ($NodeExecutable) {
  $resolvedNode = (Resolve-Path -LiteralPath $NodeExecutable).Path
  Copy-Item -LiteralPath $resolvedNode -Destination (Join-Path $runtimePath 'node.exe')
} else {
  $cachePath = New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot ".cache\node-v$NodeVersion-win-x64") -Force
  $resolvedNode = Join-Path $cachePath 'node.exe'
  $checksumPath = Join-Path $cachePath 'SHASUMS256.txt'
  $licensePath = Join-Path $cachePath 'NODE-LICENSE.txt'
  $baseUrl = "https://nodejs.org/dist/v$NodeVersion"
  if (-not (Test-Path -LiteralPath $resolvedNode)) {
    Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/win-x64/node.exe" -OutFile $resolvedNode
  }
  if (-not (Test-Path -LiteralPath $checksumPath)) {
    Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/SHASUMS256.txt" -OutFile $checksumPath
  }
  if (-not (Test-Path -LiteralPath $licensePath)) {
    Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/nodejs/node/v$NodeVersion/LICENSE" -OutFile $licensePath
  }
  $checksums = Get-Content -LiteralPath $checksumPath -Raw
  $match = [regex]::Match($checksums, '(?m)^([a-fA-F0-9]{64})  win-x64/node\.exe\r?$')
  if (-not $match.Success) { throw 'Kunde inte hitta Node-runtimefilens checksumma.' }
  $actualHash = Get-Sha256 $resolvedNode
  if ($actualHash -ne $match.Groups[1].Value) { throw 'Node-runtimefilens SHA-256 stämmer inte.' }
  Copy-Item -LiteralPath $resolvedNode -Destination (Join-Path $runtimePath 'node.exe')
  Copy-Item -LiteralPath $licensePath -Destination (Join-Path $runtimePath 'NODE-LICENSE.txt')
}

$runtimeVersion = & (Join-Path $runtimePath 'node.exe') -p 'process.versions.node'
$runtimeArch = & (Join-Path $runtimePath 'node.exe') -p 'process.arch'
if ([version]$runtimeVersion -ne [version]$NodeVersion) {
  throw "Node-runtime måste vara version $NodeVersion, men $runtimeVersion hittades."
}
if ($runtimeArch -ne 'x64') { throw "Node-runtime måste vara x64, men $runtimeArch hittades." }
if ($NodeExecutable) {
  $providedLicense = Join-Path (Split-Path $resolvedNode -Parent) 'NODE-LICENSE.txt'
  if (Test-Path -LiteralPath $providedLicense) {
    Copy-Item -LiteralPath $providedLicense -Destination (Join-Path $runtimePath 'NODE-LICENSE.txt')
  } else {
    Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/nodejs/node/v$runtimeVersion/LICENSE" `
      -OutFile (Join-Path $runtimePath 'NODE-LICENSE.txt')
  }
}

Copy-Item -LiteralPath (Join-Path $projectRoot 'server\package.json') -Destination $serverPath
Copy-Item -LiteralPath (Join-Path $projectRoot 'server\src') -Destination $serverPath -Recurse
Copy-Item -Path (Join-Path $frontendDist '*') -Destination $frontendPath -Recurse
$launcherName = 'Starta F' + [char]0x00F6 + 'reningskiosken.cmd'
$launcherTemplate = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'portable\Starta-Foreningskiosken.cmd.template') -Raw
$launcherContent = $launcherTemplate -replace "`r?`n", "`r`n"
[IO.File]::WriteAllText((Join-Path $outputPath $launcherName), $launcherContent, [Text.Encoding]::ASCII)
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Configure-Firewall.ps1') -Destination $outputPath
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Select-BindHost.ps1') -Destination $outputPath
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'assets\foreningskiosken.ico') -Destination (Join-Path $outputPath 'Foreningskiosken.ico')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'portable\README.txt') -Destination $outputPath
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination (Join-Path $outputPath 'LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'portable\data\README.txt') -Destination $dataPath

$databaseFiles = Get-ChildItem -LiteralPath $outputPath -Recurse -File | Where-Object { $_.Name -match '\.db(?:-shm|-wal)?$' }
if ($databaseFiles) { throw 'Distributionspaketet innehåller oväntat en SQLite-databas.' }
$forbiddenFiles = Get-ChildItem -LiteralPath $outputPath -Recurse -File | Where-Object {
  $_.Name -in 'package-lock.json', 'pnpm-lock.yaml' -or $_.Extension -eq '.map'
}
if ($forbiddenFiles) { throw 'Distributionspaketet innehåller en utvecklings- eller låsfil.' }
$forbiddenDirectories = Get-ChildItem -LiteralPath $outputPath -Recurse -Directory | Where-Object {
  $_.Name -in 'node_modules', 'test', 'tests', 'swish'
}
if ($forbiddenDirectories) { throw 'Distributionspaketet innehåller en förbjuden utvecklings- eller Swish-katalog.' }

$fileCount = (Get-ChildItem -LiteralPath $outputPath -Recurse -File).Count
Write-Host "Portabel distribution skapad: $outputPath"
Write-Host "Node-runtime: $runtimeVersion ($runtimeArch)"
Write-Host "Filer: $fileCount"
