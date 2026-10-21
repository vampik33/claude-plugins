# Changelog

All notable changes to the watchdog plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.1] - 2026-10-21

### Fixed
- On a machine with thousands of TCP sockets (past the kernel's 128 KiB limit on one argument), the scan no longer reads every command as idle (0 CPU, 0 bytes, not serving, age 0) and stops busy ones after the limit: the socket map goes to the scan's awk on stdin

## [0.3.0] - 2026-10-20

### Changed
- Reading or writing data counts as activity: a tree that moved 64 KiB or more since the last look (`rchar` + `wchar` from `/proc/<pid>/io` for files, pipes and TCP sockets, with socket `recv`/`send` counted from `ss`'s TCP counters) is not quiet, so a quiet `curl -o`, `wget -q`, `aws s3 cp --quiet`, `rsync` or `git clone --quiet` is no longer stopped
- A tree that listens on a TCP port or holds an inotify watch is serving and never stopped: idle dev servers (`npm run dev`, `vite`, `python -m http.server`) and watchers (`tsc --watch`, `tail -f`) are left alone; `/watchdog` shows them as `serving`
- The stop note says the command printed nothing, used no CPU and read or wrote no data

### Fixed
- A foreground call waiting for its shell (a permission prompt, a slow spawn) is no longer paired with someone else's: background calls are recorded before they run, so their shells are matched by their command, and the one-call/one-shell fallback only takes a shell that started after the call

## [0.2.1] - 2026-10-20

### Fixed
- A command stopped less than 10 s before a `/clear` keeps its row until its process group gets the SIGKILL; before, `/clear` dropped it and the KILL was never sent

## [0.2.0] - 2026-10-19

### Changed
- What the process tree does is the only judge: a command that looks like a wait loop (`until …; do …; done`, a `while` that sleeps) is no longer exempt. A loop that sleeps between checks still counts as active; one whose check hangs, with no sleep running, is now stopped

### Security
- A stop note quotes the command's last output line inside an `<output>` block, marked as data and not instructions, since a background task's note reaches the model as a plugin's prompt

## [0.1.0] - 2026-10-19

### Added
- Every Bash command the model runs, foreground and background, is watched every 10 s: its output file's size and its process tree's CPU time from `/proc`
- A command with no output and under 5% of a core for `quietMinutes` (default 10) is stopped: a foreground one by SIGTERM to its shell's process group and tree; a background one through TaskStop; 10 s later the group gets SIGKILL, so a child that ignored the TERM and outlived its shell goes too
- The model is told why (beside a foreground call's result; by a message for a background task) and decides whether to re-run it
- Wait loops and trees with a `sleep` running are never stopped, and a sleep pauses the quiet clock, so the step after it gets the whole limit
- A line above the prompt warns from half the limit and shows each stop; a toast and a transcript line per stop
- `/watchdog` prints every command of the session with its state, run time and last line of output
