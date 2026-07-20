# Troubleshooting Guide

This guide helps you diagnose and resolve common issues with Alpaca Pre-Dev Enhancements.

## Table of Contents

1. [General Issues](#general-issues)
2. [Secret_Vault Issues](#secret_vault-issues)
3. [HuggingFace Service Issues](#huggingface-service-issues)
4. [Performance Issues](#performance-issues)
5. [Migration Issues](#migration-issues)
6. [Debug Logging](#debug-logging)
7. [Error Messages Reference](#error-messages-reference)

---

## General Issues

### App Won't Start

**Symptom:** App crashes immediately or shows blank window

**Diagnosis:**
1. Check if another instance is running:
   - Windows: `tasklist | findstr alpaca`
   - macOS/Linux: `ps aux | grep alpaca`
2. Check system resources:
   - Available RAM: At least 2GB free
   - Disk space: At least 500MB free
3. Check logs:
   - Windows: `%APPDATA%\alpaca\logs\main.log`
   - macOS/Linux: `~/.config/alpaca/logs/main.log`

**Solutions:**
1. Kill existing processes:
   ```bash
   # Windows
   taskkill /IM alpaca.exe /F
   taskkill /IM llama-server.exe /F
   
   # macOS/Linux
   killall alpaca
   killall llama-server
   ```

2. Clear cache:
   ```bash
   # Windows
   rmdir /s %APPDATA%\alpaca\cache
   
   # macOS/Linux
   rm -rf ~/.config/alpaca/cache
   ```

3. Reinstall app:
   - Uninstall current version
   - Delete data directory
   - Reinstall from scratch

### App Crashes on Startup

**Symptom:** App starts but crashes after a few seconds

**Diagnosis:**
1. Check error logs:
   ```bash
   # Windows
   type %APPDATA%\alpaca\logs\main.log | findstr ERROR
   
   # macOS/Linux
   grep ERROR ~/.config/alpaca/logs/main.log
   ```

2. Check for corrupted config:
   ```bash
   # Windows
   type %APPDATA%\alpaca\config.json
   
   # macOS/Linux
   cat ~/.config/alpaca/config.json
   ```

**Solutions:**
1. Reset config:
   ```bash
   # Windows
   del %APPDATA%\alpaca\config.json
   
   # macOS/Linux
   rm ~/.config/alpaca/config.json
   ```

2. Check for corrupted database:
   ```bash
   # Windows
   del %APPDATA%\alpaca\app.db
   
   # macOS/Linux
   rm ~/.config/alpaca/app.db
   ```

3. Reinstall app

### High CPU Usage

**Symptom:** App uses 100% CPU even when idle

**Diagnosis:**
1. Check which process is using CPU:
   - Windows: Task Manager → Processes
   - macOS: Activity Monitor
   - Linux: `top` command

2. Check logs for busy loops:
   ```bash
   grep -i "loop\|busy\|spin" ~/.config/alpaca/logs/main.log
   ```

**Solutions:**
1. Disable telemetry:
   - Settings → Developer → Disable Startup Telemetry

2. Disable warm-cache:
   - Settings → Performance → Disable Warm-Cache

3. Reduce request batching:
   - Settings → Performance → Reduce Batch Size

4. Restart app

---

## Secret_Vault Issues

### "Cross-Machine Detection Failed"

**Symptom:** Error message: "Secret was created on a different machine"

**Cause:** Secret was encrypted on a different machine and cannot be decrypted on current machine

**Solutions:**
1. **Re-initialize vault:**
   ```bash
   # Windows
   del %APPDATA%\alpaca\vault.db
   
   # macOS/Linux
   rm ~/.config/alpaca/vault.db
   ```
   - Restart app
   - Re-enter secrets

2. **Restore from backup:**
   - If you have backup from same machine, restore it
   - Secrets will work on original machine

3. **Migrate to new machine:**
   - Generate new secrets on new machine
   - Update services with new secrets

### "Decryption Failed"

**Symptom:** Error message: "Failed to decrypt secret"

**Cause:** Secret data is corrupted or encryption key is invalid

**Solutions:**
1. **Delete corrupted secret:**
   ```bash
   # Windows
   del %APPDATA%\alpaca\vault.db
   
   # macOS/Linux
   rm ~/.config/alpaca/vault.db
   ```

2. **Re-enter secret:**
   - Restart app
   - Go to Settings → API Keys
   - Re-enter the secret

3. **Check system permissions:**
   - Windows: Run as Administrator
   - macOS/Linux: Check file permissions

### "Master Key Derivation Failed"

**Symptom:** Error message: "Failed to derive master key"

**Cause:** Platform identity collection failed or insufficient permissions

**Solutions:**
1. **Check system permissions:**
   - Windows: Run as Administrator
   - macOS/Linux: Check sudo access

2. **Check platform identity collection:**
   - Windows: Run `wmic csproduct get UUID` in Command Prompt
   - macOS: Run `system_profiler SPHardwareDataType` in Terminal
   - Linux: Check `/etc/machine-id` exists

3. **Use fallback passphrase:**
   - App will prompt for passphrase
   - Enter secure passphrase
   - Restart app

### "Secret Not Found"

**Symptom:** Error message: "Secret does not exist"

**Cause:** Secret was deleted or never created

**Solutions:**
1. **Check if secret exists:**
   - Settings → API Keys
   - Look for the secret in the list

2. **Re-create secret:**
   - Click "Add Secret"
   - Enter secret name and value
   - Click "Save"

3. **Check migration status:**
   - If migrating from old version, ensure migration completed
   - Check logs for migration errors

---

## HuggingFace Service Issues

### "Repository Not Found"

**Symptom:** Error message: "Repository not found (404)"

**Cause:** Invalid repository ID or repository doesn't exist

**Solutions:**
1. **Verify repository ID:**
   - Check spelling: `author/model-name`
   - Visit https://huggingface.co/models to find correct ID
   - Copy exact ID from HuggingFace

2. **Check repository visibility:**
   - Private repositories require authentication
   - Add HuggingFace token in Settings → Models

3. **Check repository status:**
   - Repository might be deleted or moved
   - Search for similar repositories

### "Unauthorized (401)"

**Symptom:** Error message: "Unauthorized (401)"

**Cause:** Token required for gated repository or token is invalid

**Solutions:**
1. **Add HuggingFace token:**
   - Go to Settings → Models
   - Click "Add HuggingFace Token"
   - Get token from https://huggingface.co/settings/tokens
   - Paste token and click "Save"

2. **Verify token permissions:**
   - Token must have "read" access
   - Check token expiration date
   - Regenerate token if expired

3. **Accept repository terms:**
   - Some repositories require accepting terms
   - Visit repository on HuggingFace
   - Click "Agree and access repository"
   - Try download again

### "Rate Limited (429)"

**Symptom:** Error message: "Rate limited (429)"

**Cause:** Too many requests to HuggingFace API

**Solutions:**
1. **Wait before retrying:**
   - HuggingFace rate limit: 5 requests per minute
   - Wait 1-2 minutes before retrying

2. **Use HuggingFace token:**
   - Authenticated requests have higher rate limit
   - Add token in Settings → Models

3. **Reduce concurrent downloads:**
   - Download one model at a time
   - Wait for download to complete before starting another

### "Download Failed"

**Symptom:** Error message: "Download failed" or download stops

**Cause:** Network error, corrupted file, or server issue

**Solutions:**
1. **Check internet connection:**
   - Verify internet is working
   - Check firewall settings
   - Try accessing https://huggingface.co in browser

2. **Retry download:**
   - Click "Retry" button
   - App will resume from where it stopped

3. **Check disk space:**
   - Ensure at least 10GB free space
   - Check `%APPDATA%\alpaca\models\` (Windows) or `~/.config/alpaca/models/` (macOS/Linux)

4. **Clear partial download:**
   - Delete incomplete file
   - Retry download

### "Hash Verification Failed"

**Symptom:** Error message: "Hash verification failed"

**Cause:** Downloaded file is corrupted

**Solutions:**
1. **Delete corrupted file:**
   - Find file in `models/` directory
   - Delete the file
   - Retry download

2. **Check disk integrity:**
   - Windows: Run `chkdsk C: /F`
   - macOS: Run Disk Utility
   - Linux: Run `fsck` (requires root)

3. **Try different mirror:**
   - Some files may be corrupted on CDN
   - Wait a few hours and retry

### "Vision Model Not Detected"

**Symptom:** Vision model (mmproj) not detected for multimodal model

**Cause:** Repository doesn't have mmproj file or naming convention not recognized

**Solutions:**
1. **Check repository contents:**
   - Visit repository on HuggingFace
   - Look for `.mmproj` files
   - Check file naming

2. **Manually specify mmproj:**
   - Settings → Models → Edit Model
   - Manually enter mmproj filename
   - Save

3. **Check quantization matching:**
   - Base model and mmproj should have matching quantization
   - Example: `model-Q4_K_M.gguf` with `model-Q4_K_M.mmproj`

---

## Performance Issues

### Slow Model Loading

**Symptom:** Model takes 30+ seconds to load

**Cause:** Cold cache, large model, or insufficient RAM

**Solutions:**
1. **Enable warm-cache:**
   - Settings → Performance → Enable Warm-Cache
   - Reduces load time by ~40%

2. **Check available RAM:**
   - Windows: Task Manager → Performance
   - macOS: Activity Monitor
   - Linux: `free -h` command
   - Ensure at least 8GB free

3. **Use smaller model:**
   - Try 7B or 3B model instead of 13B or 70B
   - Reduces load time and memory usage

4. **Check disk speed:**
   - Model loading depends on disk speed
   - Use SSD instead of HDD if possible

### High Memory Usage

**Symptom:** App uses 10GB+ RAM

**Cause:** Multiple models in warm-cache or large model loaded

**Solutions:**
1. **Reduce warm-cache size:**
   - Settings → Performance → Warm-Cache Size
   - Set to 1 or 2 instead of 3

2. **Disable warm-cache:**
   - Settings → Performance → Disable Warm-Cache
   - Saves memory but slower model loading

3. **Close other applications:**
   - Free up system RAM
   - Close browser, IDE, etc.

4. **Use smaller model:**
   - Try 7B or 3B model
   - Reduces memory usage

### Slow Startup

**Symptom:** App takes 2+ minutes to start

**Cause:** Telemetry recording, model loading, or system resources

**Solutions:**
1. **Check startup telemetry:**
   - Settings → Developer → Startup Telemetry
   - Identify slow stages
   - See "Slow Startup" section below

2. **Disable telemetry:**
   - Settings → Developer → Disable Startup Telemetry
   - Saves 5-10 seconds

3. **Disable warm-cache:**
   - Settings → Performance → Disable Warm-Cache
   - Saves 10-20 seconds

4. **Check system resources:**
   - Close other applications
   - Free up RAM and CPU

### Slow Startup - Detailed Analysis

**Check telemetry dashboard:**
1. Settings → Developer → Startup Telemetry
2. Look for stages taking > 30 seconds:

| Stage | Normal Time | Slow | Solution |
|-------|-------------|------|----------|
| Initialization | 2-5s | > 10s | Check system resources |
| Model Load | 10-30s | > 60s | Enable warm-cache, use smaller model |
| Server Startup | 5-10s | > 20s | Check backend availability |
| Total | 20-50s | > 120s | See solutions below |

**Solutions for slow stages:**

- **Slow Initialization:**
  - Close other applications
  - Check disk space
  - Restart app

- **Slow Model Load:**
  - Enable warm-cache
  - Use smaller model
  - Check disk speed

- **Slow Server Startup:**
  - Check backend availability
  - Verify llama-server binary
  - Check system resources

### Connection Timeouts

**Symptom:** Error message: "Connection timeout"

**Cause:** Network issues or server not responding

**Solutions:**
1. **Check internet connection:**
   - Verify internet is working
   - Check firewall settings
   - Try accessing https://huggingface.co

2. **Increase timeout:**
   - Settings → Network → Connection Timeout
   - Set to 60 seconds (default: 30)

3. **Check server status:**
   - Verify HuggingFace is accessible
   - Check llama-server is running
   - Check backend availability

---

## Migration Issues

### Migration Fails to Start

**Symptom:** Migration dialog doesn't appear on first run

**Solutions:**
1. **Check migration flag:**
   ```bash
   # Windows
   type %APPDATA%\alpaca\config.json | findstr migration
   
   # macOS/Linux
   grep migration ~/.config/alpaca/config.json
   ```

2. **Reset migration flag:**
   ```bash
   # Windows
   del %APPDATA%\alpaca\config.json
   
   # macOS/Linux
   rm ~/.config/alpaca/config.json
   ```

3. **Restart app**

### Migration Hangs

**Symptom:** Migration dialog shows progress but doesn't complete

**Solutions:**
1. **Wait up to 5 minutes:**
   - Large datasets take time
   - Don't close app

2. **Check system resources:**
   - Windows: Task Manager
   - macOS: Activity Monitor
   - Linux: `top` command
   - Ensure CPU and memory available

3. **Force close and retry:**
   ```bash
   # Windows
   taskkill /IM alpaca.exe /F
   
   # macOS/Linux
   killall alpaca
   ```
   - Restart app
   - Try migration again

### Migration Fails with Error

**Common errors:**

| Error | Cause | Solution |
|-------|-------|----------|
| "Insufficient disk space" | Not enough free space | Free up 500MB+ |
| "Permission denied" | Insufficient permissions | Run as admin/sudo |
| "Database locked" | Another process using data | Close all instances |
| "Encryption failed" | Key derivation error | Check permissions |

---

## Debug Logging

### Enable Debug Logging

1. **Open Settings → Developer**
2. **Enable "Debug Logging"**
3. **Restart app**
4. **Reproduce issue**
5. **Check logs:**
   - Windows: `%APPDATA%\alpaca\logs\`
   - macOS/Linux: `~/.config/alpaca/logs/`

### Log Files

| File | Purpose |
|------|---------|
| `main.log` | Main process logs |
| `renderer.log` | Renderer process logs |
| `vault.log` | Secret_Vault logs |
| `hf-service.log` | HuggingFace service logs |
| `model-loader.log` | Model loader logs |
| `telemetry.log` | Telemetry logs |

### Log Levels

- `DEBUG` - Detailed information for debugging
- `INFO` - General information
- `WARN` - Warning messages
- `ERROR` - Error messages

### Viewing Logs

**Windows:**
```powershell
# View main log
Get-Content "$env:APPDATA\alpaca\logs\main.log" -Tail 100

# Search for errors
Select-String -Path "$env:APPDATA\alpaca\logs\*.log" -Pattern "ERROR"
```

**macOS/Linux:**
```bash
# View main log
tail -100 ~/.config/alpaca/logs/main.log

# Search for errors
grep ERROR ~/.config/alpaca/logs/*.log
```

---

## Error Messages Reference

### Secret_Vault Errors

| Error Code | Message | Cause | Solution |
|-----------|---------|-------|----------|
| `VAULT_NOT_INITIALIZED` | Vault not initialized | Initialization failed | Restart app |
| `SECRET_NOT_FOUND` | Secret does not exist | Secret was deleted | Re-create secret |
| `DECRYPTION_FAILED` | Failed to decrypt secret | Corrupted data | Delete and re-create |
| `CROSS_MACHINE_DETECTED` | Secret from different machine | Machine changed | Re-initialize vault |
| `ENCRYPTION_FAILED` | Failed to encrypt secret | Key derivation error | Check permissions |

### HuggingFace Service Errors

| Error Code | Message | Cause | Solution |
|-----------|---------|-------|----------|
| `REPO_NOT_FOUND` | Repository not found (404) | Invalid repo ID | Verify repo ID |
| `UNAUTHORIZED` | Unauthorized (401) | Token required | Add HF token |
| `RATE_LIMITED` | Rate limited (429) | Too many requests | Wait and retry |
| `DOWNLOAD_FAILED` | Download failed | Network error | Check connection |
| `HASH_MISMATCH` | Hash verification failed | Corrupted file | Delete and retry |

### Model Loader Errors

| Error Code | Message | Cause | Solution |
|-----------|---------|-------|----------|
| `MODEL_NOT_FOUND` | Model file not found | File deleted | Re-download model |
| `INVALID_GGUF` | Invalid GGUF file | Corrupted file | Delete and re-download |
| `QUANTIZATION_MISMATCH` | Quantization not supported | Incompatible model | Use different model |
| `INSUFFICIENT_VRAM` | Insufficient VRAM | GPU memory full | Use smaller model |

### Telemetry Errors

| Error Code | Message | Cause | Solution |
|-----------|---------|-------|----------|
| `DATABASE_ERROR` | Database error | Corrupted database | Delete telemetry DB |
| `INVALID_STAGE` | Invalid stage name | Programming error | Report issue |
| `RECORDING_FAILED` | Failed to record stage | Disk full | Free up disk space |

---

## Getting Help

If you can't resolve the issue:

1. **Check logs:**
   - Enable debug logging
   - Reproduce issue
   - Share relevant log sections

2. **Search existing issues:**
   - GitHub Issues: https://github.com/Hagwell81/alpaca-bonsai/issues
   - Check if issue already reported

3. **Report new issue:**
   - Include error message
   - Include log excerpts
   - Include system information:
     - OS and version
     - App version
     - RAM and disk space
     - Steps to reproduce

4. **Contact support:**
   - Email: support@alpaca.com
   - Discord: https://discord.gg/alpaca

