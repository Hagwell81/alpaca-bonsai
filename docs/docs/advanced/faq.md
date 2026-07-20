# Frequently Asked Questions

## General Questions

### What is Alpaca?

Alpaca is a desktop application that provides a local AI chat interface using llama.cpp, with support for multiple AI providers, multi-agent services, and an integrated development environment.

### Is my data private?

Yes. All processing happens locally on your machine. No data is sent to external servers unless you explicitly configure external API providers.

### What models are supported?

Any GGUF format model compatible with llama.cpp, including:
- Llama 2/3
- Mistral
- Qwen
- Phi
- Gemma
- And many more

## Installation

### The app won't start

1. Check that you have Node.js 18+ installed
2. Verify the backend binary downloaded correctly
3. Check the service logs: Help > View Service Logs

### Where are models stored?

Models are stored in `%APPDATA%\alpaca\models` on Windows.

## Usage

### How do I add a new model?

1. Go to Settings > Models
2. Click "Add Model"
3. Enter the model URL or path
4. The app will download and verify the model

### Can I use the API from other applications?

Yes! The app exposes an OpenAI-compatible API at `http://localhost:13434/v1`. See the API Reference for details.

## Troubleshooting

### Server won't start

Check the service logs for error messages. Common issues:
- Port already in use
- Missing backend binary
- Incompatible model format

### Slow performance

- Enable GPU acceleration in Settings
- Use a smaller model
- Close other applications

## Development

### How do I contribute?

See the Contributing guide in the Development section.

### Where is the source code?

The project is open source. Check the GitHub repository for the latest code.
