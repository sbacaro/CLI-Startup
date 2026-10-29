# Configure OpenCode

Instructions for an agent. Follow them in order, run each command, and stop if a
step fails. Every step is safe to re-run.

Target: macOS on Apple silicon. Homebrew installs to `/opt/homebrew`.

## 1. Install the command-line foundation

```sh
command -v brew >/dev/null || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
eval "$(/opt/homebrew/bin/brew shellenv)"
```

```sh
brew install gh node openjdk@21 ffmpeg yt-dlp uv tesseract unar
brew install --cask ghidra
```

`ghidra` is only needed by REA. Skip it if reverse engineering is not wanted.

## 2. Export the Ghidra paths

REA validates that its paths are absolute and refuses to start otherwise. Export
them so the plugin can pass them through:

```sh
export GHIDRA_INSTALL_DIR="$HOME/Library/ghidra_12.1.4_PUBLIC"
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
```

Add both lines to `~/.zshrc` so they survive a new shell.

## 3. Install the agent CLIs

```sh
npm install -g @opencode/cli
```

## 4. Install the startup plugin

```sh
opencode plugin add github:sbacaro/CLI-Startup
```

Confirm it registered:

```sh
opencode plugin list
```

## 5. Provision the rest from inside OpenCode

Open OpenCode in any directory and ask the agent to run `startup_provision`. It
installs whatever is missing, using each project's own installer:

- `rea-agents` via npm, when the `rea` binary is absent
- `graphifyy` via `uv tool install`, when `graphify-mcp` is absent
- `superpowers`, `ui-ux-pro-max`, `design-motion-principles` when their files are absent

To see what would happen first, ask for `startup_status`, or call
`startup_provision` with `dryRun` set to true.

## 6. Add provider credentials

```text
/connect
```

Choose **Kodeo**, paste the key, confirm. Repeat for **Globant**. Model lists
appear as soon as a key is accepted; no restart and no configuration edit.

Skipping a provider leaves it with no models. Nothing else breaks.

## 7. Authenticate the remote MCP servers

Supabase and Cloudflare use OAuth. Run `/mcps`, select each server, and sign in.

REA connects without authentication once step 2 is done. Graphify starts once a
graph exists for the project (run `/graphify .` in your assistant).

## 8. Verify

```sh
opencode mcp list
```

Then, inside OpenCode, run `startup_status`.

## Updating later

- OpenCode updates itself when `update` is `"auto"`.
- The plugin is a git spec, so it refreshes on restart.
- Ask for `startup_update` to pull each component's latest release.

## Notes

`ui-ux-pro-max-cli` writes to `./.opencode/skills`, which is project-scoped. Its
`--global` flag targets `~/.opencode/skills`, a directory OpenCode does not scan,
so the plugin never passes it.

## Troubleshooting

**A provider shows no models.** No credential yet. Run `/connect`.

**`rea` fails with "must be absolute".** `GHIDRA_INSTALL_DIR` or `JAVA_HOME` is
unset. Redo step 2.

**`graphify` fails to start.** No graph has been built for this project yet.
Run `/graphify .` in your assistant, then reload.

**A model shows no cost.** It has no entry in models.dev, typically a
gateway-internal alias. Limits still come from the gateway.