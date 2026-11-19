param([switch]$Quiet)

$aiDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) '.golden-haven-ai'
$server = Get-ChildItem -LiteralPath (Join-Path $aiDirectory 'llama-cpu') -Filter 'llama-server.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
$models = 'qwen2.5-1.5b-instruct-q4_k_m.gguf', 'qwen2.5-0.5b-instruct-q4_k_m.gguf'
$model = $models | ForEach-Object { Join-Path $aiDirectory $_ } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$server -or !$model) {
    if (!$Quiet) { Write-Host 'Qwen files are missing. The hotel still answers from its service catalog.' }
    return
}

try {
    $localAi = Invoke-RestMethod 'http://127.0.0.1:8189/v1/models' -TimeoutSec 2
    if ($localAi.data.id -contains 'golden-haven-qwen') {
        if (!$Quiet) { Write-Host 'GOLDEN HAVEN Qwen is already running on port 8189.' }
        return
    }
} catch {}

if (Get-NetTCPConnection -LocalPort 8189 -State Listen -ErrorAction SilentlyContinue) {
    if (!$Quiet) { Write-Warning 'Port 8189 is already in use.' }
    return
}

$arguments = @('-m', ('"' + $model + '"'), '--alias', 'golden-haven-qwen', '--host', '127.0.0.1',
    '--port', '8189', '-c', '4096', '-t', '4', '-np', '2', '-ngl', '0', '--no-webui')
Start-Process -FilePath $server.FullName -ArgumentList $arguments -WorkingDirectory $server.DirectoryName -WindowStyle Hidden
if (!$Quiet) { Write-Host 'Starting GOLDEN HAVEN Qwen on http://127.0.0.1:8189.' }
