# Claude Plugins

A collection of Claude Code plugins for development workflows.

## Installation

### From GitHub (Recommended)

1. Add the marketplace:
```
/plugin marketplace add vampik33/claude-plugins
```

2. Install a plugin:
```
/plugin install <plugin-name>
```

Or use the `/plugin` menu to browse and install.

### From Local Directory

```bash
claude --plugin-dir /path/to/claude-plugins/plugins/<plugin-name>
```

## Available Plugins

| Plugin | Description |
|--------|-------------|
| **[gtr](plugins/gtr/)** | Git worktree management using git-worktree-runner for parallel branch development |

## Team Setup

Add to your project's `.claude/settings.json` for automatic marketplace discovery:

```json
{
  "extraKnownMarketplaces": [
    "vampik33/claude-plugins"
  ]
}
```

Team members will be prompted to add the marketplace when they trust the project.

## Repository Structure

```
claude-plugins/
├── .claude-plugin/
│   └── marketplace.json      # Marketplace manifest listing all plugins
├── plugins/
│   └── gtr/                  # Git worktree runner plugin
│       ├── .claude-plugin/
│       │   └── plugin.json   # Plugin manifest
│       ├── commands/         # Slash commands
│       ├── skills/           # Plugin skills
│       └── README.md         # Plugin documentation
├── LICENSE
└── README.md
```

## Adding New Plugins

To add a new plugin:

1. Create a new directory under `plugins/`:
   ```
   plugins/my-plugin/
   ├── .claude-plugin/
   │   └── plugin.json
   ├── commands/
   ├── skills/
   └── README.md
   ```

2. Add the plugin to `.claude-plugin/marketplace.json`:
   ```json
   {
     "plugins": [
       {
         "name": "my-plugin",
         "description": "What the plugin does",
         "version": "1.0.0",
         "source": "./plugins/my-plugin",
         "category": "Category",
         "keywords": ["relevant", "keywords"]
       }
     ]
   }
   ```

## License

Apache License 2.0
