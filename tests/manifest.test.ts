import { test } from "node:test"
import assert from "node:assert/strict"

import { basePackages, brewPackages, commandFor, mcps, providers, skills } from "../src/manifest.ts"

test("registers exactly the requested MCP servers", () => {
  assert.deepEqual(
    mcps.map((m) => m.id),
    ["rea", "supabase", "cloudflare", "graphify", "github"],
  )
})

test("REA is configured by its own setup command", () => {
  const rea = mcps.find((m) => m.id === "rea")
  assert.ok(rea)
  assert.equal(
    rea.setup,
    "rea setup --client opencode --skill --yes",
    "no registration comes from `rea setup --dry-run` until setup is actually applied",
  )
})

test("every MCP names the upstream project that owns it", () => {
  for (const mcp of mcps) {
    assert.match(mcp.repository, /^https:\/\/github\.com\//, `${mcp.id} repository`)
  }
})

test("remote MCPs carry a URL and no command", () => {
  for (const id of ["supabase", "cloudflare"]) {
    const mcp = mcps.find((m) => m.id === id)
    assert.ok(mcp)
    assert.equal(mcp.config(process.env).type, "remote")
    assert.match(String(mcp.config(process.env).url), /^https:\/\//)
    assert.equal(mcp.config(process.env).command, undefined)
  }
})

test("local MCPs carry a command and no URL", () => {
  for (const id of ["rea", "graphify", "github"]) {
    const mcp = mcps.find((m) => m.id === id)
    assert.ok(mcp)
    assert.equal(mcp.config(process.env).type, "local")
    assert.ok(Array.isArray(mcp.config(process.env).command))
    assert.equal(mcp.config(process.env).url, undefined)
  }
})

test("local MCPs declare how to install and verify their prerequisites", () => {
  for (const id of ["rea", "graphify"]) {
    const mcp = mcps.find((m) => m.id === id)
    assert.ok(mcp)
    assert.ok(mcp.install, `${id} install`)
    assert.ok(mcp.update, `${id} update`)
    assert.ok(mcp.verify?.command, `${id} verify`)
  }
})

test("GitHub runs its Homebrew binary and limits the advertised toolsets", () => {
  const github = mcps.find((m) => m.id === "github")
  assert.ok(github)
  const config = github.config({}, "darwin")
  assert.deepEqual(config.command, ["sh", "-c", 'GITHUB_PERSONAL_ACCESS_TOKEN="$(gh auth token)" exec github-mcp-server stdio'])
  assert.equal((config.environment as Record<string, string>).GITHUB_TOOLSETS, "context,repos,issues,pull_requests,actions")
  assert.equal((config.environment as Record<string, string>).GITHUB_PERSONAL_ACCESS_TOKEN, undefined)
})

test("GitHub registers a Windows-runnable command on Windows", () => {
  const github = mcps.find((m) => m.id === "github")
  assert.ok(github)
  const config = github.config({}, "win32")
  const command = config.command as string[]

  // `sh` does not exist on Windows, so the POSIX form would leave the server
  // permanently unable to start.
  assert.notEqual(command[0], "sh")
  assert.equal(command[0], "powershell.exe")
  assert.equal((config.environment as Record<string, string>).GITHUB_PERSONAL_ACCESS_TOKEN, undefined)
})

test("GitHub resolves its token at process start instead of persisting it", () => {
  const github = mcps.find((m) => m.id === "github")
  assert.ok(github)
  const empty = github.config({}).environment as Record<string, string>
  assert.equal(empty.GITHUB_PERSONAL_ACCESS_TOKEN, undefined)

  const configured = github.config({ GITHUB_PERSONAL_ACCESS_TOKEN: "gho_example" }).environment as Record<string, string>
  assert.equal(configured.GITHUB_PERSONAL_ACCESS_TOKEN, undefined)
})

test("Graphify installs the MCP extra its server imports", () => {
  const graphify = mcps.find((m) => m.id === "graphify")
  assert.ok(graphify)
  assert.deepEqual(graphify.config(process.env).command, ["graphify-mcp"])
  // The server runs `from mcp.server.stdio import stdio_server`; without the
  // extra, a successful install still fails on every start.
  assert.equal(graphify.install, 'uv tool install "graphifyy[mcp]"')
  assert.equal(graphify.update, 'uv tool upgrade "graphifyy[mcp]"')
  assert.equal(graphify.setup, "graphify install --platform opencode")
})

test("REA reads its Ghidra paths from the environment", () => {
  const rea = mcps.find((m) => m.id === "rea")
  assert.ok(rea)
  const env = rea.config({ GHIDRA_INSTALL_DIR: "/opt/ghidra", JAVA_HOME: "/opt/jdk" }).environment as Record<string, string>
  assert.equal(env.GHIDRA_INSTALL_DIR, "/opt/ghidra")
  assert.equal(env.JAVA_HOME, "/opt/jdk")
})

test("registers exactly the requested skills", () => {
  assert.deepEqual(
    skills.map((s) => s.id),
    ["superpowers", "ui-ux-pro-max", "design-motion-principles"],
  )
})

test("every skill installs and updates from its own repository", () => {
  for (const skill of skills) {
    assert.match(skill.repository, /^https:\/\/github\.com\//, `${skill.id} repository`)
    assert.ok(skill.install.length > 0, `${skill.id} install`)
    assert.ok(skill.update.length > 0, `${skill.id} update`)
    assert.ok(skill.target.length > 0, `${skill.id} target`)
  }
})

test("file-installed skills declare a marker inside a scanned directory", () => {
  for (const id of ["ui-ux-pro-max", "design-motion-principles"]) {
    const skill = skills.find((s) => s.id === id)
    assert.ok(skill)
    assert.ok(skill.markers.length > 0, `${id} markers`)
    for (const marker of skill.markers) {
      // OpenCode scans .opencode/skills; anything else would be installed and
      // invisible, which is exactly the bug this guards against.
      assert.match(marker, /^\.opencode\/skills\//, `${id} marker ${marker}`)
    }
  }
})

test("the plugin-installed skill is not probed by file path", () => {
  const superpowers = skills.find((s) => s.id === "superpowers")
  assert.ok(superpowers)
  assert.deepEqual(superpowers.markers, [])
})

test("providers expose the two gateways and their credential variables", () => {
  assert.deepEqual(
    providers.map((p) => p.id),
    ["kodeo", "globant"],
  )
  for (const provider of providers) {
    assert.match(provider.baseURL, /^https:\/\/.+\/v1$/, `${provider.id} baseURL`)
    assert.ok(provider.env.length > 0, `${provider.id} env`)
    assert.ok(provider.credentialLabel.length > 0, `${provider.id} label`)
  }
})

test("Homebrew installs the GitHub server but never Ghidra", () => {
  assert.ok(brewPackages.formulae.includes("github-mcp-server"))
  // Homebrew ships Ghidra 12.2 and REA 6.8 rejects anything newer than 12.1.x.
  // Listing it here would provision a Ghidra that REA reports as config_drift.
  assert.ok(!brewPackages.formulae.includes("ghidra"))
  assert.ok(!brewPackages.casks.includes("ghidra" as never))
})

test("winget covers the same base set, minus what it cannot provide", () => {
  const packages = basePackages("win32")
  assert.equal(packages.manager, "winget")
  assert.ok(packages.packages.includes("GitHub.cli"))
  assert.ok(packages.packages.includes("OpenJS.NodeJS.LTS"))
  assert.ok(packages.packages.includes("EclipseAdoptium.Temurin.21.JDK"))
  assert.ok(packages.packages.includes("astral-sh.uv"))

  // Neither has a winget manifest; the guide installs both from their release.
  assert.deepEqual(packages.manual, ["github-mcp-server", "ghidra"])
  assert.ok(!packages.packages.includes("github-mcp-server"))
})

test("the macOS base set keeps Homebrew and needs no manual step", () => {
  const packages = basePackages("darwin")
  assert.equal(packages.manager, "brew")
  assert.deepEqual(packages.manual, [])
  assert.ok(packages.packages.includes("gh"))
})

test("REA names the executable its platform actually has", () => {
  const rea = mcps.find((m) => m.id === "rea")
  assert.ok(rea)
  // POSIX spawns the binary directly.
  assert.deepEqual(rea.config({}, "darwin").command, ["rea", "mcp"])
  // A `.cmd` shim cannot be spawned directly on Windows, so it goes through an
  // interpreter that can run one.
  assert.deepEqual(rea.config({}, "win32").command, ["cmd.exe", "/d", "/s", "/c", "rea mcp"])
})

test("every local MCP resolves to a command on both platforms", () => {
  for (const id of ["rea", "graphify", "github"]) {
    const mcp = mcps.find((m) => m.id === id)
    assert.ok(mcp)
    for (const platform of ["darwin", "win32"] as const) {
      const config = mcp.config({}, platform)
      assert.equal(config.type, "local", `${id} ${platform}`)
      assert.ok(Array.isArray(config.command), `${id} ${platform} command`)
      assert.ok((config.command as string[]).length > 0, `${id} ${platform} argv`)
    }
  }
})

test("every local MCP can be installed on at least one platform", () => {
  for (const id of ["rea", "graphify", "github"]) {
    const mcp = mcps.find((m) => m.id === id)
    assert.ok(mcp)
    const installable = (["darwin", "linux", "win32"] as const).some((platform) =>
      Boolean(commandFor(mcp.install ?? "", platform)),
    )
    assert.ok(installable, `${id} has no installer on any platform`)
  }
})
