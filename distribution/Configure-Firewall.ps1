#Requires -Version 5.1
[CmdletBinding()]
param(
  [ValidateSet('Ensure', 'Apply', 'Remove')]
  [string]$Mode = 'Ensure',
  [Parameter(Mandatory = $true)]
  [string]$NodePath
)

$ErrorActionPreference = 'Stop'
$allowRule = 'Foreningskiosken TCP (Private)'
$blockRule = 'Foreningskiosken TCP (Public block)'
$legacyAllowRule = 'Foreningskiosken TCP 3000 (Private)'
$legacyBlockRule = 'Foreningskiosken TCP 3000 (Public block)'
$resolvedNode = [IO.Path]::GetFullPath($NodePath)

function Test-Rule([string]$Name, [string]$Action, [string]$Profile) {
  $rule = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
  if (@($rule).Count -ne 1) { return $false }
  $application = $rule | Get-NetFirewallApplicationFilter
  $port = $rule | Get-NetFirewallPortFilter
  return $rule.Enabled -eq 'True' -and
    $rule.Direction -eq 'Inbound' -and
    $rule.Action -eq $Action -and
    $rule.Profile -eq $Profile -and
    $application.Program -eq $resolvedNode -and
    $port.Protocol -eq 'TCP' -and
    $port.LocalPort -eq 'Any'
}

function Test-AllRules {
  return (Test-Rule $allowRule 'Allow' 'Private') -and (Test-Rule $blockRule 'Block' 'Public')
}

function Remove-Rules {
  @($allowRule, $blockRule, $legacyAllowRule, $legacyBlockRule) | ForEach-Object {
    Get-NetFirewallRule -DisplayName $_ -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  }
}

if ($Mode -eq 'Remove') {
  Remove-Rules
  exit 0
}

if ($Mode -eq 'Ensure' -and (Test-AllRules)) { exit 0 }

if ($Mode -eq 'Ensure') {
  $arguments = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"",
    '-Mode', 'Apply', '-NodePath', "`"$resolvedNode`""
  )
  try {
    $process = Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments -Wait -PassThru
    exit $process.ExitCode
  } catch {
    exit 1
  }
}

Remove-Rules
New-NetFirewallRule -DisplayName $allowRule -Direction Inbound -Action Allow -Enabled True `
  -Profile Private -Protocol TCP -Program $resolvedNode | Out-Null
New-NetFirewallRule -DisplayName $blockRule -Direction Inbound -Action Block -Enabled True `
  -Profile Public -Protocol TCP -Program $resolvedNode | Out-Null

if (-not (Test-AllRules)) { throw 'Brandväggsreglerna kunde inte verifieras.' }
