# MLSH Environment Manager - Node.js Interactive CLI

An interactive, user-friendly environment manager for MLSH built with Node.js.

## Features

✨ **Interactive Menu**
- Clean, numbered environment list
- Current environment highlighted with connection details
- Quick selection with numbers or keyboard shortcuts

🎯 **Environment Operations**
- **Select**: Switch between environments
- **Create**: Add new MarkLogic environments with validation
- **Modify**: Edit individual environment variables
- **Delete**: Remove environments (with confirmation)
- **Back**: Return to previous menu

🔄 **Automatic Migration**
- Automatically migrates existing `~/.mlshrc` files
- Converts bash case statements to JSON format
- Creates backup of original config
- Syncs JSON back to bash for compatibility

🛡️ **Safety & Validation**
- Prevents deletion of current environment
- Input validation for environment names
- Secure password prompts (hidden input)
- Confirmation prompts for destructive operations

## Architecture

```
cli/
├── env-manager.js          # Main CLI application
├── package.json            # Dependencies (prompts library)
├── lib/
│   ├── config.js          # Config manager (read/write JSON)
│   ├── parser.js          # Parse bash config & generate bash from JSON
│   └── formatter.js       # CLI display formatting & colors
```

## Configuration Files

### `~/.mlshrc.json` (Primary Config)
Node.js manages this JSON file with environment definitions:

```json
{
  "environments": {
    "local": {
      "ML_HOST": "localhost",
      "ML_PORT": 8000,
      "ML_USER": "admin",
      "ML_PASS": "admin",
      "ML_PROTOCOL": "http",
      "ML_MODULES_DB": "modules",
      "ML_CONTENT_DB": "content"
    },
    "production": {
      "ML_HOST": "prod.example.com",
      "ML_PORT": 8000,
      "ML_USER": "ml_admin",
      "ML_PASS": "***",
      "ML_PROTOCOL": "https",
      "ML_MODULES_DB": "modules",
      "ML_CONTENT_DB": "content"
    }
  },
  "currentEnv": "local"
}
```

### `~/.mlshrc` (Bash Config)
Auto-generated from JSON, maintains bash compatibility:

```bash
#!/bin/bash
# Auto-generated MLSH configuration
export ML_ENV=local

case $ML_ENV in
  local)
    export ML_HOST=localhost
    export ML_PORT=8000
    # ...
    ;;
  production)
    export ML_HOST=prod.example.com
    # ...
    ;;
esac
```

## Usage

### Interactive CLI

```bash
# From MLSH shell
ce

# Or directly
npm run env-manager

# Or with node
node cli/env-manager.js
```

### UI Flow

```
╭─────────────────────────────────────────────────╮
│   MLSH - Environment Manager                    │
│                                                 │
│   Current Environment: local                    │
│   http://localhost:8000 (admin)                 │
│                                                 │
│   Available Environments:                       │
│   ✓ 1. local [http://localhost:8000 (admin)]   │
│     2. odct  [http://odct:8000 (user)]         │
│     3. accs  [https://accs:8000 (admin)]       │
│     4. prod  [https://prod:8000 (ml_admin)]    │
│                                                 │
│   Options: [1-4] Select | [C]reate | [D]elete  │
│            | [M]odify | [B]ack                 │
│                                                 │
│   Your choice: _                                │
╰─────────────────────────────────────────────────╯
```

### Menu Options

**Select Environment** (type `1`, `2`, etc.)
- Shows environment details
- Lists all exported variables
- Switches to selected environment
- Returns to main menu

**Create** (`C`)
- Prompts for environment name
- Collects: ML_HOST, ML_PORT, ML_USER, ML_PASS, ML_PROTOCOL
- Optional: ML_MODULES_DB, ML_CONTENT_DB
- Validates input
- Adds to config

**Modify** (`M`)
- Select environment to modify
- Choose field to edit
- Update with new value
- Save and return to menu

**Delete** (`D`)
- Select environment to delete
- Shows confirmation
- Prevents deleting current environment
- Removes from config

**Back** (`B`)
- Exit to shell

## Setup & Installation

### Prerequisites
- Node.js 14+ (for `async/await` and ES modules)
- Bash shell

### First Run
1. Run `ce` or `npm run env-manager`
2. If no config exists, CLI automatically:
   - Detects existing `~/.mlshrc` (if present)
   - Migrates bash config to `~/.mlshrc.json`
   - Generates new `~/.mlshrc` from JSON
   - Creates backup at `~/.mlshrc.backup`

### Manual Migration
If you want to manually trigger migration:
```bash
bash migrate.sh
```

## Integration with MLSH

The new CLI is integrated into `scripts/config.sh`:

1. When you run `ce` in MLSH, it detects Node.js availability
2. If Node.js is available, launches the interactive CLI
3. If Node.js is not available, falls back to simple bash menu
4. After exit, sources the updated `~/.mlshrc` to load environment

### Backward Compatibility
- ✓ Works if Node.js not installed (uses bash fallback)
- ✓ Maintains bash `.mlshrc` file for all tools
- ✓ Existing shell scripts continue to work unchanged
- ✓ All environment variables exported properly

## Development

### File Structure
```
cli/
├── env-manager.js         (450 lines) Main interactive CLI
├── lib/config.js          (150 lines) Config read/write
├── lib/parser.js          (80 lines)  Bash parser & generator  
├── lib/formatter.js       (50 lines)  Display utilities
├── package.json           CLI dependencies
└── node_modules/          (prompts library)

scripts/
└── config.sh              Modified to call Node.js CLI

Helpers:
├── test-setup.sh          Validation & setup test
└── migrate.sh             Manual migration utility
```

### Dependencies
- **prompts** (^2.4.2) - Lightweight interactive CLI library (~8KB)
  - Text input
  - Select/multi-select
  - Password prompts
  - Confirmation dialogs
  - Validation support

### Code Quality
- ✓ ES6+ modules (import/export)
- ✓ Async/await for file operations
- ✓ Error handling & validation
- ✓ Formatted console output with Unicode symbols
- ✓ No external dependencies beyond `prompts`

## Troubleshooting

### "No config found"
- First run? CLI creates default config automatically
- Existing `.mlshrc`? CLI auto-migrates on first run

### "Environment contains unknown variable"
- Check `~/.mlshrc.json` for typos
- Edit directly if needed (JSON format)
- CLI will regenerate bash config on save

### Node.js not found
- Install Node.js: https://nodejs.org/
- Or MLSH falls back to bash menu automatically

### Can't delete current environment
- By design - prevents breaking your shell
- Switch to different environment first, then delete

## Future Enhancements

Potential improvements:
- Test connectivity before switching
- Environment templates (dev/staging/prod patterns)
- Export/import configs
- Environment groups/favorites
- SSH/tunnel configuration
- Secrets manager integration

## Support

Found an issue? Report at: https://github.com/anomalyco/mlsh/issues
