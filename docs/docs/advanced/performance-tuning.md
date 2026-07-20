# Performance Tuning

This guide covers optimizing Alpaca for maximum performance.

## Hardware Detection

The app automatically detects your hardware capabilities:

- **CUDA**: NVIDIA GPUs with CUDA support
- **ROCm**: AMD GPUs with ROCm support
- **Vulkan**: Cross-platform GPU acceleration
- **CPU**: Fallback with AVX/AVX2 optimizations

## GPU Acceleration

### NVIDIA (CUDA)

1. Install NVIDIA drivers (version 525.60.13 or later)
2. The app will auto-detect CUDA capability
3. Verify in Settings > Hardware Info

### AMD (ROCm)

1. Install ROCm drivers
2. The app will auto-detect ROCm capability

### Vulkan

1. Install Vulkan drivers
2. Works on NVIDIA, AMD, and Intel GPUs

## Model Optimization

### Quantization Levels

| Level | Size | Quality | Speed |
|-------|------|---------|-------|
| Q4_0 | 25% | Good | Fastest |
| Q4_K_M | 28% | Better | Fast |
| Q5_K_M | 32% | Great | Fast |
| Q6_K | 37% | Excellent | Medium |
| Q8_0 | 50% | Best | Slower |

### Context Length

Reduce context length for faster inference:

```json
{
  "contextLength": 2048
}
```

## System Settings

### Windows

- Enable Hardware-Accelerated GPU Scheduling
- Set high performance power plan
- Disable Windows Search indexing for model directory

### macOS

- Enable Metal GPU acceleration
- Disable Spotlight indexing for model directory

### Linux

- Enable CPU governors for performance mode
- Configure swappiness for low latency

## Benchmarks

Run the built-in benchmark:

```bash
cd desktop
node test-load.js
```

## VRAM Budget Management

The VRAM Budget Manager automatically optimizes GPU memory across multiple models:

- Enable **Multi-Model Mode** in Settings to load several models concurrently
- The scheduler enforces your GPU's memory budget and prevents overload
- If VRAM is insufficient, the scheduler suggests which model to unload
- For MoE models, inactive expert weights are accounted for in estimates

### Manual VRAM Tuning

```json
{
  "vramBudgetMB": 12000,
  "perInstanceOverheadMB": 256
}
```

## Backend Feature Detection

The app probes your llama-server binary to enable cutting-edge features automatically:

| Feature | Effect | Requirement |
|---------|--------|-------------|
| **Turbo Quant** | Faster KV cache with `--type-k` / `--type-v` | Backend build with TURBO support |
| **Speculative Decoding** | Draft-model acceleration | `--speculative` flag available |
| **MTP** | Multi-token prediction | Backend with MTP support |
| **Flash Attention** | Reduced memory & faster attention | `--flash-attn` available |

Check **Settings → Providers → Local Backend** to see detected features.

## Scheduler Tuning

For multi-slot hosting, adjust scheduler behavior:

```json
{
  "scheduler": {
    "maxSlots": 4,
    "healthProbeTimeoutMs": 500,
    "evictionStrategy": "lru"
  }
}
```

## Advanced Settings

### Thread Count

Set optimal thread count based on your CPU:

```json
{
  "threads": 8
}
```

### Batch Size

Increase batch size for better throughput:

```json
{
  "batchSize": 512
}
```

### Memory Mapping

Enable memory mapping for large models:

```json
{
  "mmap": true
}
```
