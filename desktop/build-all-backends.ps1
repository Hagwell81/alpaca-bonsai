# Build all llama.cpp GPU backends and package them for the desktop app
# Usage: .\build-all-backends.ps1 [-SkipCpu] [-SkipVulkan] [-SkipCuda] [-SkipHip] [-Clean] [-ReleasePackage]

param(
    [switch]$SkipCpu,
    [switch]$SkipVulkan,
    [switch]$SkipCuda,
    [switch]$SkipHip,
    [switch]$Clean,
    [switch]$ReleasePackage
)

$ErrorActionPreference = "Stop"

# Colors
$success = "Green"
$warning = "Yellow"
$errColor = "Red"
$info = "Cyan"

# Paths
$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopDir  = $scriptDir
$projectRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $desktopDir))
$binDir      = Join-Path $desktopDir "bin"

function Write-Step($num, $total, $message) {
    Write-Host ""
    Write-Host "[$num/$total] $message" -ForegroundColor $info
    Write-Host ("-" * 60) -ForegroundColor $info
}

function Test-Command($cmd) {
    try { $null = Get-Command $cmd -ErrorAction Stop; return $true } catch { return $false }
}

function Test-CudaAvailable {
    if (-not (Test-Command "nvcc")) { return $false }
    try {
        $ver = & nvcc --version 2>$null | Select-String "release"
        return $ver -ne $null
    } catch { return $false }
}

function Test-HipAvailable {
    if (-not ($env:HIP_PATH)) { return $false }
    if (-not (Test-Path "$env:HIP_PATH\bin\hipcc.exe")) { return $false }
    return $true
}

function Test-VulkanAvailable {
    if ($env:VULKAN_SDK -and (Test-Path "$env:VULKAN_SDK\Bin\vulkaninfo.exe")) { return $true }
    if (Test-Command "vulkaninfo") { return $true }
    return $false
}

function Invoke-LlamaBuild($name, $buildDir, $extraFlags) {
    $fullBuildDir = Join-Path $projectRoot $buildDir
    $cmakeArgs = @("-B", $fullBuildDir, "-S", $projectRoot) + $commonFlags + $extraFlags
    if ($hasNinja) {
        $cmakeArgs += "-GNinja"
    }

    Write-Host "  Configuring $name..." -ForegroundColor $info
    Write-Host "    cmake $($cmakeArgs -join ' ')" -ForegroundColor DarkGray
    $output = & cmake @cmakeArgs 2>&1
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object {
        if ($_ -match "error|ERROR|CMake Error") { Write-Host "    $_" -ForegroundColor $errColor }
        elseif ($_ -match "warning|WARNING") { Write-Host "    $_" -ForegroundColor $warning }
        else { Write-Host "    $_" -ForegroundColor DarkGray }
    }
    if ($exitCode -ne 0) {
        throw "CMake configuration failed for $name (exit code $exitCode)"
    }

    Write-Host "  Building $name..." -ForegroundColor $info
    $output = & cmake --build $fullBuildDir --config Release -j 2>&1
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object {
        if ($_ -match "error [A-Z]|ERROR|fatal error|FAILED") { Write-Host "    $_" -ForegroundColor $errColor }
        elseif ($_ -match "warning [A-Z]") { Write-Host "    $_" -ForegroundColor $warning }
        elseif ($_ -match "Built target|Linking") { Write-Host "    $_" -ForegroundColor $success }
        else { Write-Host "    $_" -ForegroundColor DarkGray }
    }
    if ($exitCode -ne 0) {
        throw "Build failed for $name (exit code $exitCode)"
    }

    Write-Host "  $name built successfully!" -ForegroundColor $success
}

# 1. Environment detection
# ------------------------------------------------------------------------------
Write-Step 1 5 "Detecting build environment"

$hasCMake   = Test-Command "cmake"
$hasNinja   = Test-Command "ninja"
$hasCuda    = (-not $SkipCuda) -and (Test-CudaAvailable)
$hasHip     = (-not $SkipHip)  -and (Test-HipAvailable)
$hasVulkan  = (-not $SkipVulkan) -and (Test-VulkanAvailable)
$buildCpu   = (-not $SkipCpu)

if (-not $hasCMake) {
    Write-Host "ERROR: CMake not found. Please install CMake 3.28+ and add it to PATH." -ForegroundColor $errColor
    exit 1
}

Write-Host "  CMake:     OK" -ForegroundColor $success
Write-Host "  Ninja:     $(if ($hasNinja) { 'OK' } else { 'MISSING (will use MSBuild/Visual Studio)' })" -ForegroundColor $(if ($hasNinja) { $success } else { $warning })
Write-Host "  CPU:       $(if ($buildCpu) { 'WILL BUILD' } else { 'SKIPPED' })" -ForegroundColor $(if ($buildCpu) { $success } else { $warning })
Write-Host "  Vulkan:    $(if ($hasVulkan) { 'WILL BUILD' } else { 'NOT AVAILABLE / SKIPPED' })" -ForegroundColor $(if ($hasVulkan) { $success } else { $warning })
Write-Host "  CUDA:      $(if ($hasCuda) { 'WILL BUILD' } else { 'NOT AVAILABLE / SKIPPED' })" -ForegroundColor $(if ($hasCuda) { $success } else { $warning })
Write-Host "  HIP/ROCm:  $(if ($hasHip) { 'WILL BUILD' } else { 'NOT AVAILABLE / SKIPPED' })" -ForegroundColor $(if ($hasHip) { $success } else { $warning })

# 2. Clean previous builds
# ------------------------------------------------------------------------------
if ($Clean) {
    Write-Step 2 5 "Cleaning previous build directories"
    $buildDirs = @("build", "build-cpu", "build-vulkan", "build-cuda", "build-hip")
    foreach ($d in $buildDirs) {
        $fullPath = Join-Path $projectRoot $d
        if (Test-Path $fullPath) {
            Write-Host "  Removing $d..." -ForegroundColor $warning
            Remove-Item -Recurse -Force $fullPath -ErrorAction SilentlyContinue
        }
    }
    if (Test-Path $binDir) {
        Get-ChildItem $binDir | Where-Object {
            $_.Name -match "^ggml-(cuda|hip|vulkan|cpu)\.dll$|^llama\.dll$|^llama-common\.dll$|^llama-server\.exe$|^ggml\.dll$|^ggml-base\.dll$|^mtmd\.dll$"
        } | ForEach-Object {
            Write-Host "  Removing bin\$($_.Name)" -ForegroundColor $warning
            Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
        }
    }
} else {
    Write-Step 2 5 "Clean skipped (use -Clean to wipe old builds)"
}

# 3. Build backends
# ------------------------------------------------------------------------------
Write-Step 3 5 "Building backends"

$builds = @()
$commonFlags = @("-DLLAMA_BUILD_SERVER=ON", "-DLLAMA_BUILD_WEBUI=ON", "-DLLAMA_BUILD_TESTS=OFF", "-DLLAMA_BUILD_EXAMPLES=OFF")

# 3a. CPU (always build as baseline)
if ($buildCpu) {
    try {
        Invoke-LlamaBuild "CPU" "build-cpu" @("-DBUILD_SHARED_LIBS=ON")
        $builds += [PSCustomObject]@{ Name = "CPU"; Dir = "build-cpu"; DllPattern = "ggml-cpu.dll"; ExtraFiles = @("llama-server.exe","llama.dll","llama-common.dll","ggml.dll","ggml-base.dll","mtmd.dll") }
    } catch {
        Write-Host "  CPU build FAILED: $_" -ForegroundColor $errColor
    }
} else {
    Write-Host "  CPU build SKIPPED" -ForegroundColor $warning
}

# 3b. Vulkan
if ($hasVulkan) {
    try {
        Invoke-LlamaBuild "Vulkan" "build-vulkan" @("-DGGML_VULKAN=ON", "-DBUILD_SHARED_LIBS=ON")
        $builds += [PSCustomObject]@{ Name = "Vulkan"; Dir = "build-vulkan"; DllPattern = "ggml-vulkan.dll"; ExtraFiles = @() }
    } catch {
        Write-Host "  Vulkan build FAILED: $_" -ForegroundColor $errColor
    }
} else {
    Write-Host "  Vulkan build SKIPPED (no Vulkan SDK detected)" -ForegroundColor $warning
}

# 3c. CUDA
if ($hasCuda) {
    try {
        Invoke-LlamaBuild "CUDA" "build-cuda" @("-DGGML_CUDA=ON", "-DGGML_NATIVE=OFF", "-DBUILD_SHARED_LIBS=ON")
        $builds += [PSCustomObject]@{ Name = "CUDA"; Dir = "build-cuda"; DllPattern = "ggml-cuda.dll"; ExtraFiles = @() }
    } catch {
        Write-Host "  CUDA build FAILED: $_" -ForegroundColor $errColor
    }
} else {
    Write-Host "  CUDA build SKIPPED (nvcc not found - install CUDA Toolkit)" -ForegroundColor $warning
}

# 3d. HIP/ROCm
if ($hasHip) {
    try {
        $gpuTarget = "gfx1100"
        try {
            $rocminfo = & "$env:HIP_PATH\bin\rocminfo.exe" 2>$null | Select-String "Name:\s+gfx\d+"
            if ($rocminfo) {
                $detected = ($rocminfo | Select-Object -First 1).Line -replace ".*gfx", "gfx"
                $gpuTarget = $detected.Trim()
                Write-Host "  Auto-detected AMD GPU target: $gpuTarget" -ForegroundColor $success
            }
        } catch { }

        $hipFlags = @(
            "-DGGML_HIP=ON",
            "-DGPU_TARGETS=$gpuTarget",
            "-DCMAKE_C_COMPILER=clang",
            "-DCMAKE_CXX_COMPILER=clang++",
            "-DCMAKE_BUILD_TYPE=Release",
            "-DBUILD_SHARED_LIBS=ON"
        )

        # On Windows, HIP requires Ninja because the Visual Studio generator ignores
        # clang compiler flags and uses MSVC instead, which is incompatible with HIP headers.
        if ($IsWindows -or $env:OS -eq "Windows_NT") {
            if (-not $hasNinja) {
                Write-Host "  ERROR: Ninja is required for HIP builds on Windows. Install with: pip install ninja" -ForegroundColor $errColor
                throw "Ninja not found"
            }
            $hipFlags += "-GNinja"
            # Add ROCm cmake directories to search path so hip/hipblas packages are found
            $rocmCMakeDirs = (Get-ChildItem "$env:HIP_PATH\lib\cmake" -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) -join ";"
            if ($rocmCMakeDirs) {
                $hipFlags += "-DCMAKE_PREFIX_PATH=$rocmCMakeDirs"
            }
        }

        Invoke-LlamaBuild "HIP" "build-hip" $hipFlags
        $builds += [PSCustomObject]@{ Name = "HIP"; Dir = "build-hip"; DllPattern = "ggml-hip.dll"; ExtraFiles = @() }
    } catch {
        Write-Host "  HIP build FAILED: $_" -ForegroundColor $errColor
    }
} else {
    Write-Host "  HIP build SKIPPED (HIP_PATH not set or hipcc missing - install ROCm)" -ForegroundColor $warning
}

if ($builds.Count -eq 0) {
    Write-Host ""
    Write-Host "ERROR: No backends were successfully built." -ForegroundColor $errColor
    Write-Host "At minimum, a CPU build should succeed. Check CMake and compiler setup." -ForegroundColor $errColor
    exit 1
}

# 4. Package binaries to desktop/bin
# ------------------------------------------------------------------------------
Write-Step 4 5 "Packaging binaries to desktop\bin"

if (-not (Test-Path $binDir)) {
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
}

$baseBuild = $builds | Where-Object { $_.Name -eq "CPU" } | Select-Object -First 1
if (-not $baseBuild) { $baseBuild = $builds | Select-Object -First 1 }

# Ninja outputs directly to bin/, MSBuild outputs to bin\Release
$baseSrcNinja = Join-Path $projectRoot $baseBuild.Dir "bin"
$baseSrcRelease = Join-Path $projectRoot $baseBuild.Dir "bin\Release"
$baseSrc = if (Test-Path $baseSrcRelease) { $baseSrcRelease } else { $baseSrcNinja }
Write-Host "  Using $($baseBuild.Name) build as base binary set (from $($baseSrc))" -ForegroundColor $info

$baseFiles = @("llama-server.exe", "llama.dll", "llama-common.dll", "ggml.dll", "ggml-base.dll", "ggml-cpu.dll", "mtmd.dll")
foreach ($f in $baseFiles) {
    $src = Join-Path $baseSrc $f
    if (Test-Path $src) {
        Copy-Item $src $binDir -Force
        $size = (Get-Item (Join-Path $binDir $f)).Length
        Write-Host "  Copied $f ($([math]::Round($size/1MB,2)) MB)" -ForegroundColor $success
    } else {
        Write-Host "  WARNING: $f not found in base build" -ForegroundColor $warning
    }
}

foreach ($b in $builds) {
    $srcDirNinja = Join-Path $projectRoot $b.Dir "bin"
    $srcDirRelease = Join-Path $projectRoot $b.Dir "bin\Release"
    $srcDir = if (Test-Path $srcDirRelease) { $srcDirRelease } else { $srcDirNinja }

    $dll = Get-ChildItem $srcDir -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "^ggml-(vulkan|cuda|hip|blas|metal|sycl)\.dll$" } | Select-Object -First 1
    if ($dll) {
        Copy-Item $dll.FullName $binDir -Force
        Write-Host "  Copied $($dll.Name) from $($b.Name) build ($([math]::Round($dll.Length/1MB,2)) MB)" -ForegroundColor $success
    }
    foreach ($ef in $b.ExtraFiles) {
        $src = Join-Path $srcDir $ef
        if (Test-Path $src) {
            Copy-Item $src $binDir -Force
            if ($ef -notin $baseFiles) {
                Write-Host "  Copied $ef from $($b.Name) build" -ForegroundColor $success
            }
        }
    }
}

# 5. Verify & Summary
# ------------------------------------------------------------------------------
Write-Step 5 5 "Verification & Summary"

Write-Host ""
Write-Host "  Binaries in desktop\bin:" -ForegroundColor $info
Get-ChildItem $binDir | Where-Object { $_.Extension -in @(".exe", ".dll") } | Sort-Object Name | ForEach-Object {
    $tag = ""
    if ($_.Name -match "ggml-(cuda|hip|vulkan)") { $tag = " [GPU backend]" }
    elseif ($_.Name -eq "ggml-cpu.dll") { $tag = " [CPU fallback]" }
    elseif ($_.Name -eq "llama-server.exe") { $tag = " [Server executable]" }
    Write-Host ("    {0,-22} {1,8:N2} MB{2}" -f $_.Name, ($_.Length/1MB), $tag) -ForegroundColor $success
}

Write-Host ""
Write-Host "========================================" -ForegroundColor $success
Write-Host "  Build & Package Complete!" -ForegroundColor $success
Write-Host "========================================" -ForegroundColor $success
Write-Host ""
Write-Host "Detected backends:" -ForegroundColor $info
foreach ($b in $builds) {
    Write-Host "  [$($b.Name)]" -ForegroundColor $success
}

Write-Host ""
Write-Host "Hardware detection in main.js will auto-select the best backend at runtime:" -ForegroundColor $info
Write-Host "  1. NVIDIA GPU detected  -> load ggml-cuda.dll" -ForegroundColor $info
Write-Host "  2. AMD GPU detected     -> load ggml-hip.dll (or ggml-vulkan.dll fallback)" -ForegroundColor $info
Write-Host "  3. Intel/Apple detected -> load ggml-vulkan.dll (or Metal on macOS)" -ForegroundColor $info
Write-Host "  4. No GPU detected      -> load ggml-cpu.dll" -ForegroundColor $info

if ($ReleasePackage) {
    Write-Host ""
    Write-Host "  -ReleasePackage flag set. Building Electron package..." -ForegroundColor $info
    Push-Location $desktopDir
    try {
        npm run dist 2>&1 | ForEach-Object {
            if ($_ -match "error|ERROR") { Write-Host "    $_" -ForegroundColor $errColor }
            elseif ($_ -match "packaged|success") { Write-Host "    $_" -ForegroundColor $success }
            else { Write-Host "    $_" -ForegroundColor DarkGray }
        }
        Write-Host "  Electron package complete!" -ForegroundColor $success
    } catch {
        Write-Host "  Packaging failed: $_" -ForegroundColor $errColor
    }
    Pop-Location
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor $info
Write-Host "  npm start            # Run the desktop app in dev mode" -ForegroundColor $info
Write-Host "  .\test-desktop.ps1   # Run the full test/launch script" -ForegroundColor $info
Write-Host "  .\build-all-backends.ps1 -Clean   # Rebuild everything from scratch" -ForegroundColor $info
Write-Host ""
