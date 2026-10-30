/**
 * Installer command lines that differ per platform.
 *
 * These are kept out of `manifest.ts` because a one-line shell script embedded
 * in a data table is unreadable, untestable, and impossible to fix in isolation.
 * Each function documents *why* the platform needs its own form; the manifest
 * only names which one applies.
 *
 * Every Windows script is PowerShell, because the plugin already runs installer
 * commands through PowerShell there — `cmd.exe` mangles quoting around the
 * spaces that appear in `%LOCALAPPDATA%`.
 */

import type { PlatformID } from "./platform.ts"

/** Where a user-scope Windows install of the GitHub server lives. */
export const WINDOWS_GITHUB_DIR = String.raw`$env:LOCALAPPDATA\Programs\github-mcp-server`

/**
 * The GitHub MCP server on Windows.
 *
 * Upstream publishes `github-mcp-server_Windows_x86_64.zip` per release and no
 * package-manager entry, so the installer downloads the current release, unpacks
 * it beside a normal user install, and appends that folder to the *user* PATH.
 * The user PATH is written, not the machine PATH: no elevation is needed, and a
 * `winget`-managed base image is left alone.
 */
export function installGithubMcp(platform: PlatformID): string | undefined {
  if (platform !== "win32") return "brew install github-mcp-server"

  return [
    `$dir = "${WINDOWS_GITHUB_DIR}"`,
    `New-Item -ItemType Directory -Force -Path $dir | Out-Null`,
    `$zip = Join-Path $env:TEMP 'github-mcp-server.zip'`,
    `Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/github/github-mcp-server/releases/latest/download/github-mcp-server_Windows_x86_64.zip' -OutFile $zip`,
    `Expand-Archive -Force -Path $zip -DestinationPath $dir`,
    `$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')`,
    `if ([string]::IsNullOrEmpty($userPath)) { $userPath = '' }`,
    `if ($userPath -notlike "*$dir*") { [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';').TrimStart(';') + ';' + $dir).TrimStart(';'), 'User') }`,
    `$env:Path = "$env:Path;$dir"`,
    `github-mcp-server --help | Out-Null`,
  ].join("; ")
}

/** Refreshing a GitHub server unpacked from a zip means running its own installer again. */
export function updateGithubMcp(platform: PlatformID): string | undefined {
  if (platform !== "win32") return "brew upgrade github-mcp-server"
  return installGithubMcp("win32")
}

/**
 * The GitHub MCP server reads its token from `gh auth token` at launch.
 *
 * On POSIX a shell assignment prefix does it. PowerShell has no equivalent that
 * survives being passed as one argv entry, so the token is assigned to the
 * child's environment first and the server then starts in the same statement.
 */
export function githubMcpCommand(platform: PlatformID): string[] {
  if (platform === "win32") {
    return [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$env:GITHUB_PERSONAL_ACCESS_TOKEN = (gh auth token); github-mcp-server stdio",
    ]
  }
  return ["sh", "-c", 'GITHUB_PERSONAL_ACCESS_TOKEN="$(gh auth token)" exec github-mcp-server stdio']
}

/**
 * `uv tool install` writes a shim, and on Windows that shim is an `.exe` on PATH,
 * so the same command works on both. Ghidra has no package manager on Windows,
 * which is why `INSTALL-WINDOWS.md` unpacks the release instead of installing it.
 */
export function installGraphify(_platform: PlatformID): string {
  return 'uv tool install "graphifyy[mcp]"'
}

export function updateGraphify(_platform: PlatformID): string {
  return 'uv tool upgrade "graphifyy[mcp]"'
}