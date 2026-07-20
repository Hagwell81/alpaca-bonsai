---
sidebar_position: 2
title: Installation Guide
description: Install Alpaca on your system
---

# Installation Guide

## System Requirements

### Minimum Requirements
- **OS**: Windows 10, macOS 11, or Ubuntu 20.04+
- **RAM**: 8GB
- **Disk Space**: 10GB free
- **Node.js**: 18.0 or higher
- **npm**: 9.0 or higher

### Recommended Requirements
- **OS**: Windows 11, macOS 12+, or Ubuntu 22.04+
- **RAM**: 16GB or more
- **Disk Space**: 50GB for models
- **GPU**: NVIDIA (CUDA 11.8+), AMD (ROCm 5.5+), or Intel Arc
- **Node.js**: 20.0 or higher
- **npm**: 10.0 or higher

## Installation Steps

### 1. Clone the Repository

```bash
git clone https://github.com/Hagwell81/alpaca-bonsai.git
cd alpaca
```

### 2. Install Dependencies

```bash
# Install root dependencies
npm install

# Install desktop app dependencies
cd desktop
npm install
cd ..

# Install webui dependencies
cd webui
npm install
cd ..

# Install documentation site dependencies
cd docs
npm install
cd ..
```

### 3. Download Backend

The application will automatically download the llama.cpp server on first run. You can also manually download it:

```bash
cd desktop
npm run download-backend
```

### 4. Start the Application

#### Development Mode
```bash
npm run dev
```

#### Production Build
```bash
npm run build
npm start
```

## Platform-Specific Instructions

### Windows

#### Prerequisites
- Visual Studio Build Tools (for native modules)
- Git for Windows

#### Installation
```bash
# Install build tools (if needed)
npm install --global windows-build-tools

# Clone and install
git clone https://github.com/Hagwell81/alpaca-bonsai.git
cd alpaca
npm install
```

#### GPU Support
- **NVIDIA**: Ensure CUDA 11.8+ is installed
- **AMD**: Install ROCm 5.5+
- **Intel Arc**: Install Intel GPU drivers

### macOS

#### Prerequisites
- Xcode Command Line Tools
- Homebrew (optional but recommended)

#### Installation
```bash
# Install Xcode tools
xcode-select --install

# Clone and install
git clone https://github.com/Hagwell81/alpaca-bonsai.git
cd alpaca
npm install
```

#### GPU Support
- **Apple Silicon**: Native support (M1, M2, M3)
- **Intel**: NVIDIA GPU support via CUDA

### Linux (Ubuntu/Debian)

#### Prerequisites
```bash
# Install build essentials
sudo apt-get update
sudo apt-get install -y build-essential python3 git

# Install Node.js (if not installed)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### Installation
```bash
# Clone and install
git clone https://github.com/Hagwell81/alpaca-bonsai.git
cd alpaca
npm install
```

#### GPU Support
```bash
# NVIDIA GPU
sudo apt-get install -y nvidia-driver-525 nvidia-utils
# Then install CUDA 11.8+

# AMD GPU
sudo apt-get install -y rocm-dkms
```

## Verification

### Verify Installation

```bash
# Check Node.js version
node --version  # Should be 18.0+

# Check npm version
npm --version   # Should be 9.0+

# Verify dependencies
npm list --depth=0
```

### First Run

1. Start the application: `npm start`
2. Wait for the server to initialize (30-60 seconds)
3. The chat interface should open automatically
4. You should see the models list (may be empty initially)

## Troubleshooting

### Port Already in Use

If port 13434 is already in use:

```bash
# Windows
netstat -ano | findstr :13434
taskkill /PID <PID> /F

# macOS/Linux
lsof -i :13434
kill -9 <PID>
```

Or configure a different port in settings.

### GPU Not Detected

1. Verify GPU drivers are installed
2. Check `Settings > Hardware` in the application
3. Restart the application
4. Check logs in `~/.alpaca/logs/`

### Out of Memory

1. Increase available RAM
2. Use smaller models (< 7B parameters)
3. Reduce context window in settings
4. Close other applications

### Build Failures

```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm cache clean --force
npm install
```

## Next Steps

- **[Quick Start](./quickstart.md)** - Get running in 5 minutes
- **[User Guide](../user-guide/chat-interface.md)** - Learn the interface
- **[API Management](../api-management/overview.md)** - Configure providers

## Getting Help

- **GitHub Issues**: [Report bugs](https://github.com/Hagwell81/alpaca-bonsai/issues)
- **Discussions**: [Ask questions](https://github.com/Hagwell81/alpaca-bonsai/discussions)
- **Documentation**: [Browse guides](/)
