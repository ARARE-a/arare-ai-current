param(
  [ValidateSet("deploy", "http", "network")]
  [string]$Type = "deploy",
  [string]$Since = "20m",
  [int]$Lines = 0,
  [string]$Filter = "",
  [string]$Service = "voice-relay",
  [string]$Environment = "production"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

function Read-DotEnvValue {
  param([string]$Name)
  foreach ($file in @(".env", ".env.local", ".env.railway.source")) {
    $path = Join-Path $root $file
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $line = Get-Content -LiteralPath $path | Where-Object { $_ -match "^$Name=" } | Select-Object -First 1
    if ($line) {
      return (($line -split "=", 2)[1]).Trim().Trim('"').Trim("'")
    }
  }
  return $null
}

if (-not $env:RAILWAY_API_TOKEN) {
  $token = Read-DotEnvValue -Name "RAILWAY_API_TOKEN"
  if ($token) { $env:RAILWAY_API_TOKEN = $token }
}

if (-not $env:RAILWAY_TOKEN) {
  $token = Read-DotEnvValue -Name "RAILWAY_TOKEN"
  if ($token) { $env:RAILWAY_TOKEN = $token }
}

$argsList = @("logs", "--service", $Service, "--environment", $Environment, "--json")

switch ($Type) {
  "deploy" { $argsList += "--deployment" }
  "http" { $argsList += "--http" }
  "network" { $argsList += "--network" }
}

if ($Lines -gt 0) {
  $argsList += @("--lines", [string]$Lines)
} else {
  $argsList += @("--since", $Since)
}

if ($Filter) {
  $argsList += @("--filter", $Filter)
}

& npx @railway/cli @argsList
