# MLSH Installation Guide

## Global Installation (Recommended)

Install MLSH globally from GitHub:

```bash
npm install -g git+https://github.com/anomalyco/mlsh.git
```

Then use it anywhere:

```bash
mlsh          # Start interactive MLSH shell
mlsh env      # Change environment
mlsh eval     # Evaluate XQuery/JavaScript
mlsh logs     # View MarkLogic logs
```

## Quick Start

After installation, MLSH will guide you through the first-time setup:

```bash
mlsh init
```

This creates `~/.mlshrc` with your environment configuration.

## Configuration

Edit your environment configuration in `~/.mlshrc`:

```bash
# Set your current environment
export ML_ENV=local

# Define environments
case $ML_ENV in
  local)
    export ML_HOST=localhost
    export ML_PORT=8000
    export ML_USER=admin
    export ML_PASS=admin
    ;;
  production)
    export ML_HOST=prod.example.com
    export ML_PORT=8000
    # ... etc
    ;;
esac
```

## Interactive Environment Manager

After installation, you can use the new interactive environment manager:

```bash
mlsh env
# or
ce    # (shortcut when in MLSH shell)
```

This provides an interactive menu to:
- Select environments
- Create new environments
- Modify environment variables
- Delete environments

## Upgrade

To upgrade MLSH to the latest version:

```bash
npm install -g git+https://github.com/anomalyco/mlsh.git@latest
```

Or if you want a specific version:

```bash
npm install -g git+https://github.com/anomalyco/mlsh.git#v1.0.0
```

## Uninstall

To remove MLSH:

```bash
npm uninstall -g mlsh
```

## Troubleshooting

### Command not found

If you get "command not found: mlsh" after installation:

1. Check that npm global bin directory is in your PATH:
   ```bash
   echo $PATH
   npm config get prefix
   ```

2. Add npm global bin to PATH if needed (in your ~/.bashrc or ~/.zshrc):
   ```bash
   export PATH="$(npm config get prefix)/bin:$PATH"
   ```

3. Reinstall MLSH:
   ```bash
   npm install -g git+https://github.com/anomalyco/mlsh.git
   ```

### No environment selected error

When running `mlsh` commands, you must first select an environment:

```bash
mlsh env    # Opens interactive environment manager
```

Or set it in ~/.mlshrc with `export ML_ENV=local`.

### MLSH_TOP_DIR not set

If you see "MLSH_TOP_DIR not set" or similar errors:

1. The Node.js wrapper should set this automatically
2. If problems persist, verify installation:
   ```bash
   which mlsh
   cat $(which mlsh)
   ```

3. Check that the installation directory is complete:
   ```bash
   ls -la $(npm config get prefix)/lib/node_modules/mlsh/
   ```

## Usage Examples

### Run commands directly

```bash
# Change environment
mlsh env

# Evaluate a script
mlsh eval my-script.xqy

# View logs
mlsh logs show-errors

# Run MLCP
mlsh mlcp --help

# Run CoRB
mlsh corb --help
```

### Interactive Shell

Start the full MLSH shell:

```bash
mlsh
```

Inside the shell, use shortcuts:

```
h|helpme   - Show help
ce|chenv   - Change environment
q|qconsole - Query Console
e|eval     - Evaluate scripts
l|logs     - View logs
mod|module - Manage modules
```

## Development

### Local Installation (for development)

If you're developing MLSH, you can install from your local repository:

```bash
npm install -g file:///path/to/mlsh
```

Or create a symlink:

```bash
npm link /path/to/mlsh
```

Then test changes:

```bash
mlsh --help
```

### Run Tests

```bash
cd /path/to/mlsh
npm test
```

### Interactive Environment Manager Tests

```bash
cd /path/to/mlsh/cli
npm install  # if not already done
node test-cli.js
```

## System Requirements

- **Node.js**: 14.0.0 or higher
- **Bash**: 3.0 or higher
- **OS**: Linux, macOS, or Windows (with WSL2)

## Files Included

```
mlsh/
├── bin/mlsh              - Entry point (Node.js executable)
├── cli/                  - Interactive environment manager
├── scripts/              - Bash implementation of MLSH
├── shell/                - Interactive shell environment
├── init.sh               - Initialization script
├── mlshrc.template       - Configuration template
├── package.json          - npm package metadata
└── README.md             - Project documentation
```

## After Installation

1. **Create ~/.mlshrc**:
   ```bash
   mlsh init
   ```

2. **Configure your environments**:
   Edit `~/.mlshrc` with your MarkLogic server details

3. **Select a default environment**:
   ```bash
   export ML_ENV=local
   ```

4. **Test your setup**:
   ```bash
   mlsh logs show-errors
   ```

## Support & Issues

Report bugs or feature requests at:
https://github.com/anomalyco/mlsh/issues

See full documentation:
- [README.md](./README.md) - Project overview
- [CLI_README.md](./CLI_README.md) - Environment manager guide
- [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) - Technical details
