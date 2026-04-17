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

# Ensure a local Redis server is running (Docker) when REDIS_ENABLED=true
if ($RedisEnabled) {
    $containerName = "speakfrench-redis"
    $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $dockerCmd) {
        Write-Warning "Docker not found on PATH. Skipping Redis auto-start. Ensure Redis is reachable at $RedisUrl or set -RedisEnabled `$false."
    } else {
        try {
            $existing = docker ps -a --filter "name=^/$containerName$" --format "{{.Names}}|{{.State}}" 2>$null
            if (-not $existing) {
                Write-Host "Starting Redis container '$containerName' on port 6379..."
                docker run -d --name $containerName -p 6379:6379 --restart unless-stopped redis:7-alpine | Out-Null
            } else {
                $parts = $existing.Split("|")
                if ($parts[1] -ne "running") {
                    Write-Host "Starting existing Redis container '$containerName'..."
                    docker start $containerName | Out-Null
                } else {
                    Write-Host "Redis container '$containerName' already running."
                }
            }

            # Wait briefly for Redis to accept connections
            $ready = $false
            for ($i = 0; $i -lt 10; $i++) {`
                $probe = Test-NetConnection -ComputerName localhost -Port 6379 -InformationLevel Quiet -WarningAction SilentlyContinue
                if ($probe) { $ready = $true; break }
                Start-Sleep -Milliseconds 500
            }
            if ($ready) {
                Write-Host "Redis is ready on localhost:6379."
            } else {
                Write-Warning "Redis container started but port 6379 is not yet reachable. Continuing anyway."
            }
        } catch {
            Write-Warning "Failed to auto-start Redis: $_. Continuing with in-memory fallback if enabled."
        }
    }
}

# Start the backend server
Write-Host "Starting backend server on http://localhost:8000"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

Pop-Location
