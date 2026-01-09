---
description: Check gtr installation status and current configuration
skill: gtr
allowed-tools: Bash(git gtr *), Bash(git rev-parse *)
---

# GTR Status

Check the installation status of git-worktree-runner and display current configuration.

## Usage

```
/gtr:status
```

## Process

1. Check installation: `git gtr --version`
2. Check git repo: `git rev-parse --is-inside-work-tree`
3. Show configuration: `git gtr config list`
4. List worktrees: `git gtr list`

## Output

- gtr version and installation status
- Repository context
- Default editor and AI tool
- Worktree directory setting
- Active worktrees count
