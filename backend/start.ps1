param(
    [bool]$RedisEnabled = $true,
    [string]$RedisUrl = "redis://localhost:6379/0"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Push-Location $PSScriptRoot

# Create virtual environment if it doesn't exist
if (-not (Test-Path "venv")) {
    Write-Host "Creating virtual environment..."
    python -m venv venv
}

# Activate virtual environment
& .\venv\Scripts\Activate.ps1

# Install dependencies
Write-Host "Installing dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# Configure Redis environment for this process/session
$env:REDIS_ENABLED = if ($RedisEnabled) { "true" } else { "false" }
$env:REDIS_URL = $RedisUrl
Write-Host "Redis config: REDIS_ENABLED=$($env:REDIS_ENABLED), REDIS_URL=$($env:REDIS_URL)"

# Start the backend server
Write-Host "Starting backend server on http://localhost:8000"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

Pop-Location
