#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
try {
  $categories = @(Get-NetConnectionProfile |
    Where-Object { $_.IPv4Connectivity -ne 'Disconnected' } |
    ForEach-Object { $_.NetworkCategory.ToString() })
  if ($categories -contains 'Private') {
    Write-Output '0.0.0.0'
  } else {
    Write-Output '127.0.0.1'
  }
} catch {
  # Säkert standardläge om Windows inte kan läsa nätverksprofilen.
  Write-Output '127.0.0.1'
}
