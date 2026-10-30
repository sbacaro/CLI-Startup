/**
 * The desired state of a provisioned OpenCode, as data.
 *
 * Every entry answers three questions the runtime asks: what should exist, how
 * is it installed from its own upstream, and how do we know it is there. Keeping
 * that in one file means the installer, the status tool, and the tests all read
 * the same truth instead of drifting apart.
 */

import { commandLine, hostPlatform, type PlatformID } from "./platform.ts"
import { githubMcpCommand, installGithubMcp, updateGithubMcp } from "./installers.ts"

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
 * A command, or a different command per platform.
 *
 * Most installers are the same everywhere; the ones that are not (a Homebrew
 * formula that has no Windows package) say so here instead of leaving a command
 * that silently cannot succeed. Returning `undefined` means "nothing to run
 * here", so a platform without a supported installer stays out of the plan.
 */
export type PlatformCommand = string | ((platform: PlatformID) => string | undefined)

export function commandFor(command: PlatformCommand, platform: PlatformID = hostPlatform()): string | undefined {
  return typeof command === "function" ? command(platform) : command
}

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
  install?: PlatformCommand
  /** Command that refreshes the prerequisites. */
  update?: PlatformCommand
  /**
   * Upstream command that registers the server with OpenCode and installs its
   * matching workflow, when the project owns that integration.
   */
  setup?: PlatformCommand
  /** Files that prove an upstream setup command has been applied. */
  setupMarkers?: string[]
  /** How to verify the prerequisites are present. */
  verify?: { command: string; timeoutMs?: number }
  /**
   * The server definition registered with OpenCode.
   *
   * A function of the process environment rather than a literal: a variable
   * that is unset must be omitted entirely. Passing `{env:NAME}` through
   * verbatim would send an empty string, and servers that validate their paths
   * reject that at startup.
   *
   * The platform decides how a command line that reads a credential is spelled:
   * `sh -c` on POSIX, PowerShell on Windows.
   */
  config(env: NodeJS.ProcessEnv, platform?: PlatformID): Record<string, unknown>
}

export const mcps: McpSpec[] = [
  {
    id: "rea",
    name: "REA",
    repository: "https://github.com/morluto/rea",
    install: "npm install -g rea-agents",
    update: "rea update",
    // REA's setup owns both the OpenCode registration and the matching skill.
    // A hand-written `rea mcp` entry leaves the skill missing and ignores the
    // provider paths that setup knows how to validate.
    setup: "rea setup --client opencode --skill --yes",
    setupMarkers: ["~/.config/opencode/opencode.json", "~/.agents/skills/reverse-engineer-anything/SKILL.md"],
    verify: { command: "rea --version" },
    config: (env, platform = hostPlatform()) => {
      const environment: Record<string, string> = { JAVA_OPTS: "-Xmx8g" }
      // REA validates that both paths are absolute, so they are only passed
      // when actually set; an empty string is rejected outright.
      if (env.GHIDRA_INSTALL_DIR) environment.GHIDRA_INSTALL_DIR = env.GHIDRA_INSTALL_DIR
      if (env.JAVA_HOME) environment.JAVA_HOME = env.JAVA_HOME
      if (env.GHIDRA_INSTALL_DIR) environment.REA_GHIDRA_STARTUP_TIMEOUT_MS = "3600000"

      return {
        type: "local",
        // `npm install -g` writes a `.cmd` shim, and Node cannot spawn one
        // without going through a command interpreter.
        command: commandLine(platform, "rea mcp"),
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
    // `graphify-mcp` imports the MCP SDK, which the base package does not
    // install. The extra is required for the server itself, not only the CLI.
    install: 'uv tool install "graphifyy[mcp]"',
    update: 'uv tool upgrade "graphifyy[mcp]"',
    setup: "graphify install --platform opencode",
    setupMarkers: ["~/.config/opencode/skills/graphify/SKILL.md"],
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
  {
    id: "github",
    name: "GitHub",
    repository: "https://github.com/github/github-mcp-server",
    // Upstream ships a Homebrew formula for macOS and a zip of Windows binaries;
    // there is no package-manager entry on Windows, so each platform's own
    // installer lives in `installers.ts` rather than as a literal here.
    install: installGithubMcp,
    update: updateGithubMcp,
    verify: { command: "github-mcp-server --help" },
    config: (_env, platform = hostPlatform()) => ({
      type: "local",
      // The token is resolved by the child process at startup, not by the
      // plugin, so no credential enters this project's data and a rotated token
      // takes effect on the next start. The command is a shell wrapper on both
      // platforms, so `verify` is what decides whether the server is installed.
      command: githubMcpCommand(platform),
      disabled: false,
      timeout: { startup: 30_000, catalog: 60_000 },
      environment: {
        GITHUB_TOOLSETS: "context,repos,issues,pull_requests,actions",
      },
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

/** A base package, named the way each package manager spells it. */
export type BasePackages = {
  /** The installer the guide tells the user to run. */
  manager: "brew" | "winget"
  packages: string[]
  /** Packages the platform's manager cannot provide, explained in the guide. */
  manual: string[]
}

/** Homebrew packages the machine needs before any of this works. */
export const brewPackages = {
  // Homebrew currently provides Ghidra 12.2, but REA 6.8.0 accepts 12.1.x.
  // Ghidra is therefore downloaded and built separately in INSTALL.md.
  formulae: [
    "gh",
    "node",
    "python@3.12",
    "openjdk@21",
    "ffmpeg",
    "yt-dlp",
    "uv",
    "tesseract",
    "unar",
    "github-mcp-server",
  ],
  casks: [] as string[],
}

/**
 * winget package ids for the same set.
 *
 * `github-mcp-server` and Ghidra have no winget package — upstream publishes a
 * zip and a release archive — so they are listed as manual and installed from
 * the release itself in `INSTALL-WINDOWS.md`.
 */
export const wingetPackages = {
  formulae: [
    "GitHub.cli",
    "OpenJS.NodeJS.LTS",
    "Python.Python.3.12",
    "EclipseAdoptium.Temurin.21.JDK",
    "Gyan.FFmpeg",
    "yt-dlp.yt-dlp",
    "astral-sh.uv",
    "UB-Mannheim.TesseractOCR",
    "7zip.7zip",
  ],
  // No winget manifest exists for either of these.
  manual: ["github-mcp-server", "ghidra"],
}

/** The base packages the given platform's guide installs. */
export function basePackages(platform: PlatformID = hostPlatform()): BasePackages {
  if (platform === "win32") {
    return { manager: "winget", packages: wingetPackages.formulae, manual: wingetPackages.manual }
  }
  return { manager: "brew", packages: brewPackages.formulae, manual: [] }
}

/** Global npm packages. */
export const npmPackages = ["@opencode/cli", "rea-agents"]
