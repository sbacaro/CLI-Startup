# CLI-Startup

Provision OpenCode from one instruction instead of a checklist.

Point an agent at this repository and it configures the machine and the editor:
providers, MCP servers, third-party skills, and a standing rule that keeps all of
it current.

## What it does

An OpenCode **plugin** runs inside the OpenCode server and registers things at
runtime, so the configuration file stays almost empty:

| Concern | How it is handled |
| --- | --- |
| Providers | `ctx.provider.transform` registers Kodeo and Globant |
| Model catalogs | Discovered from each gateway's `/v1/models`, priced from models.dev |
| Credentials | Added in the OpenCode UI via `/connect`; never stored in this repo |
| Update policy | Injected into every model call through a `session.hook("context")` |
| Third-party skills | Installed by their own upstream installers; never vendored |

The result is one line in `opencode.json`:

```json
{ "plugins": ["opencode-startup@git+https://github.com/sbacaro/CLI-Startup.git"] }
```

## Why a plugin and not an MCP server

An MCP server has to already be declared in the configuration before OpenCode
will load it, so it cannot be the thing that creates that configuration. A plugin
is loaded by the same config line, and it can register providers, MCP servers, and
skills at runtime. That makes it the only surface that can do this job without a
manual pre-step.

## Model data

Two sources, each authoritative for what it knows:

1. **The gateway** — which models exist right now, with their real context and
   output limits. This changes without warning, which is why nothing is
   hardcoded.
2. **models.dev** — what a token costs, including cache pricing and long-context
   tiers.

Matching is anchored to the model's canonical vendor. A global id scan would
attribute a resold model to whichever gateway happened to be listed first; the
resolver instead maps `anthropic/claude-opus-5-5`, `claude-opus-5.5`, and
`claude-opus-5-kodeo` to the same catalog entry.

Models that no public catalog lists — gateway-internal aliases, review channels —
keep their gateway limits and report cost as unknown. No price is invented.

## Install

See [INSTALL.md](INSTALL.md). It is written for an agent to follow step by step.

## Develop

```sh
npm install
npm run verify
```

`npm run verify` runs the type check and the test suite. Tests use Node's built-in
runner with type stripping, so no build step is needed.

```
src/
  index.ts       plugin entry: transforms, hook, tools
  manifest.ts    providers and the upstream skills to verify
  discovery.ts   gateway /v1/models
  catalog.ts     models.dev fetch, cache, and merge
  resolve.ts     vendor-anchored catalog matching
  provision.ts   conversion to the SDK's model and provider shapes
  cache.ts       TTL cache with stale fallback
  policy.ts      update policy text and status formatting
```

## License

MIT
