# MLSH Global NPM Installation Guide

## Overview

MLSH can now be installed globally as an npm package, making it easy to use across your system without manually managing paths or installations.

## Installation Methods

### Method 1: Global Installation from GitHub (Recommended)

```bash
npm install -g git+https://github.com/anomalyco/mlsh.git
```

This installs MLSH globally and makes the `mlsh` command available everywhere.

### Method 2: Install from Local Repository (Development)

If you're developing MLSH:

```bash
cd /path/to/mlsh
npm link
```

This creates a symlink so changes take effect immediately.

### Method 3: Manual npm Install -g (Future, when published to npm registry)

Once published to npm registry:

```bash
npm install -g mlsh
```

## How It Works

### Architecture

```
npm install -g git+https://...
    ↓
Creates symlink in $(npm config get prefix)/bin/mlsh
    ↓
Points to bin/mlsh (Node.js executable)
    ↓
Sets MLSH_TOP_DIR environment variable
    ↓
Delegates to scripts/mlsh.sh (bash implementation)
```

### Files Structure

```
$(npm config get prefix)/lib/node_modules/mlsh/
├── bin/
│   └── mlsh                    # Entry point (Node.js script)
├── scripts/
│   ├── mlsh.sh                # Main dispatcher
│   ├── config.sh              # Environment manager
│   ├── eval.sh                # XQuery evaluator
│   ├── logs.sh                # Log viewer
│   └── ...
├── cli/
│   ├── env-manager.js         # Interactive environment CLI
│   ├── lib/
│   └── package.json
├── init.sh                    # Initialization script
├── mlshrc.template            # Config template
├── package.json               # npm metadata
└── shell/                     # Interactive shell configs
```

## Usage

### Start Interactive MLSH Shell

```bash
mlsh
```

This:
1. Sources your ~/.mlshrc configuration
2. Starts a bash shell with MLSH commands available
3. Provides interactive shell with custom prompt and aliases

### Run Commands Directly

```bash
mlsh env              # Interactive environment manager
mlsh eval script.xq   # Evaluate XQuery
mlsh logs             # View MarkLogic logs
mlsh mlcp --help      # Run MLCP
mlsh corb --help      # Run CoRB
```

### Initialize Configuration

On first use:

```bash
mlsh init
```

This creates `~/.mlshrc` from the template with default settings.

## Node.js Entry Point

The `bin/mlsh` script (Node.js) handles:

1. **Environment Setup**: Sets `MLSH_TOP_DIR` to the installation directory
2. **Validation**: Checks that required files exist
3. **Command Routing**: 
   - No arguments → Start interactive shell with init.sh
   - With arguments → Execute bash scripts/mlsh.sh
4. **Error Handling**: Clear error messages if installation is incomplete

### Source Code Snippet

```javascript
// Set installation directory
const MLSH_TOP_DIR = path.resolve(__dirname, '..');

// Validate installation
const requiredFiles = ['scripts/mlsh.sh', 'init.sh', 'mlshrc.template'];
if (missingFiles.length > 0) {
  console.error('Installation incomplete');
  process.exit(1);
}

// Set environment
process.env.MLSH_TOP_DIR = MLSH_TOP_DIR;

// Delegate to bash
spawn('bash', [path.join(MLSH_TOP_DIR, 'scripts/mlsh.sh'), ...args], {
  stdio: 'inherit',
  env: { ...process.env, MLSH_TOP_DIR }
});
```

## Configuration

After installation, configure MLSH by editing `~/.mlshrc`:

```bash
# Set current environment
export ML_ENV=local

# Define your environments
case $ML_ENV in
  local)
    export ML_HOST=localhost
    export ML_PORT=8000
    export ML_USER=admin
    export ML_PASS=admin
    export ML_PROTOCOL=http
    ;;
  
  production)
    export ML_HOST=prod.example.com
    export ML_PORT=8000
    export ML_USER=ml_admin
    export ML_PROTOCOL=https
    ;;
esac
```

## Interactive Environment Manager

Once installed, use the new interactive environment manager:

```bash
mlsh env
```

Features:
- Numbered list of environments
- Shows current environment with connection details
- Select environments with number or letter menu
- Create, modify, delete environments
- Password input is secure (hidden)

## Troubleshooting

### "command not found: mlsh"

Check that npm global bin is in your PATH:

```bash
# Show npm's global bin directory
npm config get prefix

# Check if it's in PATH
echo $PATH

# If not, add to ~/.bashrc or ~/.zshrc
export PATH="$(npm config get prefix)/bin:$PATH"

# Then source the file
source ~/.bashrc
```

### "No such file or directory: scripts/mlsh.sh"

This means the installation is incomplete. Reinstall:

```bash
npm uninstall -g mlsh
npm install -g git+https://github.com/anomalyco/mlsh.git
```

### MLSH_TOP_DIR errors

The Node.js wrapper should set this automatically. If you see errors:

1. Verify the command is linked correctly:
   ```bash
   which mlsh
   cat $(which mlsh)  # Should show Node.js script
   ```

2. Check installation structure:
   ```bash
   MLSH_INSTALL=$(npm config get prefix)/lib/node_modules/mlsh
   ls -la $MLSH_INSTALL/scripts/
   ```

3. Try reinstalling:
   ```bash
   npm install -g git+https://github.com/anomalyco/mlsh.git --force
   ```

### "No environment selected" error

Before running most MLSH commands, select an environment:

```bash
# Interactive selection
mlsh env

# Or set directly in ~/.mlshrc
export ML_ENV=local
```

## Upgrading

To upgrade to the latest version:

```bash
npm install -g git+https://github.com/anomalyco/mlsh.git@latest
```

To downgrade to a specific version:

```bash
npm install -g git+https://github.com/anomalyco/mlsh.git#v1.0.0
```

## Uninstalling

To remove MLSH:

```bash
npm uninstall -g mlsh
```

This removes the command and all associated files.

## Advanced Usage

### Running Commands Programmatically

You can call MLSH commands from scripts:

```bash
#!/bin/bash
mlsh eval ~/my-script.xq
mlsh logs show-errors
mlsh mlcp --input-uri-pattern ".*\.xml" --input-file-path "./documents"
```

### Using in Shell Scripts

```bash
#!/bin/bash

# Set environment
export MLSH_TOP_DIR=$(npm config get prefix)/lib/node_modules/mlsh
source $MLSH_TOP_DIR/init.sh

# Now you can use MLSH functions
mlsh eval my-script.xq
```

### Custom Bash Configuration

After initialization, your `~/.mlshrc` can be extended:

```bash
# Add custom paths
export MY_SCRIPTS=~/marklogic/scripts

# Add custom functions
eval_all() {
  for script in $MY_SCRIPTS/*.xq; do
    mlsh eval "$script"
  done
}
```

## Development

### Contributing

To work on MLSH development:

```bash
# Clone the repository
git clone https://github.com/anomalyco/mlsh.git
cd mlsh

# Install dependencies
npm install
cd cli && npm install && cd ..

# Link for development
npm link

# Test the command
mlsh --help
mlsh env
```

### Testing Installation

After making changes:

```bash
# Test the entry point
node bin/mlsh --help

# Test with npm link
npm link
mlsh env
```

## Summary

With MLSH as a global npm package:

- ✓ Install once, use everywhere: `npm install -g git+https://...`
- ✓ No manual path management needed
- ✓ Easy to update: `npm install -g ...@latest`
- ✓ Easy to uninstall: `npm uninstall -g mlsh`
- ✓ Works with Node.js version management (nvm, fnm, etc.)
- ✓ Can be published to npm registry in the future
- ✓ Professional distribution method
- ✓ Works globally across all projects

## Related Documentation

- [README.md](./README.md) - Project overview
- [INSTALLATION.md](./INSTALLATION.md) - Basic installation
- [CLI_README.md](./CLI_README.md) - Environment manager guide
- [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) - Technical architecture
