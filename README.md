# Sona Router

A command-line application that routes Claude Code requests to local LLM providers like LM Studio and Ollama.

## Features

- Routes Anthropic/Claude API requests to local LLM providers
- Supports both LM Studio and Ollama (OpenAI-compatible endpoints)
- Streaming support for real-time responses
- Configurable via YAML config file or CLI options
- LM Studio is the default provider

## Installation

```bash
npm install
npm run build
```

For global installation:

```bash
npm install -g .
```

## Quick Start

1. Initialize the configuration:

```bash
sona-router init
```

2. Start the router:

```bash
sona-router start
```

3. Configure Claude Code to use the router by setting the environment variable:

```bash
# Windows (PowerShell)
$env:ANTHROPIC_BASE_URL = "http://localhost:9001"

# Windows (CMD)
set ANTHROPIC_BASE_URL=http://localhost:9001

# Linux/macOS
export ANTHROPIC_BASE_URL=http://localhost:9001
```

**Note:** Claude Code uses `ANTHROPIC_BASE_URL` (not `ANTHROPIC_API_URL`). The base URL should NOT include `/v1` as Claude Code appends the path automatically.

To set this permanently:

**Windows (System Environment Variable):**
1. Open System Properties → Advanced → Environment Variables
2. Under "User variables", click "New"
3. Variable name: `ANTHROPIC_BASE_URL`
4. Variable value: `http://localhost:9001`

**Linux/macOS (add to ~/.bashrc or ~/.zshrc):**
```bash
export ANTHROPIC_BASE_URL=http://localhost:9001
```

## Configuration

### Configuration File

Running `sona-router init` creates a `sona-router.config.yaml` file:

```yaml
provider: lmstudio
port: 9001
lmstudio:
  baseUrl: http://localhost:1234/v1
  model: local-model
ollama:
  baseUrl: http://localhost:11434/v1
  model: llama2
```

### CLI Commands

#### Start the Router

```bash
# Start with default config
sona-router start

# Start with custom options
sona-router start --port 9000 --provider ollama --model codellama
```

#### View/Modify Configuration

```bash
# View current config
sona-router config

# Set provider
sona-router config --provider ollama

# Set port
sona-router config --port 9000

# Set LM Studio settings
sona-router config --lmstudio-url http://localhost:1234/v1 --lmstudio-model mistral

# Set Ollama settings
sona-router config --ollama-url http://localhost:11434/v1 --ollama-model codellama
```

#### Quick Provider Switching

```bash
# Switch to LM Studio
sona-router use lmstudio

# Switch to Ollama
sona-router use ollama
```

#### Set Model

```bash
# Set model for current provider
sona-router model codellama

# Set model for specific provider
sona-router model mistral --provider lmstudio
```

## Provider Setup

### LM Studio

1. Download and install [LM Studio](https://lmstudio.ai/)
2. Load a model in LM Studio
3. Start the local server (default: http://localhost:1234)
4. The router will automatically use LM Studio as the default provider

### Ollama

1. Install [Ollama](https://ollama.ai/)
2. Pull a model: `ollama pull llama2`
3. Ollama runs automatically at http://localhost:11434
4. Switch the router to Ollama: `sona-router use ollama`

## API Endpoints

The router exposes these endpoints:

- `POST /v1/messages` - Claude Messages API (main endpoint)
- `POST /v1/complete` - Alias for messages
- `GET /v1/models` - List available models
- `GET /health` - Health check

## How It Works

1. The router starts an HTTP server that mimics the Anthropic API
2. When Claude Code sends a request, the router intercepts it
3. The request is translated from Claude format to OpenAI format
4. The translated request is sent to the configured local LLM provider
5. The response is translated back to Claude format and returned

## Development

```bash
# Run in development mode
npm run dev

# Build for production
npm run build

# Run built version
npm start
```

## License

MIT
