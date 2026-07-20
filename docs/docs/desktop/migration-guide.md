# Migration Guide

This guide helps existing Alpaca users migrate to v2.0.0 with enhanced secure data storage, performance optimizations, and the complete feature platform.

## Overview

Alpaca v2.0.0 introduces:

- **Secure Data Storage**: Encrypted storage for API keys and tokens
- **Performance Optimizations**: Faster model loading, scheduler-based multi-slot hosting, and VRAM budget management
- **HuggingFace Service**: Improved model download and management
- **Backward Compatibility**: All existing data is preserved and migrated

## Pre-Migration Checklist

Before upgrading, ensure:

- [ ] You have a backup of your data
- [ ] You have at least 500MB free disk space
- [ ] Your internet connection is stable
- [ ] You have administrator privileges (Windows)
- [ ] No models are currently downloading

## Step-by-Step Migration

### Step 1: Backup Your Data

Create a backup of your current Alpaca data:

**Windows:**
```powershell
# Open PowerShell as Administrator
$source = "$env:APPDATA\alpaca"
$backup = "$env:APPDATA\alpaca.backup"
Copy-Item -Path $source -Destination $backup -Recurse -Force
Write-Host "Backup created at: $backup"
```

**macOS:**
```bash
# Open Terminal
cp -r ~/.config/alpaca ~/.config/alpaca.backup
echo "Backup created at: ~/.config/alpaca.backup"
```

**Linux:**
```bash
# Open Terminal
cp -r ~/.config/alpaca ~/.config/alpaca.backup
echo "Backup created at: ~/.config/alpaca.backup"
```

### Step 2: Close Current Version

1. Close Alpaca completely
2. Ensure no background processes are running:
   - Windows: Check Task Manager for `alpaca` or `llama-server`
   - macOS/Linux: Run `ps aux | grep alpaca` in terminal

### Step 3: Install New Version

Download the new version from the [releases page](https://github.com/Hagwell81/alpaca-bonsai/releases).

**Windows:**
- Download `Alpaca-Setup-2.0.0.exe`
- Run the installer
- Follow the installation wizard
- Choose installation directory (default: `Program Files`)

**macOS:**
- Download `Alpaca-2.0.0-macOS.dmg`
- Open the DMG file
- Drag Alpaca to Applications folder
- Eject the DMG

**Linux:**
- Download `alpaca_2.0.0_amd64.deb` (Ubuntu/Debian) or `.AppImage`
- Install:
  ```bash
  sudo dpkg -i alpaca_2.0.0_amd64.deb
  # or
  chmod +x Alpaca-2.0.0-linux.AppImage
  ./Alpaca-2.0.0-linux.AppImage
  ```

### Step 4: First Run - Migration Dialog

When you launch the new version for the first time:

1. **Migration Dialog Appears**
   - Shows: "Migrate existing data to secure storage?"
   - Explains what will be migrated
   - Shows estimated migration time

2. **Click "Migrate"**
   - App begins migration process
   - Progress bar shows migration status
   - Do not close the app during migration

3. **Migration Completes**
   - Shows: "Migration successful!"
   - Lists migrated items:
     - HuggingFace tokens
     - API keys
     - User records
     - Model metadata
   - Click "Done" to continue

### Step 5: Verify Migration

After migration completes, verify everything works:

#### Check Models
1. Open Settings → Models
2. Verify all previously downloaded models are listed
3. Try loading a model to ensure it works

#### Check API Keys
1. Open Settings → API Keys
2. Verify API keys are still stored
3. Try using an API key in a request

#### Check HuggingFace Token
1. Open Settings → Models
2. Click "Download Model"
3. Verify HuggingFace token is still available
4. Try searching for a model

#### Check Performance
1. Restart the app
2. Note startup time (should be faster)
3. Load a model (should be faster with warm-cache)

## Data Migration Details

### What Gets Migrated

| Data | Source | Destination | Status |
|------|--------|-------------|--------|
| HuggingFace Token | localStorage | Secret_Vault | ✓ Encrypted |
| API Keys | config.json | Secret_Vault | ✓ Encrypted |
| User Records | database | Secret_Vault | ✓ Encrypted |
| Model Metadata | cache | Model_Loader | ✓ Cached |
| Downloaded Models | models/ | models/ | ✓ Unchanged |
| Chat History | database | database | ✓ Unchanged |
| Settings | config.json | config.json | ✓ Unchanged |

### What Stays the Same

- Downloaded models remain in the same location
- Chat history is preserved
- Settings are preserved
- Model cache is preserved

### Encryption Details

**Encryption Process:**

1. Machine-bound key derivation
   - Windows: System UUID + User SID
   - macOS: Hardware UUID
   - Linux: Machine ID + User UID

2. AES-256-GCM encryption
   - Authenticated encryption
   - Prevents tampering
   - Unique IV per secret

3. Checksum verification
   - SHA-256 checksum
   - Detects cross-machine usage
   - Prevents secret theft

## Rollback Procedures

If you need to rollback to the previous version:

### Option 1: Restore from Backup (Recommended)

**Windows:**
```powershell
# Close the app
Stop-Process -Name alpaca -Force -ErrorAction SilentlyContinue

# Remove new version data
Remove-Item -Path "$env:APPDATA\alpaca" -Recurse -Force

# Restore backup
Copy-Item -Path "$env:APPDATA\alpaca.backup" -Destination "$env:APPDATA\alpaca" -Recurse -Force

# Reinstall previous version
# Download and run Alpaca-Setup-1.0.0.exe
```

**macOS:**
```bash
# Close the app
killall alpaca

# Remove new version data
rm -rf ~/.config/alpaca

# Restore backup
cp -r ~/.config/alpaca.backup ~/.config/alpaca

# Reinstall previous version
# Download and install Alpaca-1.0.0-macOS.dmg
```

**Linux:**
```bash
# Close the app
killall alpaca

# Remove new version data
rm -rf ~/.config/alpaca

# Restore backup
cp -r ~/.config/alpaca.backup ~/.config/alpaca

# Reinstall previous version
sudo dpkg -i alpaca_1.0.0_amd64.deb
```

### Option 2: Manual Data Recovery

If backup is not available:

1. **Recover HuggingFace Token**
   - Check browser history for HuggingFace login
   - Generate new token at https://huggingface.co/settings/tokens
   - Add token in Settings → Models

2. **Recover API Keys**
   - Check password manager for saved API keys
   - Generate new API keys from service providers
   - Add keys in Settings → API Keys

3. **Recover Downloaded Models**
   - Models are stored in `models/` directory
   - They are not affected by migration
   - Can be used with previous version

## Troubleshooting Migration

### Migration Fails to Start

**Symptom:** Migration dialog doesn't appear on first run

**Solutions:**
1. Check if migration was already completed
   - Look for `migration_completed` flag in config
2. Delete migration flag to retry:
   - Windows: Delete `%APPDATA%\alpaca\migration_completed`
   - macOS/Linux: Delete `~/.config/alpaca/migration_completed`
3. Restart the app

### Migration Hangs

**Symptom:** Migration dialog shows progress but doesn't complete

**Solutions:**
1. Wait up to 5 minutes (large datasets take time)
2. Check system resources:
   - Windows: Open Task Manager, check CPU and memory
   - macOS: Open Activity Monitor
   - Linux: Run `top` command
3. If still hanging after 5 minutes:
   - Force close the app
   - Restore from backup
   - Try migration again

### Migration Fails with Error

**Symptom:** Migration shows error message

**Common Errors:**

| Error | Cause | Solution |
|-------|-------|----------|
| "Insufficient disk space" | Not enough free space | Free up 500MB+ and retry |
| "Permission denied" | Insufficient permissions | Run as administrator/sudo |
| "Database locked" | Another process using data | Close all instances and retry |
| "Encryption failed" | Key derivation error | Check system permissions |

### Data Loss During Migration

**Prevention:**
- Always create backup before migration
- Don't close app during migration
- Ensure stable power supply
- Check disk space before starting

**Recovery:**
1. Restore from backup
2. Try migration again
3. Contact support if issue persists

## Post-Migration Optimization

### Enable Performance Features

After successful migration, enable performance features:

1. **Warm-Cache**
   - Settings → Performance → Enable Warm-Cache
   - Reduces model load time by ~40%

2. **Request Batching**
   - Settings → Performance → Enable Request Batching
   - Reduces API calls by 10-100x

3. **Connection Pooling**
   - Settings → Performance → Enable Connection Pooling
   - Reduces latency by ~50ms per request

### Monitor Startup Performance

1. Open Settings → Developer
2. Enable "Startup Telemetry"
3. Restart the app
4. Check telemetry dashboard for:
   - Total startup time
   - Per-stage timing
   - 30-day trend

### Verify Security

1. Open Settings → Security
2. Verify:
   - [ ] Secret_Vault is initialized
   - [ ] Machine-bound key is derived
   - [ ] Cross-machine detection is enabled
   - [ ] Secrets are encrypted

## FAQ

### Q: Will my models be deleted during migration?

**A:** No, your downloaded models are preserved in the same location. Migration only affects metadata and secrets.

### Q: Can I use the new version without migrating?

**A:** No, migration is required on first run. However, you can rollback to the previous version if needed.

### Q: How long does migration take?

**A:** Typically 1-2 minutes. Large datasets (100+ models) may take 5-10 minutes.

### Q: Is my data encrypted after migration?

**A:** Yes, all secrets (tokens, API keys) are encrypted with AES-256-GCM using machine-bound keys.

### Q: Can I migrate back to the old version?

**A:** Yes, restore from backup and reinstall the previous version. Your data will be restored.

### Q: What if I lose my backup?

**A:** You can manually recover:
- Downloaded models are still in `models/` directory
- Generate new API keys from service providers
- Generate new HuggingFace token

### Q: Is migration reversible?

**A:** Yes, you can rollback by restoring from backup and reinstalling the previous version.

### Q: Will migration affect my chat history?

**A:** No, chat history is preserved during migration.

### Q: Can I migrate on a different machine?

**A:** No, encrypted secrets are machine-bound. You'll need to re-enter secrets on a new machine.

## Support

If you encounter issues during migration:

1. **Check Logs**
   - Windows: `%APPDATA%\alpaca\logs\`
   - macOS/Linux: `~/.config/alpaca/logs/`

2. **Enable Debug Logging**
   - Settings → Developer → Enable Debug Logging
   - Restart app and reproduce issue
   - Share logs with support

3. **Contact Support**
   - GitHub Issues: https://github.com/Hagwell81/alpaca-bonsai/issues
   - Email: support@alpaca.com

## Next Steps

After successful migration:

1. **Explore New Features**
   - Check Settings → Performance for optimization options
   - Check Settings → Developer for telemetry dashboard

2. **Provide Feedback**
   - Report issues on GitHub
   - Share performance improvements you notice
   - Suggest improvements

3. **Update Documentation**
   - Share your migration experience
   - Help improve this guide
   - Contribute to community wiki

