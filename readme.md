# kaks CLI

AI-powered developer assistant and workspace launcher for Windows-first workflows.

**Status:** Work in progress. Core commands are implemented and usable.

## What works today
- `kaks init` interactive setup for provider, model, editor, and optional project registration
- `kaks ask` AI Q&A with optional clipboard copy
- `kaks explain` AI file explanations with detail/section controls
- `kaks summarize` log summarization with local JSON summary and optional AI insight
- `kaks open` open project editor, browser URLs, and file explorer
- `kaks start` run configured services concurrently (attached or detached)
- `kaks go` normalize/open/copy/print URLs quickly
- `kaks config` set/get/list/add-project/remove-project/edit global config

## Install (local dev)
```bash
git clone https://github.com/ArushKhasru/Kaks.git
cd kaks
npm install
npm link
```

Then run:
```bash
kaks --help
```

You can also run directly:
```bash
node cli.js --help
```

## Quick start
```bash
kaks init
kaks ask "How do I read a file async in Node.js?"
kaks explain package.json
kaks summarize app.log --tail 200
kaks open myapp
kaks start myapp
kaks go github.com
```

## Configuration
Global config is stored at `~/.kaks/config.json`. Project-local config is `.kaks.json`.

Environment variables:
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`

`kaks init` can also write the key into a local `.env` file.

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

`kaks ask` reads `ai.context` from `.kaks.json` to enrich prompts.

## AI providers
- **Gemini**: uses `GEMINI_API_KEY`
- **OpenAI**: uses `OPENAI_API_KEY`
- **Ollama**: uses `http://localhost:11434` with no API key
