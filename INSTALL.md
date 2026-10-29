# Configure OpenCode

Instructions for an agent. Follow them in order, run each command, and stop if a
step fails. Every step is safe to re-run.

Target: macOS on Apple silicon. Homebrew installs to `/opt/homebrew`.

## 1. Install the command-line foundation

```sh
command -v brew >/dev/null || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Then the packages this setup depends on:

```sh
brew install gh node openjdk@21 ffmpeg yt-dlp uv swiftformat swiftlint xcodegen tesseract unar
brew install --cask ghidra
```

`ghidra` is only needed by REA. Skip it if reverse engineering is not wanted, and
skip step 5.

## 2. Install the agent CLIs

```sh
npm install -g @opencode/cli
npm install -g rea-agents
```

Verify:

```sh
opencode --version
rea --version
```

## 3. Install the startup plugin

```sh
opencode plugin add github:sbacaro/CLI-Startup
```

This writes the plugin into the global configuration and installs it from the
repository. Confirm it is registered:

```sh
opencode plugin list
```

## 4. Add provider credentials

The plugin registers two providers and their model catalogs. Neither ships a key.
Add each key through the OpenCode UI, not in a file:

1. Open OpenCode.
2. Run `/connect`.
3. Choose **Kodeo**, paste the key, confirm.
4. Repeat for **Globant**.

Model lists appear as soon as a key is accepted. The plugin discovers them from
each gateway's `/v1/models` endpoint and prices them from models.dev, so no
restart and no configuration edit is required.

If a provider is skipped, it simply has no models. Nothing else breaks.

## 5. Install the third-party skills

Each skill stays in its own upstream repository. These commands install them and
are the same commands that update them later.

```sh
opencode plugin add github:obra/superpowers
```

```sh
cd ~/Github   # or any project directory
npx -y ui-ux-pro-max-cli@latest init --ai opencode
npx -y skills add kylezantos/design-motion-principles
```

Note: `ui-ux-pro-max-cli` writes to `./.opencode/skills`, which is project-scoped.
Its `--global` flag targets `~/.opencode/skills`, a directory OpenCode does not
read, so do not use `--global`.

Register REA with OpenCode so its MCP server and skill are wired up:

```sh
rea setup --client opencode --yes
```

## 6. Verify

```sh
opencode mcp list
```

Expected: `rea` connected (and `supabase`/`cloudflare` if you added them
yourself). Then, inside OpenCode, ask the agent to run `startup_status`.

## Updating later

Nothing here needs manual maintenance:

- OpenCode updates itself when `update` is `"auto"`.
- The plugin is a git spec, so it refreshes on restart.
- Skills update through their own installers; `startup_update` prints the exact
  command for any component that is behind.

## Troubleshooting

**Providers show no models.** No credential yet. Run `/connect` and add the key.

**A model shows no cost.** It has no entry in models.dev — typically a
gateway-internal alias. Limits still come from the gateway.

**`ui-ux-pro-max` skills are missing.** They were installed with `--global`, which
writes to a directory OpenCode does not scan. Re-run without `--global` from a
project directory.
