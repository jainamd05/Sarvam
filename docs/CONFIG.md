# Configuration Guide

This document explains how ELYSIA handles configuration, environment variables, and the precedence order for settings.

## Configuration Hierarchy

ELYSIA uses multiple configuration sources. Settings are applied in this order (later ones override earlier ones):

1. **Defaults** — Built-in defaults in code
2. **Environment Variables (`.env`)** — Read from `.env` file (gitignored, per-user)
3. **Runtime Settings** — User settings stored in `settings.json` (persisted UI choices)
4. **Runtime Overrides** — Command-line or API runtime modifications

---

## Environment Variables

Environment variables are the primary way to configure ELYSIA at startup. Create a `.env` file in the project root (it's gitignored):

```bash
# API Keys
GEMINI_API_KEY=your_gemini_api_key_here

# Server Configuration
PORT=3000
NODE_ENV=development

# Desktop Agent (Python FastAPI)
ELYSIA_AGENT_HOST=127.0.0.1
ELYSIA_AGENT_PORT=8765
ELYSIA_PYTHON=/usr/bin/python3

# Data Directory
ELYSIA_DATA_DIR=~/.elysia

# Browser Automation
ELYSIA_BROWSER_MODE=managed
ELYSIA_CDP_URL=http://127.0.0.1:9222
```

### Environment Variable Reference

| Variable | Purpose | Default | Type |
|----------|---------|---------|------|
| **GEMINI_API_KEY** | Google Gemini API authentication key | (required on first run) | string |
| **PORT** | Node.js server port | `3000` | number |
| **NODE_ENV** | Environment mode (`development`, `production`) | `development` | string |
| **ELYSIA_AGENT_HOST** | Python agent host address | `127.0.0.1` | hostname |
| **ELYSIA_AGENT_PORT** | Python agent port | `8765` | number |
| **ELYSIA_PYTHON** | Path to Python 3 interpreter (for agent fallback) | Auto-detected | path |
| **ELYSIA_DATA_DIR** | Directory for logs, memories, settings, etc. | `~/.elysia` or cwd | path |
| **ELYSIA_BROWSER_MODE** | Browser automation mode: `managed` or `cdp` | `managed` | string |
| **ELYSIA_CDP_URL** | Chrome DevTools Protocol URL (CDP mode only) | `http://127.0.0.1:9222` | URL |

---

## Data Files

All user data is stored as JSON files. The location is configurable via `ELYSIA_DATA_DIR`.

### Data Directory Structure

```
~/.elysia/          (default, or custom via ELYSIA_DATA_DIR)
├── logs/
│   ├── agent.log              # Python agent logs
│   ├── commands.log           # Executed tool commands
│   ├── startup.log            # Startup events
│   ├── errors.log             # Error events
│   ├── nodejs_server.log      # Node server logs
│   └── python_agent.log       # Agent-specific logs
├── memories.json              # Persistent memories (user-created notes)
├── reminders.json             # Active reminders
├── settings.json              # UI user preferences (themes, etc.)
└── secrets.json               # API keys (gitignored, per-user)
```

### Data File Formats

**memories.json** — Array of memory objects:
```json
[
  {
    "id": "uuid-1",
    "category": "work",
    "text": "Important note",
    "createdAt": "2025-09-30T12:00:00Z",
    "updatedAt": "2025-09-30T12:00:00Z"
  }
]
```

**reminders.json** — Array of reminder objects:
```json
[
  {
    "id": "uuid-2",
    "text": "Check email",
    "createdAt": "2025-09-30T12:00:00Z",
    "dueAt": "2025-09-30T13:00:00Z",
    "completed": false
  }
]
```

**settings.json** — User UI preferences:
```json
{
  "autoStart": false,
  "theme": "dark",
  "avatarStyle": "orb",
  "language": "en"
}
```

**secrets.json** — Sensitive credentials (never committed):
```json
{
  "geminiApiKey": "your-api-key-here"
}
```

---

## Configuration by Use Case

### Development Setup

```bash
# .env (development)
NODE_ENV=development
PORT=3000
ELYSIA_AGENT_HOST=127.0.0.1
ELYSIA_AGENT_PORT=8765
ELYSIA_DATA_DIR=./data
ELYSIA_BROWSER_MODE=managed
GEMINI_API_KEY=your_dev_key
```

**Run:**
```bash
npm run dev
python scripts/run_agent.py
```

### Production Setup

```bash
# .env (production)
NODE_ENV=production
PORT=3000
ELYSIA_AGENT_HOST=127.0.0.1
ELYSIA_AGENT_PORT=8765
ELYSIA_DATA_DIR=~/.elysia
ELYSIA_BROWSER_MODE=managed
GEMINI_API_KEY=your_production_key
```

**Build and run:**
```bash
npm run build
npm run start
# Python agent runs automatically on startup
```

### CDP Mode (Connect to Existing Chrome)

Use when you want to connect to an already-running Chrome instance via DevTools Protocol:

```bash
# .env
ELYSIA_BROWSER_MODE=cdp
ELYSIA_CDP_URL=http://127.0.0.1:9222
```

**Launch Chrome with CDP enabled:**
```bash
google-chrome --remote-debugging-port=9222
```

---

## API Key Management

The Gemini API key is required to use ELYSIA. It's managed through a secure flow:

### First-Run Onboarding

1. Launch ELYSIA
2. The UI shows an **API Key Gate** overlay
3. Paste your Gemini API key
4. ELYSIA validates the key and stores it in `secrets.json`

### Obtaining an API Key

1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Click "Get API Key" → "Create API Key"
3. Copy the generated key
4. Paste into ELYSIA's API Key Gate

### Storing the Key Securely

- **Development:** Set `GEMINI_API_KEY` in `.env` (gitignored)
- **Production:** Store in environment via your deployment platform
- **Never commit:** `secrets.json` is gitignored for security

---

## Logger Configuration

ELYSIA uses development-only logging. Logs are disabled in production (`NODE_ENV !== 'development'`).

### Log Levels

- **debug** — Low-priority diagnostic info
- **info** — Standard informational messages
- **warn** — Warning messages (recoverable issues)
- **error** — Error messages (failures, but non-fatal)

### Python Agent Logging

All Python exceptions are now logged (previously silent failures are now visible):

```python
# Example: Connection timeout in browser tool
except Exception as e:
    logging.warning("CDP connection failed, falling back to managed: %s", e)
```

Check logs in `~/.elysia/logs/` to debug issues.

---

## Troubleshooting Configuration

### "Desktop agent not detected"

The Python agent is unreachable. Check:

1. Is Python 3.11+ installed? `python3 --version`
2. Are dependencies installed? `pip install -r agent/requirements.txt`
3. Is Playwright installed? `python3 -m playwright install chromium`
4. Check `~/.elysia/logs/startup.log` for errors

### "API Key was rejected"

Your Gemini API key is invalid or expired:

1. Re-check the key at [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Delete `secrets.json` and re-enter the key in the UI
3. Check that you're not rate-limited (429 errors are transient)

### "Port already in use"

Another process is using port 3000 (or your custom `PORT`):

```bash
# Find and kill the process (macOS/Linux)
lsof -i :3000 | grep LISTEN | awk '{print $2}' | xargs kill -9

# Or use a different port
PORT=3001 npm run dev
```

### Browser automation issues

If browser tools are failing:

1. Check if Chrome/Chromium is installed
2. Try `ELYSIA_BROWSER_MODE=managed` (default is usually better)
3. Check `~/.elysia/logs/commands.log` for the failed command
4. For CDP mode, ensure Chrome is running: `google-chrome --remote-debugging-port=9222`

---

## Advanced Configuration

### Custom Data Directory

Store all data (logs, memories, settings) in a custom location:

```bash
ELYSIA_DATA_DIR=/var/lib/elysia npm run dev
```

### Custom Python Interpreter

If `python3` isn't on your PATH:

```bash
ELYSIA_PYTHON=/opt/python/bin/python3 npm run dev
```

### Debugging Mode

Enable verbose logging:

```bash
NODE_ENV=development npm run dev
```

Check `~/.elysia/logs/` for detailed output.

---

## Configuration Best Practices

1. **Never commit secrets** — `.env` and `secrets.json` are gitignored
2. **Use environment variables in CI/CD** — Don't hardcode keys
3. **Document custom overrides** — If you use non-standard config, document it
4. **Back up data files** — `~/.elysia/` contains user memories and settings
5. **Use version-pinned dependencies** — All Python packages are pinned (see `agent/requirements.txt`)

