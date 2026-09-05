# Contributing

## Scope

`README.md` is for users.

Keep development details, testing notes, internal tool guidance, and docs build details in this file.

## Development

Install dependencies:

```bash
pnpm install
```

Run checks:

```bash
pnpm lint
pnpm typecheck
```

## Repository layout

- `src/` - extension source
- `src/tools/` - `process` tool and actions
- `src/commands/` - `/ps` commands and settings UI
- `src/hooks/` - lifecycle hooks, blocker, message rendering, widgets
- `src/components/` - TUI components
- `skills/` - shipped package skills
- `.agents/skills/` - local repo-only skills for development workflows
- `.github/docs-site/` - isolated docs page build

## Internal behavior

This extension is mainly for agent-managed background processes.

Typical flow:

1. Pi starts a long-running command in the background.
2. Pi continues other work.
3. The user watches, pins, or kills the process from the UI.
4. Pi inspects output or logs when needed.

Use the `process` tool for long-running commands such as dev servers, test watchers, build watchers, and log tails.

Avoid shell background patterns when the process tool fits.

Background command blocking is optional. It is controlled by `interception.blockBackgroundCommands`.

### Log storage and watch windows

Each manager creates a random private temporary directory. Log files are created exclusively with mode `0600`; the directory uses `mkdtemp` permissions (`0700`, subject to umask). No existing directory is chmod'd.

Pending lines are offsets into the raw log files, not retained strings. At each LF, CR, or process end, the manager writes the full line into the combined log in batches of at most 64 KiB. Lines within the current data event use its bytes directly; only spans from earlier events are read back from the raw log. All completed lines in a data event share the output batch. CRLF is one delimiter, including when split across data events. Raw stdout and stderr keep their original bytes; combined logs normalize delimiters to LF and retain stream tags.

Watches match the first 64 KiB of each logical line, decoded as UTF-8. A partial UTF-8 character at the window boundary is omitted. The rest of the line stays in the logs but is not searched. Regex anchors apply to this window, not to the full overlong line. Watches still fire at a delimiter or process end, not as partial output arrives. Repeat and stream filtering are unchanged.

This memory bound is not regex safety. Matching still uses synchronous JavaScript regexes and can block the event loop. Cancellable matching and explicit timeout/queue-overflow notifications remain unresolved. Copying a completed long line also performs synchronous disk I/O; output retrieval APIs still read full files.

## Testing

Useful local checks:

```bash
pnpm lint
pnpm typecheck
```

Useful manual process scripts:

```bash
./test/test-output.sh
./test/test-exit-success.sh 5
./test/test-exit-failure.sh 5
./test/test-exit-crash.sh 5
```

## Docs conventions

### README

Keep `README.md` focused on user outcomes:

- what the extension does
- how users interact with it
- slash commands and UI behavior
- troubleshooting

Avoid putting these in `README.md`:

- dev commands
- test commands
- internal architecture details
- detailed tool-call schemas
- release workflow notes

### Video placeholders

Use HTML comments in `README.md`:

```md
<!-- VIDEO: {"id":"process-panel","title":"Browse and manage processes from the panel"} -->
```

GitHub ignores these comments. The docs page build turns them into video blocks.

Add one placeholder for each feature section.

## Docs page build

The generated docs page lives under `.github/docs-site/` and is isolated from the extension source.

It reads `README.md`, converts markdown into structured content, replaces video placeholders, highlights code with Shiki, and builds a static page with Vite and Tailwind.

The GitHub Actions workflow for this lives in `.github/workflows/docs-page.yml`.

## Demo pattern

For demo recording, use a small self-contained project with a realistic workflow.

The best pattern used for this extension was a fake Northwind API project where Pi:

1. starts a server in the background
2. runs tests and sees failures
3. runs migrations
4. checks server logs
5. updates seed data
6. reruns tests
7. cleans up the process

That pattern shows why background processes matter in a normal task instead of showing features one by one.
