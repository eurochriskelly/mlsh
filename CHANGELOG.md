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
- `mlsh mlcp import|export|copy [job]`: job-file-driven MLCP runs through a bundled ml-gradle
  runner (`gradle/mlcp/`), with jobs stored under `.jobs/mlcp/<operation>/<job>.job`. Missing job
  files open an operation-specific template in `$EDITOR`/`nvim`/`vim`/`vi`; connection details
  always come from the active MLSH environment (or `env_from`/`env_to` named in the job), never
  from the job file itself.
- `mlsh mlcp` with no arguments: an interactive, full-screen job browser (type -> jobs -> view),
  matching `mlsh eval`'s picker conventions, with `r` to run, `e` to edit, and `n` to create a job.
- `insecure=true` environment setting: trusts a self-signed/internal TLS certificate for that
  environment. `curl`-based commands pass `--insecure`; `mlcp` uses a trust-on-first-use Java
  trust store (`~/.mlsh/trust-store.jks`) scoped to that server's own JVM process.
- `mlcp` job runs now capture their full MLCP/Gradle output to a timestamped log file under
  `~/.mlsh/mlcp-logs/` (printed before and after the run), and the job browser's `l` key opens
  that log in `$PAGER`/`less` directly against the real terminal.

### Fixed

- `edit()` (used by `mlsh env` and, as a fallback, `mlsh mlcp`'s job creation/editing outside the
  TUI) now always prefers the real controlling terminal (`/dev/tty`) over the current process's
  own stdio, instead of only doing so in one specific code path. Any editor invocation reachable
  through `mlsh_run` inside the interactive shell was equally vulnerable to the same
  `tee`-pipe/`EAGAIN` crash the MLCP TUI's "new job" flow had; this closes it everywhere at once.
- The MLCP TUI's "new job" flow (`n`) now edits the job file via the same controlling-terminal
  path used everywhere else in MLSH, instead of inheriting the current process's stdio - which
  could crash the interactive shell's `tee`-based session logging with `EAGAIN`/"Resource
  temporarily unavailable" when invoked from inside `mlsh`.
- `insecure=true` environments actually take effect for `mlcp` now: the generated Java trust
  store is explicitly created and loaded as PKCS12 (matching `keytool`'s actual default output
  format since JDK 9), rather than being mislabeled as JKS - a mismatch that made the JVM
  silently fall back to the default trust store and reproduce the original certificate error.
- `mlcp` job runs now print which environment(s) they resolved (host/protocol/insecure) so it's
  obvious at a glance whether `insecure=true` was actually detected for a given run.
- Relative paths in mlcp options (`input_file_path`, `output_file_path`, `output_directory`,
  `conf`, `hadoop_conf_dir`) are now resolved against the directory `mlsh mlcp` was run from,
  instead of the bundled Gradle runner's own directory - previously, the default job templates'
  own relative paths (e.g. `.jobs/mlcp/import/data/001`) would silently fail to be found.
- Bundled a `logback.xml` for the MLCP runner (matching ml-gradle's own mlcp-project example),
  quieting Hadoop's very chatty DEBUG-level logging so mlcp's actual progress/error messages are
  no longer buried in noise.

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
