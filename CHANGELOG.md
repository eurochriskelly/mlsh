# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Preserved the interactive Bash shell as MLSH's primary interface while moving command dispatch and implementations to Node.js.
- Replaced Bash command strings and `eval` calls with structured process argument arrays.
- Moved environment loading, diagnostic logging, MarkLogic requests, eval, logs, modules, Query Console, backups, MLCP, and CoRB orchestration into testable Node modules.
- Reduced the shipped Bash surface to `shell/bashrc`, which owns the prompt, first-class command functions, live environment changes, and session transcript.
- Consolidated installation and usage documentation in `README.md` and raised the Node.js requirement to 18 or later.

### Added

- Direct environment selection with `mlsh env <name>`, plus `mlsh env list` and `mlsh env current`.
- Tests for the installed command route, shell-safe environment generation, password redaction, MLCP copy arguments, and live environment switching inside the interactive shell.
- Module workspace discovery that survives date changes, with explicit `--workspace` selection and clearer load summaries.

### Removed

- Legacy Bash command implementations, duplicate environment-manager packages, obsolete migration helpers, and superseded implementation documents.

## [1.0.0] - 2026-02-18

### Added
- **Interactive Environment Manager CLI** (`mlsh env` / `ce` command)
  - Full CRUD operations for MarkLogic environments
  - Select, create, modify, delete environments with interactive prompts
  - Color-coded terminal output with clear formatting
  - Numbered environment selection menu

- **Global npm Installation**
  - `npm install -g mlsh` support via npm registry
  - `bin/mlsh` Node.js entry point for global command availability
  - Automatic `MLSH_TOP_DIR` discovery from installation location
  - Installation validation and verification

- **Dual-Format Configuration**
  - JSON primary format (`~/.mlshrc.json`) for modern tooling
  - Auto-generated bash format (`~/.mlshrc`) for backward compatibility
  - Seamless synchronization between JSON and bash configs
  - Automatic migration from existing bash configs on first run

- **Configuration Management**
  - Full environment CRUD operations (Create, Read, Update, Delete)
  - Environment validation and duplicate prevention
  - Safe deletion prevention (cannot delete currently-active environment)
  - Persistent JSON storage with bash compatibility layer

- **Comprehensive Documentation**
  - User guides: `README.md`, `INSTALLATION.md`, `CLI_README.md`
  - Developer guides: `NPM_IMPLEMENTATION.md`, `IMPLEMENTATION_SUMMARY.md`
  - Installation troubleshooting and FAQ
  - Architecture diagrams and implementation details

- **Testing**
  - 10 comprehensive unit tests covering all core functionality
  - Configuration parser and generator tests
  - Config manager operation tests
  - Environment validation tests
  - All tests passing (100%)

- **Backward Compatibility**
  - All existing bash commands fully functional (`mlsh eval`, `mlsh logs`, `mlsh mlcp`, `mlsh corb`, etc.)
  - Custom shell integration via `shell/bashrc` with environment aliases
  - Automatic config migration from existing `~/.mlshrc`
  - Works with Node.js 14+

### Fixed
- Environment switching now maintains full compatibility with bash shell
- Configuration synchronization ensures no data loss between formats
- Parser handles edge cases in existing bash configs correctly

### Changed
- Updated `package.json` to support npm global installation
- Enhanced `scripts/config.sh` with Node.js availability detection
- Modified test script to run comprehensive CLI test suite

## Release Notes

### npm Registry Installation
Once published, MLSH can be installed globally with:
```bash
npm install -g mlsh
```

Users can then:
- Manage environments: `mlsh env`
- Access shell aliases: `ce` (environment manager)
- Run MarkLogic commands: `mlsh eval`, `mlsh logs`, `mlsh mlcp`, `mlsh corb`
- View help: `mlsh --help`

### Version Requirements
- Node.js >= 14.0.0
- Works on macOS, Linux, and Windows

### Known Limitations
- Interactive prompts require a TTY (cannot be piped)
- Bash config auto-generation only supports specific environment variable patterns

### Future Enhancements
- GitHub Actions CI/CD with automated publishing
- Installation convenience script (curl | bash)
- Web dashboard for log viewing
- VS Code extension
- Docker image with MLSH pre-installed
- Homebrew distribution
- Environment connectivity validation
- Integration with secret managers
