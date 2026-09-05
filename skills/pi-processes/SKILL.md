---
name: pi-processes
description: Manage long-running commands in the background with the process tool. Use when a task needs a dev server, test watcher, build watcher, local API, or log tail to keep running while the conversation continues.
---

# pi-processes

Use this skill when work needs a long-running command to stay alive while Pi continues with other steps.

## Prefer this workflow

- Use the `process` tool for long-running commands.
- Avoid shell background patterns when the process tool fits.
- Give processes stable, clear names.
- Continue the task after starting a process instead of waiting on it.
- Inspect output or log files only when needed.
- Kill and clear processes when they are no longer useful.

## Good fits

- `pnpm dev`
- `npm run server`
- `pnpm test --watch`
- `tail -f <logfile>`
- local preview or build watchers

## Typical flow

1. Start the long-running command with a clear name.
2. Continue the main task.
3. Inspect `output` or `logs` if something needs attention.
4. Use alert flags when success or failure should trigger a follow-up turn.
5. Kill and clear the process when done.

## Notes

- Users can inspect and manage running processes from `/ps`.
- Use `write` when a process expects stdin input.
- Use `output` for a quick tail and `logs` when the full log files are more useful.
- `logWatches` searches only the first 64 KiB of each LF-, CR-, or CRLF-delimited line (or the final line at exit). Regex anchors apply to that window. Full content remains in the log files; markers beyond the window will not trigger a watch.
- Watch regexes still run synchronously. Avoid untrusted or complex patterns: the input window does not prevent regex backtracking from blocking Pi.
