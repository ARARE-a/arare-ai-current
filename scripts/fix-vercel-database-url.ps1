param(
  [string]$Environment = "production"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

Write-Host "Paste the full DATABASE_URL for Supabase. Input is hidden."
Write-Host "Example: postgresql://postgres.<project-ref>:<password>@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"
$secure = Read-Host "DATABASE_URL" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $databaseUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}

if (-not $databaseUrl -or -not $databaseUrl.StartsWith("postgres")) {
  throw "DATABASE_URL must start with postgres:// or postgresql://"
}
if ($databaseUrl -match "YOUR-PASSWORD|PASSWORD|password") {
  throw "DATABASE_URL still looks like a placeholder. Replace it with the actual Supabase database password."
}

$env:TEST_DATABASE_URL = $databaseUrl
try {
  $testOutput = @'
const { PrismaClient } = require("@prisma/client");
const url = process.env.TEST_DATABASE_URL || "";
(async () => {
  const result = { ok: false };
  try {
    const u = new URL(url);
    result.host = u.host;
    result.user = u.username.slice(0, 18);
  } catch (error) {
    result.error = "DATABASE_URL parse failed";
    console.log(JSON.stringify(result));
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await prisma.$queryRaw`SELECT 1`;
    result.ok = true;
    console.log(JSON.stringify(result));
  } catch (error) {
    result.error = String(error.message || error).replace(/\s+/g, " ").slice(0, 220);
    console.log(JSON.stringify(result));
    process.exit(1);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
})();
'@ | node
  Write-Host "DB test result:"
  Write-Host $testOutput
} finally {
  Remove-Item Env:\TEST_DATABASE_URL -ErrorAction SilentlyContinue
}

Write-Host "Updating Vercel DATABASE_URL for $Environment..."
& npx vercel env rm DATABASE_URL $Environment --yes 2>$null | Out-Null
$databaseUrl | npx vercel env add DATABASE_URL $Environment
if ($LASTEXITCODE -ne 0) {
  throw "Failed to set Vercel DATABASE_URL."
}

Write-Host "Redeploying Vercel production..."
& npx vercel --prod --yes
if ($LASTEXITCODE -ne 0) {
  throw "Vercel production deploy failed."
}

Write-Host "Checking production deep health..."
& curl.exe -s "https://arare-ai-three.vercel.app/api/health?deep=1"
Write-Host ""
Write-Host "Open: https://arare-ai-three.vercel.app/reservations"
