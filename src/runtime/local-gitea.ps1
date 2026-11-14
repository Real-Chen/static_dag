param(
    [Parameter(Mandatory=$true)][string]$DataRoot,
    [Parameter(Mandatory=$true)][string]$BinaryPath,
    [Parameter(Mandatory=$true)][string]$ExpectedHash,
    [string]$Action = 'start'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$OutputEncoding = [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
function New-Secret {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}
function Invoke-Gitea([string[]]$Arguments) {
    # Windows PowerShell treats native stderr INFO logs as error records.
    # Capture streams separately so --raw token stdout remains private and exact.
    $previousAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $result = & $script:executable @Arguments --work-path $DataRoot --config $script:ini 2>(Join-Path $DataRoot 'log\bootstrap.log')
        $nativeCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousAction }
    if ($nativeCode -ne 0) {
        throw 'Gitea initialization failed; see the local runtime log/bootstrap.log.'
    }
    return (($result | ForEach-Object { "$_" }) -join "`n").Trim()
}
$DataRoot = [IO.Path]::GetFullPath($DataRoot)
$hashAlgorithm = [Security.Cryptography.SHA256]::Create()
try { $lockKey = ([BitConverter]::ToString($hashAlgorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($DataRoot.ToLowerInvariant())))).Replace('-', '') }
finally { $hashAlgorithm.Dispose() }
$mutex = New-Object Threading.Mutex($false, ('Local\DevecoDAG-' + $lockKey))
$held = $false
try {
    try { $held = $mutex.WaitOne(120000) } catch [Threading.AbandonedMutexException] { $held = $true }
    if (!$held) { throw 'Another OpenCode process is initializing the local Gitea service. Try again shortly.' }
    $null = New-Item -ItemType Directory -Path $DataRoot -Force
    # Protect all credentials, SQLite files and repositories for this Windows user.
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($identity.User); $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($identity.User, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $null = $acl.AddAccessRule($rule)
    }
    [IO.Directory]::SetAccessControl($DataRoot, $acl)
    foreach ($sub in @('bin','secrets','data','log','custom\conf')) { $null = New-Item -ItemType Directory -Path (Join-Path $DataRoot $sub) -Force }
    $script:executable = Join-Path $DataRoot 'bin\gitea.exe'
    $script:ini = Join-Path $DataRoot 'custom\conf\app.ini'
    $metadataFile = Join-Path $DataRoot 'runtime.json'
    $metadata = if (Test-Path -LiteralPath $metadataFile) { Get-Content -LiteralPath $metadataFile -Raw | ConvertFrom-Json } else { $null }
    $running = $false
    if ($metadata -and $metadata.pid) {
        $serviceProcess = Get-Process -Id $metadata.pid -ErrorAction SilentlyContinue
        if ($serviceProcess -and $serviceProcess.Path -eq $executable) {
            try { $null = Invoke-WebRequest ($metadata.url + '/user/login') -UseBasicParsing -TimeoutSec 2; $running = $true } catch {}
        }
    }
    if ($Action -eq 'status') {
        @{running=$running; url=$metadata.url; dataRoot=$DataRoot; pid=$metadata.pid} | ConvertTo-Json -Compress
        exit 0
    }
    if (!$running) {
        if ((Get-FileHash -LiteralPath $BinaryPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedHash) { throw 'Bundled Gitea checksum mismatch.' }
        if (!(Test-Path -LiteralPath $executable) -or (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedHash) {
            Copy-Item -LiteralPath $BinaryPath -Destination $executable -Force
        }
        $port = if ($metadata) { [int]([uri]$metadata.url).Port } else { 0 }
        $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $port)
        try { $listener.Start(); $port = $listener.LocalEndpoint.Port } finally { $listener.Stop() }
        $url = 'http://127.0.0.1:' + $port
        if (!(Test-Path -LiteralPath $ini)) {
            $rootPath = $DataRoot.Replace('\','/')
            @"
APP_NAME = DevEco DAG Local Gitea
RUN_USER = $env:USERNAME
RUN_MODE = prod
WORK_PATH = $rootPath
[database]
DB_TYPE = sqlite3
PATH = $rootPath/data/gitea.db
[repository]
ROOT = $rootPath/data/repositories
DEFAULT_PRIVATE = private
DEFAULT_BRANCH = main
[server]
DOMAIN = 127.0.0.1
HTTP_ADDR = 127.0.0.1
HTTP_PORT = $port
ROOT_URL = $url/
APP_DATA_PATH = $rootPath/data
DISABLE_SSH = true
LFS_START_SERVER = false
OFFLINE_MODE = true
[security]
INSTALL_LOCK = true
SECRET_KEY = $(New-Secret)
INTERNAL_TOKEN = $(New-Secret)
[service]
DISABLE_REGISTRATION = true
REQUIRE_SIGNIN_VIEW = true
ENABLE_NOTIFY_MAIL = false
[mailer]
ENABLED = false
[actions]
ENABLED = false
[oauth2]
JWT_SECRET = $(New-Secret)
[log]
MODE = file
LEVEL = Info
ROOT_PATH = $rootPath/log
"@ | Set-Content -LiteralPath $ini -Encoding utf8
        }
        # Save the chosen port before starting; never silently retarget old Git remotes.
        @{url=$url; pid=0; version='28.3.0'} | ConvertTo-Json -Compress | Set-Content -LiteralPath $metadataFile -Encoding utf8
        $null = Invoke-Gitea -Arguments @('migrate')
        $accountFile = Join-Path $DataRoot 'secrets\account.xml'
        if (!(Test-Path -LiteralPath $accountFile)) {
            $password = (New-Secret) + '!aA1'
            $credential = New-Object System.Management.Automation.PSCredential('dag-agent', (ConvertTo-SecureString $password -AsPlainText -Force))
            # Save before the CLI so interrupted provisioning can inspect the same identity.
            $credential | Export-Clixml -LiteralPath $accountFile
        }
        $credential = Import-Clixml -LiteralPath $accountFile
        $users = Invoke-Gitea -Arguments @('admin','user','list')
        if ($users -notmatch '(?m)\bdag-agent\b') {
            $null = Invoke-Gitea -Arguments @('admin','user','create','--username','dag-agent','--email','dag-agent@localhost.invalid','--password',$credential.GetNetworkCredential().Password,'--must-change-password=false')
        }
        $tokenFile = Join-Path $DataRoot 'secrets\token.xml'
        if (!(Test-Path -LiteralPath $tokenFile)) {
            $token = Invoke-Gitea -Arguments @('admin','user','generate-access-token','--username','dag-agent','--token-name',('dag-runtime-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()),'--scopes','write:repository,write:user','--raw')
            if ($token -notmatch '^[a-fA-F0-9]{40,128}$') { throw 'Gitea did not return a valid API token.' }
            $credential = New-Object System.Management.Automation.PSCredential('dag-agent', (ConvertTo-SecureString $token -AsPlainText -Force))
            $credential | Export-Clixml -LiteralPath $tokenFile
        }
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'git-credential.ps1') -Destination (Join-Path $DataRoot 'git-credential.ps1') -Force
        $serviceProcess = Start-Process -FilePath $executable -ArgumentList @('web','--work-path',('"' + $DataRoot + '"'),'--config',('"' + $ini + '"')) -WorkingDirectory $DataRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $DataRoot 'log\stdout.log') -RedirectStandardError (Join-Path $DataRoot 'log\stderr.log') -PassThru
        @{url=$url; pid=$serviceProcess.Id; version='28.3.0'} | ConvertTo-Json -Compress | Set-Content -LiteralPath $metadataFile -Encoding utf8
        $ready = $false
        for ($attempt=0; $attempt -lt 60; $attempt++) {
            if ($serviceProcess.HasExited) { break }
            try { $null = Invoke-WebRequest ($url + '/user/login') -UseBasicParsing -TimeoutSec 2; $ready=$true; break } catch { Start-Sleep -Milliseconds 300 }
        }
        if (!$ready) { throw 'Local Gitea did not become ready; inspect its log directory.' }
        $metadata = Get-Content -LiteralPath $metadataFile -Raw | ConvertFrom-Json
    }
    $credential = Import-Clixml -LiteralPath (Join-Path $DataRoot 'secrets\token.xml')
    @{url=$metadata.url; owner=$credential.UserName; token=$credential.GetNetworkCredential().Password; dataRoot=$DataRoot; pid=$metadata.pid} | ConvertTo-Json -Compress
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    if ($held) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
