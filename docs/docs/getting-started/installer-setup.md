---
sidebar_position: 2
title: Installer Setup
description: Install Alpaca using the pre-built installer
---

# Installer Setup

The quickest way to get Alpaca running on your system is to use the pre-built installer. This method requires no development tools or command-line knowledge.

## Downloading the Installer

### Official Releases

1. Visit the [GitHub Releases](https://github.com/Hagwell81/alpaca-bonsai/releases) page
2. Download the installer for your operating system:
   - **Windows**: `Alpaca-Setup-<version>.exe`
   - **macOS**: `Alpaca-<version>.dmg`
   - **Linux**: `Alpaca-<version>.AppImage` or `.deb`/`.rpm`

### Nightly Builds

For bleeding-edge features, download nightly builds from the [Actions](https://github.com/Hagwell81/alpaca-bonsai/actions) tab.

:::caution Nightly Builds
Nightly builds may contain unstable features. Use for testing only.
:::

## Windows Installation

### Standard Installation

1. Run the downloaded `.exe` installer
2. Follow the setup wizard:
   - Accept the license agreement
   - Choose installation directory (default: `%LocalAppData%\Alpaca`)
   - Select whether to create a desktop shortcut
   - Choose if Alpaca should start on boot
3. Click **Install** and wait for completion
4. Launch Alpaca from the Start Menu or desktop shortcut

### Portable Installation

For a portable setup that leaves no traces on the host system:

1. Download the portable ZIP: `Alpaca-Portable-<version>-win.zip`
2. Extract to a USB drive or folder of your choice
3. Run `Alpaca.exe` directly
4. All data (models, settings, conversations) is stored in the same folder

### Silent Installation (Enterprise)

For mass deployment in enterprise environments:

```powershell
# Silent install
Alpaca-Setup.exe /S /D=C:\Program Files\Alpaca

# Disable auto-start
Alpaca-Setup.exe /S /NoAutoStart
```

## macOS Installation

### DMG Installation

1. Open the downloaded `.dmg` file
2. Drag the **Alpaca** icon into your **Applications** folder
3. Eject the DMG disk image
4. Launch from Launchpad or Applications folder

:::info Gatekeeper
On first launch, macOS may warn that the app is from an unidentified developer. Right-click the app and select **Open** to approve.
:::

### Homebrew (Coming Soon)

```bash
brew install --cask alpaca
```

## Linux Installation

### AppImage (Recommended)

1. Download the `.AppImage` file
2. Make it executable:
   ```bash
   chmod +x Alpaca-<version>.AppImage
   ```
3. Double-click to run, or launch from terminal:
   ```bash
   ./Alpaca-<version>.AppImage
   ```

### Debian/Ubuntu (.deb)

```bash
sudo dpkg -i alpaca_<version>_amd64.deb
sudo apt-get install -f  # Fix any missing dependencies
```

### Fedora/RHEL (.rpm)

```bash
sudo rpm -i alpaca-<version>.x86_64.rpm
```

### Arch Linux (AUR)

```bash
yay -S alpaca-bin
# or
paru -S alpaca-bin
```

## First-Run Setup Wizard

When you launch Alpaca for the first time, a setup wizard will guide you through initial configuration.

### Step 1: Welcome

Read the welcome message and click **Get Started**.

### Step 2: Data Directory

Choose where Alpaca stores its data:

- **Default**: System-appropriate location (recommended)
- **Custom**: Specify your own path (useful for external drives)

:::tip External Storage
If you plan to download many models, choose a directory on a drive with plenty of free space.
:::

### Step 3: Hardware Detection

Alpaca automatically detects your hardware:

| Hardware | Status Indicator |
|----------|------------------|
| NVIDIA GPU | Green checkmark with CUDA version |
| AMD GPU | Green checkmark with ROCm status |
| Apple Silicon | "Metal" label |
| Intel Arc | "Intel GPU" label |
| CPU Only | "CPU fallback" warning |

Click **Detect Again** if you recently installed GPU drivers.

### Step 4: Download First Model

The wizard offers a curated list of recommended models:

**Quick Start Models** (sorted by VRAM requirement):

| Model | Size | VRAM | Best For |
|-------|------|------|----------|
| Qwen2.5-1.5B-Instruct | 1.1 GB | 2 GB | Testing, slow hardware |
| Llama-3.2-3B-Instruct | 2.0 GB | 4 GB | Balanced performance |
| Qwen2.5-7B-Instruct | 4.5 GB | 6 GB | General purpose |
| Llama-3.1-8B-Instruct | 5.0 GB | 8 GB | Best quality/ speed balance |

Select a model and click **Download**. The wizard shows real-time progress.

:::info Skip This Step
You can skip model download and do it later from the Models panel.
:::

### Step 5: User Account

Create your local user account:

- **Username**: Your display name
- **Password**: Used for local authentication (stored with SHA-256 hashing)

:::caution Local Only
This account is stored locally and is not connected to any online service.
:::

### Step 6: Complete

Click **Finish** to launch the main application. The chat interface will open automatically.

## Post-Installation Verification

### Check Server Status

Look at the status indicator in the top-right corner:

- **Green dot**: Server running, ready to chat
- **Yellow dot**: Server starting or loading model
- **Red dot**: Server error — check logs

### Test Your First Chat

1. Ensure a model is loaded (status shows model name)
2. Type "Hello!" in the chat box
3. Press **Enter**
4. You should see a streaming response within a few seconds

### Verify API Access

```bash
curl http://localhost:13434/v1/models
```

You should see a JSON list of available models.

## Updating Alpaca

### Automatic Updates

By default, Alpaca checks for updates on startup:

1. When an update is available, a notification appears
2. Click **Update** to download and install
3. The app restarts automatically

### Manual Update

1. Open **Settings** → **About**
2. Click **Check for Updates**
3. Follow the prompts

### Reinstalling

Download the latest installer from the releases page and run it. Your data (models, conversations, settings) is preserved.

## Uninstalling

### Windows

1. Open **Settings** → **Apps** → **Installed Apps**
2. Find **Alpaca**
3. Click **Uninstall**
4. Choose whether to keep user data

### macOS

1. Quit Alpaca
2. Drag the app from Applications to Trash
3. Optionally remove user data from `~/.config/alpaca/`

### Linux

**AppImage**: Simply delete the file and the `.AppImage.home` folder.

**Package Manager**:
```bash
# Debian/Ubuntu
sudo apt remove alpaca

# Fedora
sudo rpm -e alpaca

# Arch
yay -R alpaca-bin
```

## Troubleshooting Installation

### "Windows protected your PC" SmartScreen Warning

Click **More info** → **Run anyway**. This is normal for open-source software before it builds reputation with Microsoft.

### macOS "App is damaged" Error

If you see this on Apple Silicon Macs, it usually means Gatekeeper quarantined the app:

```bash
xattr -dr com.apple.quarantine /Applications/Alpaca.app
```

### Linux GPU Not Detected

Ensure your GPU drivers are installed before launching:

```bash
# NVIDIA
nvidia-smi

# AMD
rocminfo
```

### Backend Download Fails

If the automatic llama.cpp backend download fails:

1. Check your internet connection
2. Verify you can reach GitHub releases
3. Manually download the backend from the [llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases)
4. Place it in the `backends/` folder inside your data directory

### Backend Update Stuck or Fails

If the in-app backend update hangs or fails:

1. Ensure you have a stable internet connection (downloads can be large)
2. Close any antivirus software that may block binary downloads temporarily
3. Check that the app has permission to write to the data directory
4. Restart the application and try the update again
5. If it keeps failing, use the manual download steps above

## Updating the Backend

After installation, Alpaca can automatically update the llama.cpp backend:

1. Open **Settings** → **Providers**
2. Click **Check for Updates** on the Local Backend card
3. If an update is available, click **Update to `<version>`**
4. Watch the progress bar as the update downloads and installs
5. A toast notification confirms when the server is ready

The update manager handles everything automatically — hardware detection, download, extraction, and server restart.

## Next Steps

- **[Quick Start](./quickstart.md)** — Learn the basics in 5 minutes
- **[User Guide](../user-guide/chat-interface.md)** — Master the chat interface
- **[Settings Guide](../user-guide/settings.md)** — Configure preferences
- **[Model Management](../user-guide/model-management.md)** — Download and manage models
