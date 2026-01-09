# Git Worktree Runner - Command Reference

## Installation

```bash
git clone https://github.com/coderabbitai/git-worktree-runner.git
cd git-worktree-runner
sudo ln -s "$(pwd)/bin/git-gtr" /usr/local/bin/git-gtr
```

Requirements:
- Git 2.5+ (worktree support)
- Bash 3.2+ (4.0+ recommended)
- Optional: bash-completion v2+ for shell completions

## Commands

### git gtr new

Create a new worktree.

```bash
git gtr new <branch> [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--force`, `-f` | Allow creating worktree even if branch exists |
| `--name <name>` | Custom folder name instead of branch name |
| `--yes`, `-y` | Skip confirmation prompts |
| `--no-copy` | Skip copying files after creation |
| `--base <branch>` | Base branch to create from (default: main/master) |

**Examples:**
```bash
git gtr new feature-auth
git gtr new feature --force --name backend
git gtr new hotfix --yes --no-copy
git gtr new feature --base develop
```

### git gtr list

List all worktrees for the current repository.

```bash
git gtr list [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--json` | Output in JSON format |
| `--porcelain` | Machine-readable output |

### git gtr editor

Open a worktree in the configured editor.

```bash
git gtr editor <branch> [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--editor <name>` | Override default editor (cursor, vscode, zed) |

**Examples:**
```bash
git gtr editor feature-auth
git gtr editor feature --editor vscode
```

### git gtr ai

Launch an AI coding tool in the worktree.

```bash
git gtr ai <branch> [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--ai <tool>` | Override default AI tool |

**Supported AI tools:**
- `claude` - Claude Code CLI
- `aider` - Aider
- `codex` - OpenAI Codex
- `continue` - Continue
- `cursor` - Cursor AI

**Examples:**
```bash
git gtr ai feature-auth
git gtr ai feature --ai aider
```

### git gtr run

Execute a command in the worktree directory.

```bash
git gtr run <branch> <command> [args...]
```

**Examples:**
```bash
git gtr run feature npm test
git gtr run feature npm run build
git gtr run feature git status
git gtr run feature "npm install && npm test"
```

### git gtr go

Print the worktree path (useful for navigation).

```bash
git gtr go <branch>
```

**Usage for navigation** (note the quotes for paths with spaces):
```bash
cd "$(git gtr go feature)"
```

### git gtr rm

Remove one or more worktrees.

```bash
git gtr rm <branch> [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--yes`, `-y` | Skip confirmation prompts |
| `--delete-branch` | Also delete the branch after removing worktree |
| `--force`, `-f` | Force removal even with uncommitted changes |
| `--all`, `-a` | Remove all worktrees |

**Examples:**
```bash
git gtr rm feature-auth
git gtr rm feature --yes --delete-branch
git gtr rm --all --yes
```

### git gtr copy

Copy/sync files to worktrees.

```bash
git gtr copy <target> [options] [-- patterns...]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--all`, `-a` | Copy to all worktrees |
| `--dry-run` | Show what would be copied |

**Examples:**
```bash
git gtr copy feature -- ".env*" "*.json"
git gtr copy -a -- ".env*"
git gtr copy feature --dry-run -- "*.config.js"
```

### git gtr config

Manage gtr configuration.

```bash
git gtr config <subcommand> [options]
```

**Subcommands:**
- `list` - Show all configuration
- `get <key>` - Get a configuration value
- `set <key> <value>` - Set a configuration value
- `unset <key>` - Remove a configuration value

## Configuration Keys

### Worktree Settings

| Key | Description | Default |
|-----|-------------|---------|
| `gtr.worktrees.dir` | Base directory for worktrees | `../` |
| `gtr.worktrees.prefix` | Folder name prefix | `""` |
| `gtr.defaultBranch` | Default base branch | `main` or `master` |

### Editor Settings

| Key | Description | Default |
|-----|-------------|---------|
| `gtr.editor.default` | Default editor | `cursor` |

**Supported editors:** `cursor`, `vscode`, `zed`

### AI Tool Settings

| Key | Description | Default |
|-----|-------------|---------|
| `gtr.ai.default` | Default AI tool | `claude` |

**Supported tools:** `claude`, `aider`, `codex`, `continue`, `cursor`

### File Copy Settings

| Key | Description | Example |
|-----|-------------|---------|
| `gtr.copy.include` | Patterns to copy | `.env*,*.local` |
| `gtr.copy.exclude` | Patterns to exclude | `*.log,*.tmp` |
| `gtr.copy.includeDirs` | Directories to copy | `node_modules` |
| `gtr.copy.excludeDirs` | Nested dirs to exclude | `.git,dist` |

### Hook Settings

| Key | Description |
|-----|-------------|
| `gtr.hook.postCreate` | Command after worktree creation |
| `gtr.hook.preRemove` | Command before worktree removal |
| `gtr.hook.postRemove` | Command after worktree removal |

**Hook Environment Variables**: Hooks receive these exported variables:
- `REPO_ROOT` - Repository root path
- `WORKTREE_PATH` - Worktree directory location
- `BRANCH` - Branch name being created/removed

**Hook examples:**
```bash
git gtr config set gtr.hook.postCreate "npm install"
git gtr config set gtr.hook.preRemove "npm run clean"
git gtr config set gtr.hook.postRemove "echo 'Removed $BRANCH'"
```

## Configuration Precedence

1. Local git config (`.git/config`)
2. Repository `.gtrconfig` file
3. Global git config (`~/.gitconfig`)
4. System configuration
5. Environment variables
6. Built-in defaults

## Platform Support

- macOS (Ventura and newer)
- Linux (Ubuntu, Fedora, Arch, etc.)
- Windows (Git Bash or WSL2)
