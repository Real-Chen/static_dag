param([string]$Operation)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = $PSHOME + '\Modules'
$OutputEncoding = [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
if ($Operation -ne 'get') { exit 0 }
try {
    $credential = Import-Clixml -LiteralPath (Join-Path $PSScriptRoot 'secrets\token.xml')
    Write-Output ('username=' + $credential.UserName)
    Write-Output ('password=' + $credential.GetNetworkCredential().Password)
    Write-Output ''
} catch { exit 1 }
