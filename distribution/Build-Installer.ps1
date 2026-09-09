#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$IsccPath,
  [switch]$SkipPortableBuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
if (-not $SkipPortableBuild) { & (Join-Path $PSScriptRoot 'Build-Portable.ps1') }

if (-not $IsccPath) {
  $iscc = Get-Command ISCC.exe, iscc -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($iscc) { $IsccPath = $iscc.Source }
}
if (-not $IsccPath) {
  $candidates = @(
    (Join-Path $PSScriptRoot '.cache\inno-7.1.0\ISCC.exe'),
    "$env:ProgramFiles\Inno Setup 7\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
  )
  $IsccPath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $IsccPath) {
  throw 'Inno Setup saknas. Installera Inno Setup från https://jrsoftware.org/isdl.php och kör pnpm run dist:installer igen.'
}

& $IsccPath (Join-Path $PSScriptRoot 'Foreningskiosken.iss')
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup kunde inte bygga installeraren.' }
Write-Host "Installerare skapad: $(Join-Path $projectRoot 'dist-installer\Foreningskiosken-Setup.exe')"
