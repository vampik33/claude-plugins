# Git Worktree Runner Plugin for Claude Code

A Claude Code plugin for managing git worktrees using [git-worktree-runner](https://github.com/coderabbitai/git-worktree-runner).

## Prerequisites

**Important**: Install git-worktree-runner first:

```bash
git clone https://github.com/coderabbitai/git-worktree-runner.git
cd git-worktree-runner
sudo ln -s "$(pwd)/bin/git-gtr" /usr/local/bin/git-gtr
```

Verify installation: `git gtr --version`

## Installation

### Option 1: Install from Marketplace (Recommended)

Add the marketplace and install:
```
/plugin marketplace add vampik33/claude-plugins
/plugin install gtr
```

Or use the `/plugin` menu to browse and install.

### Option 2: Install from local directory (development)

```bash
claude --plugin-dir /path/to/claude-plugins/plugins/gtr
```

### Option 3: Add to project settings

Add to your project's `.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "gtr": {
      "source": "/path/to/claude-plugins/plugins/gtr"
    }
  }
}
```

## Slash Commands

| Command | Description |
|---------|-------------|
| `/gtr:new <branch>` | Create new worktree |
| `/gtr:list` | List all worktrees |
| `/gtr:rm <branch>` | Remove worktree |
| `/gtr:ai <branch>` | Launch AI tool in worktree |
| `/gtr:editor <branch>` | Open worktree in editor |
| `/gtr:run <branch> <cmd>` | Run command in worktree |
| `/gtr:go <branch>` | Get worktree path |
| `/gtr:config` | Configure settings |
| `/gtr:copy` | Copy files to worktrees |
| `/gtr:status` | Check installation and config |

## Quick Start

```bash
# Check installation
/gtr:status

# Create worktree for a feature
/gtr:new feature-auth

# Open in your editor
/gtr:editor feature-auth

# Launch AI tool in the worktree
/gtr:ai feature-auth

# Run tests
/gtr:run feature-auth npm test

# Clean up when done
/gtr:rm feature-auth
```

## Configuration

Set defaults with `/gtr:config`:

```bash
/gtr:config set gtr.editor.default cursor
/gtr:config set gtr.ai.default claude
/gtr:config set gtr.copy.include ".env*,*.local"
/gtr:config set gtr.hook.postCreate "npm install"
```

## Troubleshooting

### "gtr: command not found" or "git: 'gtr' is not a git command"

git-worktree-runner is not installed or not in PATH. Install it:

```bash
git clone https://github.com/coderabbitai/git-worktree-runner.git
cd git-worktree-runner
sudo ln -s "$(pwd)/bin/git-gtr" /usr/local/bin/git-gtr
```

Or add to PATH without sudo:
```bash
export PATH="$PATH:/path/to/git-worktree-runner/bin"
```

### "fatal: not a git repository"

You must be inside a git repository to use gtr commands. Navigate to your project:

```bash
cd /path/to/your/project
git status  # Verify it's a git repo
```

### "Branch already exists"

Use `--force` flag to create a worktree for an existing branch:

```bash
/gtr:new existing-branch --force
```

### Worktree not found

List available worktrees to see what exists:

```bash
/gtr:list
```

### Nested Claude issue with /gtr:ai

If using `/gtr:ai` from within Claude Code and the default AI tool is `claude`, it will try to spawn a nested Claude instance. Use a different AI tool:

```bash
/gtr:ai feature --ai aider
```

Or open the worktree path in a separate terminal.

### Paths with spaces break navigation

Always quote the command substitution when navigating:

```bash
cd "$(git gtr go branch-name)"  # Correct
cd $(git gtr go branch-name)    # May break with spaces
```

## Requirements

- Git 2.5+ (worktree support)
- Bash 3.2+ (4.0+ recommended)
- git-worktree-runner installed and in PATH

## License

Apache License 2.0
