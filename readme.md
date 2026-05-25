# perky CLI

AI-powered developer assistant and workspace launcher for Windows-first workflows.

**Status:** Work in progress. Core commands are implemented and usable.

## What works today
- `perky init` interactive setup for provider, model, editor, and optional project registration
- `perky ask` AI Q&A with optional clipboard copy
- `perky explain` AI file explanations with detail/section controls
- `perky summarize` log summarization with local JSON summary and optional AI insight
- `perky open` open project editor, browser URLs, terminal, and file explorer
- `perky start` run configured services concurrently (attached or detached)
- `perky go` normalize/open/copy/print URLs quickly
- `perky config` set/get/list/add-project/remove-project/edit global config

## Install (local dev)
```bash
git clone https://github.com/ArushKhasru/perky.git
cd perky
npm install
npm link
```

Then run:
```bash
perky --help
```

You can also run directly:
```bash
node cli.js --help
```

## Quick start
```bash
perky init
perky ask "How do I read a file async in Node.js?"
perky explain package.json
perky summarize app.log --tail 200
perky open myapp
perky start myapp
perky go github.com
```

## Configuration
Global config is stored at `~/.perky/config.json`. Project-local config is `.perky.json`.

Environment variables:
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`

`perky init` can also write the key into a local `.env` file.

Example config:
```jsonc
{
  "ai": {
    "provider": "gemini",
    "model": "gemini-2.0-flash",
    "temperature": 0.7,
    "maxTokens": 2048
  },
  "projects": {
    "myapp": {
      "path": "D:\\projects\\myapp",
      "browser": "http://localhost:3000",
      "editor": "code",
      "services": [
        { "name": "frontend", "cmd": "npm run dev", "cwd": "./client", "port": 3000 },
        { "name": "backend", "cmd": "npm run dev", "cwd": "./server", "port": 5000 }
      ]
    }
  },
  "defaults": {
    "editor": "code",
    "browser": "default",
    "shell": "powershell"
  }
}
```

`perky ask` reads `ai.context` from `.perky.json` to enrich prompts.

## AI providers
- **Gemini**: uses `GEMINI_API_KEY`
- **OpenAI**: uses `OPENAI_API_KEY`
- **Ollama**: uses `http://localhost:11434` with no API key
