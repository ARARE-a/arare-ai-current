param(
  [string]$ProjectName = "arare-ai-voice-relay",
  [string]$ServiceName = "voice-relay",
  [string]$Environment = "production",
  [switch]$SyncDatabaseUrl,
  [switch]$SyncRelaySecret,
  [switch]$RotateRelaySecret
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Read-DotEnv {
  param([string]$Path)

  $values = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $values
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) {
      continue
    }

    $separator = $trimmed.IndexOf("=")
    if ($separator -le 0) {
      continue
    }

    $key = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$key] = $value
  }

  return $values
}

function Get-ConfigValue {
  param(
    [string]$Name,
    [hashtable]$DotEnv,
    [string]$Default = "",
    [switch]$Required
  )

  $envValue = [Environment]::GetEnvironmentVariable($Name)
  if ($envValue) {
    return $envValue
  }

  if ($DotEnv.ContainsKey($Name) -and $DotEnv[$Name]) {
    return $DotEnv[$Name]
  }

  if ($Required) {
    throw "Missing required variable: $Name. Set it in .env or in the current PowerShell session."
  }

  return $Default
}

function New-RelaySecret {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($bytes).Replace("+", "-").Replace("/", "_").TrimEnd("=")
}

function Invoke-Railway {
  param([string[]]$CliArgs)

  & npx @railway/cli @CliArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Railway command failed: railway $($CliArgs -join ' ')"
  }
}

function Invoke-RailwayMaybe {
  param([string[]]$CliArgs)

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = & npx @railway/cli @CliArgs 2>$null
    return @{
      ExitCode = $LASTEXITCODE
      Output = ($output -join "`n")
    }
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location -LiteralPath $root

$dotEnv = @{}
foreach ($envFile in @(".env", ".env.local", ".env.railway.source")) {
  $fileValues = Read-DotEnv -Path (Join-Path $root $envFile)
  foreach ($entry in $fileValues.GetEnumerator()) {
    $dotEnv[$entry.Key] = $entry.Value
  }
}

if (-not $env:RAILWAY_TOKEN -and $dotEnv.ContainsKey("RAILWAY_TOKEN") -and $dotEnv["RAILWAY_TOKEN"]) {
  $env:RAILWAY_TOKEN = $dotEnv["RAILWAY_TOKEN"]
}
if (-not $env:RAILWAY_API_TOKEN -and $dotEnv.ContainsKey("RAILWAY_API_TOKEN") -and $dotEnv["RAILWAY_API_TOKEN"]) {
  $env:RAILWAY_API_TOKEN = $dotEnv["RAILWAY_API_TOKEN"]
}

if (-not $env:RAILWAY_TOKEN -and -not $env:RAILWAY_API_TOKEN) {
  throw "RAILWAY_TOKEN or RAILWAY_API_TOKEN is required. Create a Railway token and set it in PowerShell before running this script."
}

$openAiKey = Get-ConfigValue -Name "OPENAI_API_KEY" -DotEnv $dotEnv -Required
$openAiRealtimeModel = Get-ConfigValue -Name "OPENAI_REALTIME_MODEL" -DotEnv $dotEnv -Default "gpt-realtime-2"
$twilioAuthToken = Get-ConfigValue -Name "TWILIO_AUTH_TOKEN" -DotEnv $dotEnv -Required
$databaseUrl = $null
if ($SyncDatabaseUrl) {
  $databaseUrl = Get-ConfigValue -Name "DATABASE_URL" -DotEnv $dotEnv -Required
}

$relaySecret = $null
if ($SyncRelaySecret) {
  $relaySecret = Get-ConfigValue -Name "VOICE_RELAY_SHARED_SECRET" -DotEnv $dotEnv -Required
} elseif ($RotateRelaySecret) {
  $relaySecret = New-RelaySecret
}

Write-Host "Checking Railway login..."
Invoke-Railway -CliArgs @("whoami")

Write-Host "Ensuring Railway project link..."
$statusResult = Invoke-RailwayMaybe -CliArgs @("status", "--json")
if ($statusResult.ExitCode -ne 0) {
  Invoke-Railway -CliArgs @("init", "--name", $ProjectName, "--json")
}

Write-Host "Ensuring Railway service..."
$servicesResult = Invoke-RailwayMaybe -CliArgs @("service", "list", "--json")
$servicesJson = $servicesResult.Output
$hasService = $false
if ($servicesResult.ExitCode -eq 0 -and $servicesJson) {
  $services = $servicesJson | ConvertFrom-Json
  foreach ($service in $services) {
    if ($service.name -eq $ServiceName -or $service.id -eq $ServiceName) {
      $hasService = $true
    }
  }
}
if (-not $hasService) {
  Invoke-Railway -CliArgs @("add", "--service", $ServiceName, "--json")
}

Write-Host "Setting Railway variables..."
$variables = @{
  "OPENAI_API_KEY" = $openAiKey
  "OPENAI_REALTIME_MODEL" = $openAiRealtimeModel
  "TWILIO_AUTH_TOKEN" = $twilioAuthToken
  "VOICE_RELAY_VALIDATE_TWILIO_SIGNATURE" = "false"
}

if ($SyncDatabaseUrl) {
  $variables["DATABASE_URL"] = $databaseUrl
} else {
  Write-Host "Skipping DATABASE_URL sync. Use -SyncDatabaseUrl only when you intentionally want to overwrite Railway's database URL."
}

if ($relaySecret) {
  $variables["VOICE_RELAY_SHARED_SECRET"] = $relaySecret
} else {
  Write-Host "Skipping VOICE_RELAY_SHARED_SECRET sync. Use -SyncRelaySecret or -RotateRelaySecret only when you intentionally want to change it."
}

foreach ($entry in $variables.GetEnumerator()) {
  Invoke-Railway -CliArgs @("variable", "set", "$($entry.Key)=$($entry.Value)", "--service", $ServiceName, "--environment", $Environment, "--skip-deploys", "--json")
}

Write-Host "Deploying voice relay to Railway..."
Invoke-Railway -CliArgs @("up", "--service", $ServiceName, "--environment", $Environment, "--detach", "--json", "--message", "Deploy ARARE AI voice relay")

Write-Host "Creating or reading Railway domain..."
$domainOutput = & npx @railway/cli domain --service $ServiceName --environment $Environment --json
if ($LASTEXITCODE -ne 0) {
  throw "Railway domain command failed."
}

Write-Host ""
Write-Host "Railway deploy started."
Write-Host "Domain command output:"
Write-Host $domainOutput
Write-Host ""
Write-Host "After the domain is active, set this in ARARE AI /phone-ai:"
Write-Host "wss://<railway-domain>/conversation-relay?token=<VOICE_RELAY_SHARED_SECRET>"
Write-Host ""
if ($relaySecret) {
  Write-Host "The relay secret was set in Railway. Keep it secret and do not paste it into chat."
} else {
  Write-Host "The relay secret was not changed."
}
