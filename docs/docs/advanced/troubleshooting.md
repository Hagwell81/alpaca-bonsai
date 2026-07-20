# Troubleshooting Guide

This guide helps you resolve common issues.

## Startup Issues

### App Won't Launch

**Symptoms**: Double-clicking the app does nothing.

**Solutions**:
1. Check Task Manager for running processes
2. Try running as administrator
3. Check Windows Event Viewer for errors
4. Reinstall the application

### Backend Download Fails

**Symptoms**: "Failed to download backend" error.

**Solutions**:
1. Check internet connection
2. Disable firewall temporarily
3. Use manual download option
4. Check proxy settings

### Port Already in Use

**Symptoms**: "Port 13434 is already in use" error.

**Solutions**:
1. Change port in Settings > API Server
2. Find and kill process using port:
   ```powershell
   netstat -ano | findstr 13434
   taskkill /PID <PID> /F
   ```

## Model Issues

### Model Won't Load

**Symptoms**: "Failed to load model" error.

**Solutions**:
1. Verify model format (must be GGUF)
2. Check model file integrity
3. Try a smaller model first
4. Update llama.cpp backend

### Out of Memory

**Symptoms**: System becomes unresponsive during inference.

**Solutions**:
1. Use quantized model (Q4_0 or Q4_K_M)
2. Reduce context length
3. Close other applications
4. Enable memory mapping (mmap)

### Slow Performance

**Symptoms**: Very slow token generation.

**Solutions**:
1. Enable GPU acceleration
2. Reduce context length
3. Use smaller model
4. Check CPU temperature (throttling)

## API Issues

### API Not Responding

**Symptoms**: HTTP requests timeout.

**Solutions**:
1. Check server status in tray menu
2. Restart API server
3. Check firewall rules
4. Verify correct port and host

### Authentication Failed

**Symptoms**: 401 Unauthorized responses.

**Solutions**:
1. Check API key configuration
2. Verify key hasn't expired
3. Regenerate key if needed
4. Check provider status page

## UI Issues

### Blank Screen

**Symptoms**: Window opens but content is blank.

**Solutions**:
1. Wait for backend to load
2. Check developer console (Ctrl+Shift+I)
3. Clear app data
4. Reinstall application

### Settings Not Saving

**Symptoms**: Changes revert after restart.

**Solutions**:
1. Check file permissions
2. Run as administrator
3. Check disk space
4. Verify config file format

## Logs and Diagnostics

### Viewing Logs

Access logs via:
- **Tray Menu**: Right-click > View Service Logs
- **Application Menu**: Help > View Service Logs
- **File**: `%APPDATA%\alpaca\service-logs.txt`

### Diagnostic Mode

Enable verbose logging:

```json
{
  "debug": true,
  "logLevel": "verbose"
}
```

### System Information

Get system info for bug reports:

```powershell
# Windows
systeminfo
nvidia-smi  # If NVIDIA GPU
```

## Getting Help

If issues persist:

1. Check documentation
2. Search GitHub issues
3. Ask in community Discord
4. Submit bug report with logs

## Common Error Codes

| Code | Meaning | Solution |
|------|---------|----------|
| 1001 | Backend not found | Reinstall or manual download |
| 1002 | Port in use | Change port or kill process |
| 1003 | Model corrupt | Re-download model |
| 1004 | Out of memory | Use smaller model |
| 1005 | GPU not found | Update drivers |
