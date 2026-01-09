---
name: gtr
description: This skill should be used when the user invokes /gtr:* commands to manage git worktrees using git-worktree-runner (gtr). Enables parallel branch development through worktree creation, editor/AI integration, and lifecycle management.
---

# Git Worktree Runner (gtr)

## Overview

This skill provides workflows for managing git worktrees using the `git gtr` CLI tool. Git worktrees enable working on multiple branches simultaneously in separate directories without stashing changes or switching branches.

## Quick Start

To check if gtr is installed:
```bash
git gtr --version
```

If not installed, guide user through installation:
```bash
git clone https://github.com/coderabbitai/git-worktree-runner.git
cd git-worktree-runner
sudo ln -s "$(pwd)/bin/git-gtr" /usr/local/bin/git-gtr
```

## Common Workflows

### Create and Work on Feature Branch

Full lifecycle for feature development:

```bash
# 1. Create worktree for new feature
git gtr new feature-name

# 2. Open in editor (uses configured default)
git gtr editor feature-name

# 3. Launch AI tool in worktree (see note about nested Claude)
git gtr ai feature-name

# 4. Run commands in worktree
git gtr run feature-name npm test
git gtr run feature-name npm run build

# 5. When done, remove worktree
git gtr rm feature-name
```

### Quick Parallel Development

For quick context switching between branches:

```bash
# List existing worktrees
git gtr list

# Create worktree from existing branch
git gtr new existing-branch

# Navigate to worktree (prints path - use quotes for spaces)
cd "$(git gtr go branch-name)"

# Or run commands directly
git gtr run branch-name git status
```

### Multiple Worktrees Same Branch

For different aspects of the same feature:

```bash
git gtr new feature --force --name frontend
git gtr new feature --force --name backend
```

### Non-Interactive/CI Usage

For automation scenarios:

```bash
git gtr new ci-test --yes --no-copy
git gtr rm ci-test --yes --delete-branch
```

## Core Commands

| Command | Description |
|---------|-------------|
| `git gtr new <branch>` | Create new worktree |
| `git gtr list` | List all worktrees |
| `git gtr editor <branch>` | Open worktree in editor |
| `git gtr ai <branch>` | Launch AI tool in worktree |
| `git gtr run <branch> <cmd>` | Execute command in worktree |
| `git gtr go <branch>` | Print worktree path |
| `git gtr rm <branch>` | Remove worktree |
| `git gtr copy <target>` | Sync files to worktree(s) |
| `git gtr config` | Manage configuration |

## Configuration

Key settings via `git gtr config set`:

```bash
# Set default editor (cursor, vscode, zed)
git gtr config set gtr.editor.default cursor

# Set default AI tool (claude, aider, codex, continue, cursor)
git gtr config set gtr.ai.default claude

# Set worktrees directory
git gtr config set gtr.worktrees.dir ~/worktrees

# Set files to auto-copy on worktree creation
git gtr config set gtr.copy.include ".env*,*.local"
```

## Hooks

Hooks run at worktree lifecycle events and receive environment variables:
- `REPO_ROOT` - Repository root path
- `WORKTREE_PATH` - Worktree directory location
- `BRANCH` - Branch name

Configure hooks:
```bash
git gtr config set gtr.hook.postCreate "npm install"
git gtr config set gtr.hook.preRemove "npm run clean"
git gtr config set gtr.hook.postRemove "echo 'Cleaned up'"
```

## File Copying

Copy files to worktrees:

```bash
# Copy specific patterns to one worktree (note the -- separator)
git gtr copy feature -- ".env*" "*.json"

# Copy to all worktrees
git gtr copy -a -- ".env*"
```

## Reference

For detailed command options and configuration, see `references/commands.md`.
