param(
    [Parameter(Mandatory = $true)][string]$PromptFile,
    [Parameter(Mandatory = $true)][string]$Out,
    [string[]]$ReferenceImage = @(),
    [string]$Size = '1024x1024',
    [ValidateSet('low', 'medium', 'high', 'auto')][string]$Quality = 'high',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$config = @{}
foreach ($line in Get-Content -LiteralPath (Join-Path $projectRoot '.env.imagegen') -Encoding UTF8) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
        $config[$Matches[1]] = $Matches[2].Trim()
    }
}
foreach ($name in @('IMAGEGEN_API_KEY', 'IMAGEGEN_BASE_URL', 'IMAGEGEN_MODEL')) {
    if (-not $config[$name]) { throw "Fill $name in .env.imagegen before running." }
}
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
$cliPath = Join-Path $PSScriptRoot 'imagegen_api.py'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Project Python environment is missing.' }
if (-not (Test-Path -LiteralPath $cliPath)) { throw 'Project image API adapter is missing.' }

$previousKey = $env:OPENAI_API_KEY
$previousBaseUrl = $env:OPENAI_BASE_URL
try {
    $env:OPENAI_API_KEY = $config['IMAGEGEN_API_KEY']
    $env:OPENAI_BASE_URL = $config['IMAGEGEN_BASE_URL']
    $cliArgs = @($cliPath, '--model', $config['IMAGEGEN_MODEL'], '--prompt-file', $PromptFile, '--size', $Size, '--quality', $Quality, '--out', $Out)
    foreach ($imagePath in $ReferenceImage) { $cliArgs += @('--image', $imagePath) }
    if ($DryRun) { $cliArgs += '--dry-run' }
    & $pythonPath @cliArgs
    if ($LASTEXITCODE -ne 0) { throw "Image generation CLI exited with code $LASTEXITCODE." }
}
finally {
    $env:OPENAI_API_KEY = $previousKey
    $env:OPENAI_BASE_URL = $previousBaseUrl
}
