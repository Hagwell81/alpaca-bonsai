# Test script for llama.cpp Desktop Application
# This script checks prerequisites and launches the desktop app

$ErrorActionPreference = "Stop"

# Colors for output
$success = "Green"
$warning = "Yellow"
$error = "Red"
$info = "Cyan"

Write-Host "========================================" -ForegroundColor $info
Write-Host "Llama.cpp Desktop App Test Script" -ForegroundColor $info
Write-Host "========================================" -ForegroundColor $info
Write-Host ""

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopDir = $scriptDir
$projectRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $desktopDir))
$serverDir = Join-Path $projectRoot "tools\server"
$webuiDir = Join-Path $serverDir "webui"
$buildDir = Join-Path $projectRoot "build\bin\Release"

Write-Host "Project Root: $projectRoot" -ForegroundColor $info
Write-Host "Desktop Dir: $desktopDir" -ForegroundColor $info
Write-Host ""

# Check 1: llama-server binary
Write-Host "[1/5] Checking for llama-server binary..." -ForegroundColor $info
$llamaServerPaths = @(
    (Join-Path $buildDir "llama-server.exe"),
    (Join-Path $projectRoot "build\bin\llama-server.exe"),
    (Join-Path $projectRoot "build\bin\llama-server")
)

$llamaServerFound = $false
foreach ($path in $llamaServerPaths) {
    if (Test-Path $path) {
        Write-Host "  Found llama-server at: $path" -ForegroundColor $success
        $llamaServerFound = $true
        break
    }
}

if (-not $llamaServerFound) {
    Write-Host "  ERROR: llama-server binary not found!" -ForegroundColor $error
    Write-Host "  Please build llama.cpp first:" -ForegroundColor $warning
    Write-Host "  cmake -B build -S . -DLLAMA_BUILD_SERVER=ON" -ForegroundColor $warning
    Write-Host "  cmake --build build --config Release" -ForegroundColor $warning
    Write-Host ""
    exit 1
}
Write-Host ""

# Check 2: WebUI build
Write-Host "[2/5] Checking for WebUI build..." -ForegroundColor $info
$webuiIndexPath = Join-Path $serverDir "public\index.html"
if (-not (Test-Path $webuiIndexPath)) {
    Write-Host "  WebUI not found at: $webuiIndexPath" -ForegroundColor $warning
    Write-Host "  Attempting to build WebUI..." -ForegroundColor $warning
    
    Push-Location $webuiDir
    try {
        if (-not (Test-Path "node_modules")) {
            Write-Host "  Installing dependencies..." -ForegroundColor $info
            npm install
        }
        Write-Host "  Building WebUI..." -ForegroundColor $info
        npm run build
        Write-Host "  WebUI built successfully!" -ForegroundColor $success
    } catch {
        Write-Host "  ERROR: Failed to build WebUI: $_" -ForegroundColor $error
        Pop-Location
        exit 1
    }
    Pop-Location
} else {
    Write-Host "  WebUI found at: $webuiIndexPath" -ForegroundColor $success
}
Write-Host ""

# Check 3: Copy WebUI to desktop
Write-Host "[3/5] Copying WebUI to desktop app..." -ForegroundColor $info
Push-Location $desktopDir
try {
    node build-webui.js
    Write-Host "  WebUI copied successfully!" -ForegroundColor $success
} catch {
    Write-Host "  ERROR: Failed to copy WebUI: $_" -ForegroundColor $error
    Pop-Location
    exit 1
}
Pop-Location
Write-Host ""

# Check 4: Install npm dependencies
Write-Host "[4/5] Installing desktop app dependencies..." -ForegroundColor $info
Push-Location $desktopDir
try {
    if (-not (Test-Path "node_modules")) {
        Write-Host "  Running npm install..." -ForegroundColor $info
        npm install
        Write-Host "  Dependencies installed!" -ForegroundColor $success
    } else {
        Write-Host "  Dependencies already installed." -ForegroundColor $success
    }
} catch {
    Write-Host "  ERROR: Failed to install dependencies: $_" -ForegroundColor $error
    Pop-Location
    exit 1
}
Pop-Location
Write-Host ""

# Check 5: Launch desktop app
Write-Host "[5/5] Launching desktop app..." -ForegroundColor $info
Write-Host ""
Write-Host "========================================" -ForegroundColor $success
Write-Host "All checks passed! Starting app..." -ForegroundColor $success
Write-Host "========================================" -ForegroundColor $success
Write-Host ""
Write-Host "Note: On first run, the app will download the following models:" -ForegroundColor $warning
Write-Host "  - Qwen3.5-9B-GGUF-Q4_K_M.gguf (~5GB)" -ForegroundColor $warning
Write-Host "  - Bonsai-8B-Q4_K_M.gguf (~5GB)" -ForegroundColor $warning
Write-Host ""
Write-Host "Press Ctrl+C to stop the app." -ForegroundColor $info
Write-Host ""

Push-Location $desktopDir
try {
    npm start
} catch {
    Write-Host "  ERROR: Failed to start app: $_" -ForegroundColor $error
    Pop-Location
    exit 1
}
Pop-Location
