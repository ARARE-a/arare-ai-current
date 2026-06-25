param(
  [string]$AppUrl = "https://arare-ai-three.vercel.app",
  [string]$VoiceRelayUrl = ""
)

$ErrorActionPreference = "Stop"

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Read-JsonBlock {
  param([string]$Text)
  $start = $Text.IndexOf("{")
  $end = $Text.LastIndexOf("}")
  if ($start -lt 0 -or $end -lt $start) {
    throw "JSON block was not found."
  }
  return $Text.Substring($start, $end - $start + 1) | ConvertFrom-Json
}

function Format-ProcessArgument {
  param([string]$Value)
  if ($null -eq $Value) {
    return '""'
  }
  if ($Value -notmatch '[\s"]') {
    return $Value
  }
  return '"' + ($Value -replace '"', '\"') + '"'
}

function Invoke-NodeJson {
  param(
    [string]$ScriptPath,
    [string[]]$Arguments = @()
  )

  $node = (Get-Command node -ErrorAction Stop).Source
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $node
  $startInfo.WorkingDirectory = (Get-Location).Path
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.StandardOutputEncoding = [System.Text.UTF8Encoding]::new($false)
  $startInfo.StandardErrorEncoding = [System.Text.UTF8Encoding]::new($false)
  $startInfo.Arguments = (@($ScriptPath) + $Arguments | ForEach-Object { Format-ProcessArgument $_ }) -join " "

  $process = [System.Diagnostics.Process]::Start($startInfo)
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()

  if ([string]::IsNullOrWhiteSpace($stdout)) {
    throw ("Node script produced no JSON. script={0} exit={1} stderr={2}" -f $ScriptPath, $process.ExitCode, $stderr)
  }

  try {
    return [pscustomobject]@{
      Json = Read-JsonBlock $stdout
      ExitCode = $process.ExitCode
      Stderr = $stderr
    }
  } catch {
    throw ("Failed to parse JSON from node output. script={0} exit={1} stderr={2}`n{3}" -f $ScriptPath, $process.ExitCode, $stderr, $_.Exception.Message)
  }
}

function Write-Check {
  param(
    [string]$Name,
    [bool]$Ok,
    [string]$Detail = ""
  )
  $mark = if ($Ok) { "OK" } else { "NG" }
  if ($Detail) {
    Write-Host ("[{0}] {1}: {2}" -f $mark, $Name, $Detail)
  } else {
    Write-Host ("[{0}] {1}" -f $mark, $Name)
  }
}

Write-Host "=== ARARE AI demo readiness summary ==="
Write-Host ("AppUrl: {0}" -f $AppUrl)
Write-Host ("VoiceRelayUrl: {0}" -f $VoiceRelayUrl)
Write-Host ""

$health = Invoke-RestMethod -Uri ("{0}/api/health" -f $AppUrl.TrimEnd("/")) -Method Get
$healthData = if ($health.data) { $health.data } else { $health }
Write-Check "App health" ($healthData.status -eq "ok") ("status={0}" -f $healthData.status)
Write-Check "App database configured" ([bool]$healthData.features.database)
Write-Check "App OpenAI configured" ([bool]$healthData.features.openai)
Write-Check "App Twilio configured" ([bool]$healthData.features.twilio)
Write-Check "App LINE configured" ([bool]$healthData.features.line)
Write-Check "App Clerk configured" ([bool]$healthData.features.clerk)

Write-Host ""
Write-Host "Running production endpoint verifier..."
$productionRun = Invoke-NodeJson "scripts\verify-production.mjs" @($AppUrl)
$production = $productionRun.Json
$failedProduction = @($production.results | Where-Object { -not $_.ok })
Write-Check "Production endpoint verifier" ($failedProduction.Count -eq 0) ("failed={0}" -f $failedProduction.Count)
foreach ($result in $production.results) {
  $authText = if ($result.authGated) { " auth-gated" } else { "" }
  Write-Host ("  - {0}: status={1} ok={2}{3}" -f $result.path, $result.status, $result.ok, $authText)
}

Write-Host ""
Write-Host "Running external readiness verifier..."
$externalRun = Invoke-NodeJson "scripts\verify-production-external-readiness.mjs" @($AppUrl)
$external = $externalRun.Json
Write-Check "External readiness verifier" ([bool]$external.twilio.ok) ("twilioOk={0}" -f $external.twilio.ok)
Write-Check "Twilio voice webhook" ([bool]$external.twilio.incomingNumber.voiceWebhookMatches) ($external.twilio.incomingNumber.voiceUrl)
Write-Check "Recent Twilio messages sampled" ($external.twilio.recentMessages.sampled -gt 0) ("sampled={0}" -f $external.twilio.recentMessages.sampled)
if ($external.line.skipped) {
  Write-Host ("[UNVERIFIED] LINE Console webhook: {0}" -f $external.line.warning)
} else {
  Write-Check "LINE Console webhook" ([bool]$external.line.ok)
}

Write-Host ""
$voiceHealth = Invoke-RestMethod -Uri ("{0}/health" -f $VoiceRelayUrl.TrimEnd("/")) -Method Get
Write-Check "Voice Relay health" ([bool]$voiceHealth.ok) ("service={0}" -f $voiceHealth.service)
Write-Check "Voice Relay OpenAI configured" ([bool]$voiceHealth.openaiConfigured)
Write-Check "Voice Relay database configured" ([bool]$voiceHealth.databaseConfigured)
Write-Host ("  - TTS: {0} / {1} / {2}" -f $voiceHealth.ttsProvider, $voiceHealth.ttsVoice, $voiceHealth.ttsSpeechRate)
Write-Host ("  - Transcription: {0} / {1}" -f $voiceHealth.transcriptionProvider, $voiceHealth.speechModel)

Write-Host ""
Write-Host "Manual checks still required:"
Write-Host "  - Logged-in platform screen shows score 100 and blockers 0."
Write-Host "  - Demo phone call creates a tentative reservation."
Write-Host "  - Confirming a reservation sends customer SMS and therapist LINE."
Write-Host "  - Notification log shows sent records and body content."
