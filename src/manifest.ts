/**
 * The desired state of a provisioned OpenCode, as data.
 *
 * Every entry answers three questions the runtime asks: what should exist, how
 * is it installed from its own upstream, and how do we know it is there. Keeping
 * that in one file means the installer, the status tool, and the tests all read
 * the same truth instead of drifting apart.
 */

/** A model provider the runtime should expose. */
export type ProviderSpec = {
  id: string
  name: string
  baseURL: string
  /** Environment variables that may carry the credential. */
  env: string[]
  /** Label for the key prompt in the OpenCode UI. */
  credentialLabel: string
}

export const providers: ProviderSpec[] = [
  {
    id: "kodeo",
    name: "Kodeo",
    baseURL: "https://api.kodeo.com.br/v1",
    env: ["KODEO_API_KEY"],
    credentialLabel: "Kodeo API key",
  },
  {
    id: "globant",
    name: "Globant",
    baseURL: "https://api.clients.globant.com/v1",
    env: ["GLOBANT_API_KEY"],
    credentialLabel: "Globant API key",
  },
]

/**
 * An MCP server the runtime should connect.
 *
 * `install` covers anything that must exist on disk first; `config` is the
 * server definition handed to the MCP editor. Both are declarative so a
 * re-provision is a no-op.
 */
export type McpSpec = {
  id: string
  name: string
  /** Upstream project that owns this server. */
  repository: string
  /** Command that installs prerequisites, or undefined when none are needed. */
  install?: string
  /** Command that refreshes the prerequisites. */
  update?: string
  /** How to verify the prerequisites are present. */
  verify?: { command: string; timeoutMs?: number }
  /**
   * The server definition registered with OpenCode.
   *
   * A function of the process environment rather than a literal: a variable
   * that is unset must be omitted entirely. Passing `{env:NAME}` through
   * verbatim would send an empty string, and servers that validate their paths
   * reject that at startup.
   */
  config(env: NodeJS.ProcessEnv): Record<string, unknown>
}

export const mcps: McpSpec[] = [
  {
    id: "rea",
    name: "REA",
    repository: "https://github.com/morluto/rea",
    install: "npm install -g rea-agents",
    update: "npm install -g rea-agents@latest",
    verify: { command: "rea --version" },
    config: (env) => {
      const environment: Record<string, string> = { JAVA_OPTS: "-Xmx8g" }
      // REA validates that both paths are absolute, so they are only passed
      // when actually set; an empty string is rejected outright.
      if (env.GHIDRA_INSTALL_DIR) environment.GHIDRA_INSTALL_DIR = env.GHIDRA_INSTALL_DIR
      if (env.JAVA_HOME) environment.JAVA_HOME = env.JAVA_HOME
      if (env.GHIDRA_INSTALL_DIR) environment.REA_GHIDRA_STARTUP_TIMEOUT_MS = "3600000"

      return {
        type: "local",
        command: ["rea", "mcp"],
        disabled: false,
        timeout: { startup: 60_000, catalog: 60_000 },
        environment,
      }
    },
  },
  {
    id: "supabase",
    name: "Supabase",
    repository: "https://github.com/supabase/mcp",
    config: () => ({
      type: "remote",
      url: "https://mcp.supabase.com/mcp",
    }),
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    repository: "https://github.com/cloudflare/mcp-server-cloudflare",
    config: () => ({
      type: "remote",
      url: "https://mcp.cloudflare.com/mcp",
    }),
  },
  {
    id: "graphify",
    name: "Graphify",
    repository: "https://github.com/Graphify-Labs/graphify",
    install: "uv tool install graphifyy",
    update: "uv tool upgrade graphifyy",
    verify: { command: "graphify-mcp --help" },
    // The package ships a dedicated `graphify-mcp` entrypoint for
    // `graphify.serve:_main`, so the server is addressed directly rather than
    // through a CLI subcommand. It reads the graph at the workspace default
    // path and exits when none has been built yet.
    config: () => ({
      type: "local",
      command: ["graphify-mcp"],
      disabled: false,
      timeout: { startup: 30_000, catalog: 30_000 },
    }),
  },
]

/**
 * A third-party skill, installed and updated only by its own upstream.
 *
 * `verify` names files the installer writes. Nothing is vendored: the plugin
 * never holds a copy of another project's skill content.
 */
export type SkillSpec = {
  id: string
  name: string
  repository: string
  install: string
  update: string
  /** Paths that must exist for the skill to be considered installed. */
  markers: string[]
  /** Where the installer writes the skill, for reporting. */
  target: string
}

export const skills: SkillSpec[] = [
  {
    id: "superpowers",
    name: "Superpowers",
    repository: "https://github.com/obra/superpowers",
    install: "opencode plugin add github:obra/superpowers",
    update: "opencode plugin update superpowers",
    markers: [],
    target: "OpenCode plugin registry",
  },
  {
    id: "ui-ux-pro-max",
    name: "UI/UX Pro Max",
    repository: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
    install: "npx -y ui-ux-pro-max-cli@latest init --ai opencode",
    update: "npx -y ui-ux-pro-max-cli@latest update --ai opencode",
    markers: [".opencode/skills/ui-ux-pro-max/SKILL.md"],
    target: ".opencode/skills/ui-ux-pro-max",
  },
  {
    id: "design-motion-principles",
    name: "Design Motion Principles",
    repository: "https://github.com/kylezantos/design-motion-principles",
    install: "npx -y skills add kylezantos/design-motion-principles",
    update: "npx -y skills add kylezantos/design-motion-principles",
    markers: [".opencode/skills/design-motion-principles/SKILL.md"],
    target: ".opencode/skills/design-motion-principles",
  },
]

/** Homebrew packages the machine needs before any of this works. */
export const brewPackages = {
  formulae: ["gh", "node", "openjdk@21", "ffmpeg", "yt-dlp", "uv", "tesseract", "unar"],
  casks: ["ghidra"],
}

/** Global npm packages. */
export const npmPackages = ["@opencode/cli", "rea-agents"]
