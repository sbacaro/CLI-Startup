import { test } from "node:test"
import assert from "node:assert/strict"

import {
  githubMcpCommand,
  installGithubMcp,
  updateGithubMcp,
  WINDOWS_GITHUB_DIR,
} from "../src/installers.ts"

test("the POSIX GitHub installer is the Homebrew formula", () => {
  assert.equal(installGithubMcp("darwin"), "brew install github-mcp-server")
  assert.equal(installGithubMcp("linux"), "brew install github-mcp-server")
  assert.equal(updateGithubMcp("darwin"), "brew upgrade github-mcp-server")
})

test("the Windows GitHub installer downloads the published zip", () => {
  const command = installGithubMcp("win32")
  assert.ok(command)
  // Upstream publishes no winget package; the release asset is the only source.
  assert.match(command, /github-mcp-server_Windows_x86_64\.zip/)
  assert.match(command, /releases\/latest\/download/)
})

test("the Windows GitHub installer unpacks into a user-scope folder", () => {
  const command = installGithubMcp("win32")
  assert.ok(command)
  assert.match(command, /Expand-Archive/)
  assert.equal(WINDOWS_GITHUB_DIR, String.raw`$env:LOCALAPPDATA\Programs\github-mcp-server`)
})

test("the Windows GitHub installer writes the user PATH, not the machine PATH", () => {
  const command = installGithubMcp("win32")
  assert.ok(command)
  // Writing the machine PATH needs elevation and would edit a value the user
  // does not own; a per-user install only ever needs the user scope.
  assert.match(command, /GetEnvironmentVariable\('Path', 'User'\)/)
  assert.match(command, /SetEnvironmentVariable\('Path'.*'User'\)/)
  assert.doesNotMatch(command, /Machine\)/)
})

test("the Windows GitHub installer is idempotent about the PATH entry", () => {
  const command = installGithubMcp("win32")
  assert.ok(command)
  // Re-provisioning must not append the same folder a second time.
  assert.match(command, /-notlike/)
})

test("the Windows GitHub installer tolerates an empty user PATH", () => {
  const command = installGithubMcp("win32")
  assert.ok(command)
  // A fresh Windows profile has no user PATH at all, and `GetEnvironmentVariable`
  // then returns $null; calling `.TrimEnd` on it aborts the whole install.
  assert.match(command, /IsNullOrEmpty\(\$userPath\)/)
})

test("updating on Windows re-runs the same download", () => {
  assert.equal(updateGithubMcp("win32"), installGithubMcp("win32"))
})

test("the POSIX GitHub server reads its token from gh in one shell command", () => {
  assert.deepEqual(githubMcpCommand("darwin"), [
    "sh",
    "-c",
    'GITHUB_PERSONAL_ACCESS_TOKEN="$(gh auth token)" exec github-mcp-server stdio',
  ])
})

test("the Windows GitHub server reads its token through PowerShell", () => {
  const command = githubMcpCommand("win32")
  assert.equal(command[0], "powershell.exe")
  assert.match(command.join(" "), /gh auth token/)
  assert.match(command.join(" "), /github-mcp-server stdio/)
})

test("no install command carries a literal credential", () => {
  for (const platform of ["darwin", "linux", "win32"] as const) {
    const commands = [installGithubMcp(platform) ?? "", githubMcpCommand(platform).join(" ")]
    for (const command of commands) {
      // A token in a command line ends up in shell history, process listings,
      // and the config the user can export.
      assert.doesNotMatch(command, /gh[po]_[A-Za-z0-9]{10,}/, `${platform}: ${command}`)
    }
  }
})