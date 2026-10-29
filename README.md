# CLI-Startup

Provision OpenCode from one instruction instead of a checklist.

Point an agent at this repository and it configures the editor: MCP servers,
third-party skills, and AI providers. An OpenCode **plugin** does the work at
runtime, so the configuration file stays almost empty:

```json
{ "plugins": ["opencode-startup@git+https://github.com/sbacaro/CLI-Startup.git"] }
```

## What it provisions

### MCP servers

| Server | Type | Registered as |
| --- | --- | --- |
| REA | local | `rea mcp`, registered by `rea setup --client opencode` |
| Supabase | remote | `https://mcp.supabase.com/mcp` (OAuth) |
| Cloudflare | remote | `https://mcp.cloudflare.com/mcp` (OAuth) |
| Graphify | local | `graphify-mcp`, installed with the `graphifyy[mcp]` extra |
| GitHub | local | `github-mcp-server stdio`, token read from `gh auth token` at launch |

Registration goes through `ctx.mcp.transform`, so a server the user configured by
hand is left alone and re-running is a no-op.

Two servers own their own registration. REA's `rea setup` writes its OpenCode
entry and installs the matching workflow, and Graphify's `graphify install`
writes its skill. The plugin runs those commands instead of writing an entry by
hand, because a hand-written entry leaves the workflow files missing. Ghidra and
Java are resolved from Homebrew and from the JDK the installed Ghidra declares,
never from a hardcoded path.

The GitHub server is local and its command resolves the token itself:
`GITHUB_PERSONAL_ACCESS_TOKEN="$(gh auth token)" exec github-mcp-server stdio`.
The token therefore never appears in any server configuration, and a rotated
token takes effect on the next launch. Its toolsets are limited to
`context`, `repos`, `issues`, `pull_requests`, and `actions`, because the full
catalog is large enough to consume a useful part of the context window.

### Skills

| Skill | Source | Installed by |
| --- | --- | --- |
| Superpowers | [obra/superpowers](https://github.com/obra/superpowers) | OpenCode plugin registry |
| UI/UX Pro Max | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | `ui-ux-pro-max-cli` |
| Design Motion Principles | [kylezantos/design-motion-principles](https://github.com/kylezantos/design-motion-principles) | `npx skills add` |

Nothing is vendored. Each skill lives in its own repository and is installed and
updated by its own upstream command.

### AI providers

Kodeo and Globant are registered as OpenAI-compatible providers. Their model
catalogs are **not** hardcoded: each is discovered from the gateway's
`/v1/models` endpoint and priced from [models.dev](https://models.dev). A model
the gateway adds tomorrow appears without a plugin release.

Credentials are entered in the OpenCode UI via `/connect`. The plugin
declares a key-based integration per provider and republishes the inventory when
a credential arrives, so a new key fills the model list without a restart.

## Tools

The plugin adds three tools under the `startup` namespace:

| Tool | Effect |
| --- | --- |
| `startup_status` | Reports every MCP, skill, and provider, marking what is missing |
| `startup_provision` | Runs the installers for whatever is missing; `dryRun` reports only |
| `startup_update` | Reaches each component's own upstream update command |

`startup_provision` is idempotent: an already provisioned machine runs nothing.

## Why a plugin and not an MCP server

An MCP server must already be declared in the configuration before OpenCode will
load it, so it cannot be the thing that creates that configuration. A plugin is
loaded by the same one-line entry and can register MCP servers, skills, and
providers at runtime. That makes it the only surface that can do this job without
a manual pre-step.

## Install

See [INSTALL.md](INSTALL.md). It is a numbered list of copy-and-paste commands,
written for someone who does not code: no editing files, no reading logs.

## Develop

```sh
npm install
npm run verify
```

```
src/
  index.ts       plugin entry: transforms, hook, tools
  manifest.ts    desired state: MCPs, skills, providers
  planner.ts     decides what is missing and what would fix it
  toolchain.ts   finds Ghidra and the JDK REA needs, from what is installed
  exec.ts        shell execution and path expansion
  discovery.ts   gateway /v1/models
  catalog.ts     models.dev fetch, cache, and merge
  resolve.ts     vendor-anchored catalog matching
  provision.ts   conversion to the SDK's model and provider shapes
  cache.ts       TTL cache with stale fallback
  policy.ts      update policy text and status formatting
```

## License

MIT
