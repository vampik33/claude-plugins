# watchdog

Watches every Bash command the model runs, foreground and background, and stops one that looks stuck: no output **and** no CPU for 10 minutes. The model is told why and decides whether to re-run it.

```
watchdog · ⚠ hang.sh quiet 6m/10m · ✗ ssh build-box stopped
```

## Installation

```bash
claude plugin install watchdog@vampik-plugins
```

## Behaviour

- **Stuck** means the output file has not grown and the command's whole process tree has used under 5% of a core, for `quietMinutes`. A quiet build that is linking, or a simulation that prints nothing, is busy, not stuck.
- A `sleep` running in the tree counts as activity: a wait loop that sleeps between checks is never stopped, and the step after a long sleep gets the whole limit. A wait loop whose check hangs (a `curl` that never returns, no sleep running) is stopped like any other command.
- **Foreground** command: its shell's process group and tree get SIGTERM. The model reads why beside the call's result.
- **Background** task: stopped through TaskStop (SIGTERM to the group and tree, if that fails), and a message tells the model why, starting a turn once the session is idle.
- Either way, at the next look (10 s later) the process group gets SIGKILL: a child that ignored the TERM and outlived its shell (reparented out of the engine's tree, it keeps the group) goes too.
- The note asks the model to find out why it hung and re-run it if the result is still needed: restarting is the model's call, since only it knows whether the command is safe to run twice.
- A line above the prompt warns from half the limit (`⚠ hang.sh quiet 6m/10m`) and shows each stop for the next `quietMinutes`; each stop is also a toast and a transcript line.
- `/watchdog` prints the summary: every command of the session, foreground or background, how long it ran, its state and its last line of output.

## How It Works

The engine runs each Bash command in a shell whose output goes to a task file (`…/tasks/<id>.output`), foreground ones included. Every 10 s while a command runs, one `bash` scan lists the engine's child shells, their output files and sizes, and their process trees' CPU ticks from `/proc`. A foreground call is matched to its shell by the command in the shell's command line; a background one by the output file its result names. A foreground command the engine moves to the background (its timeout, ctrl+b) is watched on as a background task.

Linux only (`/proc`, `ps`, `stat -c`).

## Configuration

| Option | Default | |
|---|---|---|
| `quietMinutes` | `10` | stop a command after this long with no output and no CPU |

Needs function hooks (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`).
