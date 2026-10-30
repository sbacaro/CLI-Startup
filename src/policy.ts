/**
 * Runtime policy injected into every model call.
 *
 * The point is durability: a fresh machine, a reinstall, or a restored backup
 * should still know that this OpenCode is meant to be kept current. Instructions
 * in a README get lost; this text arrives with the plugin.
 */

export const UPDATE_POLICY = `**opencode-startup**

This OpenCode is provisioned by the \`opencode-startup\` plugin. Keep it current.

- Run \`startup_status\` before changing MCP servers, skills, or providers.
- When something is missing or behind, run \`startup_provision\` to install it or
  \`startup_update\` to refresh it, rather than editing configuration by hand.
- MCP servers, skills, and providers are declared in \`src/manifest.ts\`. Change
  that file rather than a generated config, so a re-provision stays idempotent.
- Provider model lists are discovered from each gateway's \`/v1/models\` and
  priced from models.dev. Never hardcode a model catalog: a model the gateway
  adds tomorrow appears on the next refresh without a plugin release.
- A model with no catalog match keeps its gateway limits and reports cost as
  unknown. Do not invent a price for it.
- Provider credentials belong in the OpenCode UI, never in a repository.
- A component that ships its own setup command (\`rea setup\`, \`graphify install\`)
  owns its registration and workflow files. Run that command instead of writing
  an MCP entry by hand: a hand-written entry leaves the matching skill missing.
- Ghidra and Java are prerequisites, not dependencies of the MCP server. Never
  hardcode their paths: resolve them from what is installed — \`brew --prefix\` on
  macOS, \`%ProgramFiles%\` and \`where javac\` on Windows — and from the JDK the
  installed Ghidra declares, and omit \`JAVA_HOME\` entirely when it cannot be
  resolved. An empty value makes REA refuse to start.
- The GitHub MCP resolves its token inside its own command line, from
  \`gh auth token\`. Never place a token in a server's \`environment\`: the
  keychain already stores it, and a server's config is data the user can export,
  inspect, or share.
`

export type ComponentStatus = {
  id: string
  installed: string | undefined
  available: string | undefined
  state: "current" | "outdated" | "missing" | "unknown"
  action?: string
}

export function describeStatus(components: ComponentStatus[]): string {
  if (components.length === 0) return "No components configured."

  const lines = components.map((component) => {
    const installed = component.installed ?? "not installed"
    const suffix =
      component.state === "outdated" && component.available
        ? ` -> ${component.available}`
        : ""
    return `- ${component.id}: ${installed}${suffix} (${component.state})`
  })

  const actionable = components.filter((c) => c.state === "outdated" || c.state === "missing")
  if (actionable.length > 0) {
    lines.push("", `Run \`startup_update\` for: ${actionable.map((c) => c.id).join(", ")}`)
  }

  return lines.join("\n")
}
