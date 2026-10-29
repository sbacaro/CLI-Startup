# Install

Copy one block at a time into Terminal. Every block is safe to re-run.

If a block fails, stop and fix it before the next one: each depends on the
previous.

Target: macOS on Apple silicon (Homebrew lives in `/opt/homebrew`).

## 1. Homebrew

```sh
command -v brew >/dev/null || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
eval "$(/opt/homebrew/bin/brew shellenv)"
```

## 2. Tools

```sh
brew install gh node openjdk@21 ffmpeg yt-dlp uv tesseract unar
```

## 3. OpenCode and the plugins

```sh
npm install -g @opencode/cli
opencode plugin add github:sbacaro/CLI-Startup
opencode plugin add github:obra/superpowers
```

Check: `opencode plugin list` shows both `opencode-startup` and `superpowers`.

Superpowers is a separate plugin, so it is added explicitly. The startup plugin
cannot install it for you.

## 4. Shell environment

Makes the tools installable and visible to every new terminal:

```sh
cat >> ~/.zshrc <<'EOF'
export PATH="$HOME/.local/bin:$PATH"
export JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
export GHIDRA_INSTALL_DIR="$(ls -d "$HOME"/Library/ghidra_*_PUBLIC 2>/dev/null | tail -1)"
EOF
source ~/.zshrc
```

`GHIDRA_INSTALL_DIR` stays empty until Ghidra is installed (step 8). That is
fine: only REA uses it.

## 5. Provision

Open OpenCode in any folder and type:

```text
Run startup_provision
```

It installs whatever is missing, using each project's own installer. To preview
without installing anything:

```text
Run startup_provision with dryRun
```

## 6. Provider keys

Inside OpenCode, type:

```text
/connect
```

Pick **Kodeo**, paste the key, confirm. Repeat for **Globant**. Models appear as
soon as a key is accepted. A provider you skip simply has no models.

## 7. MCP logins

```text
/mcps
```

Sign in to **Supabase** and **Cloudflare**. REA needs no login. Graphify starts
after a graph exists for the project (step 9).

## 8. Reverse engineering (optional)

Only needed for REA. Ghidra is not in Homebrew:

1. Download the latest 12.1.x release from
   <https://github.com/NationalSecurityAgency/ghidra/releases>.
2. Unzip it into `~/Library`, giving a folder such as
   `~/Library/ghidra_12.1.4_PUBLIC`.
3. Open a new terminal and run `rea doctor`.

## 9. Skill per project

The motion-design skill is installed per project. Inside the project folder:

```sh
npx -y skills add kylezantos/design-motion-principles
```

It lands in `.agents/skills/` and is available immediately. Repeat in any other
project that needs it.

## 10. Verify

```sh
opencode mcp list
```

Then inside OpenCode:

```text
Run startup_status
```

Every line should read `present (current)`.

## Updating

```text
Run startup_update
```

OpenCode updates itself. Plugins are git specs, so they refresh on restart, or
run `opencode plugin update`.

## Problems

**A provider shows no models.** No key yet: run `/connect`.

**REA says a path "must be absolute".** `GHIDRA_INSTALL_DIR` or `JAVA_HOME` is
empty. Re-run step 4, then open a new terminal.

**`graphify-mcp` is not found.** `uv` installs into `~/.local/bin`. Link it into
Homebrew's directory:

```sh
ln -sf "$HOME/.local/bin/graphify-mcp" /opt/homebrew/bin/graphify-mcp
```

**Graphify exits at startup.** No graph yet: run `/graphify .` in your assistant.

**Superpowers skills do not appear.** Add the plugin again, then restart
OpenCode:

```sh
opencode plugin add github:obra/superpowers
```

**A model shows no cost.** It has no models.dev entry, usually a
gateway-internal alias. Limits still come from the gateway.
