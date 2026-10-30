/**
 * What the host operating system requires of the provisioner.
 *
 * The plugin runs on whatever machine OpenCode runs on, and the three families
 * disagree about how to start a command line, where a packaged tool lands, and
 * what an absolute path looks like. Everything that differs is decided here, so
 * the rest of the code asks one question instead of branching on
 * `process.platform` in a dozen places.
 */

import { existsSync } from "node:fs"

export type PlatformID = "darwin" | "linux" | "win32"

export function hostPlatform(): PlatformID {
  if (process.platform === "win32") return "win32"
  if (process.platform === "darwin") return "darwin"
  return "linux"
}

export function pathSeparator(platform: PlatformID): string {
  return platform === "win32" ? "\\" : "/"
}

/** Windows resolves a bare name against PATHEXT; this is what a stock install has. */
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD"

/** A name that already points at a file, rather than at something on PATH. */
function isPathLike(name: string): boolean {
  return name.includes("/") || name.includes("\\") || /^[A-Za-z]:/.test(name)
}

function extensions(platform: PlatformID, env: NodeJS.ProcessEnv, name: string): string[] {
  if (platform !== "win32") return [""]
  const configured = (env.PATHEXT ?? DEFAULT_PATHEXT)
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean)
  // `rea.cmd` must not also be probed as `rea.cmd.exe`.
  if (configured.some((extension) => name.toLowerCase().endsWith(extension))) return [""]
  return configured
}

function pathEntries(platform: PlatformID, env: NodeJS.ProcessEnv): string[] {
  // Windows inherits `Path` under any capitalization, but an injected
  // environment in a test may only carry one of them.
  const raw = env.PATH ?? env.Path ?? env.path
  const delimiter = platform === "win32" ? ";" : ":"
  return (raw ?? "")
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter(Boolean)
}

/**
 * Whether an executable resolves on PATH.
 *
 * This is done in-process rather than by running `which` or `where`: the answer
 * is a filesystem question, and spawning a shell to ask it would make the
 * planner depend on the very shell it is trying to decide about.
 */
export function commandExists(
  platform: PlatformID,
  name: string,
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean = existsSync,
): boolean {
  const trimmed = name.trim().replace(/^"|"$/g, "")
  if (!trimmed) return false
  if (isPathLike(trimmed)) return exists(trimmed)

  const separator = pathSeparator(platform)
  for (const directory of pathEntries(platform, env)) {
    const base = /[\\/]$/.test(directory) ? directory : `${directory}${separator}`
    for (const extension of extensions(platform, env, trimmed)) {
      if (exists(`${base}${trimmed}${extension}`)) return true
    }
  }
  return false
}

export function pathExists(path: string): boolean {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

const SHELLS = new Set(["cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe", "sh", "bash", "zsh", "dash"])

/**
 * Whether a command is a shell that exists only to launch another program.
 *
 * A wrapper is never the interesting binary: `cmd.exe` is on every Windows
 * machine and `sh` on every POSIX one, so probing it answers "is the shell
 * installed" instead of "is the server installed". The real check is the
 * server's own `verify` command.
 */
export function isShellWrapper(name: string): boolean {
  const base = name.trim().replace(/^"|"$/g, "").split(/[\\/]/).pop() ?? ""
  return SHELLS.has(base.toLowerCase())
}

export type ShellFamily = "posix" | "powershell" | "cmd"

export type Shell = {
  family: ShellFamily
  executable: string
  /** Arguments that make the shell run `command` as a single command line. */
  args(command: string): string[]
}

/**
 * The shell that runs an installer command.
 *
 * On POSIX a login shell is what makes a Homebrew or `uv` PATH resolve. On
 * Windows the equivalent is PowerShell: `cmd.exe` mangles quoting around paths
 * that contain spaces, and those are the paths a toolchain install lands in.
 */
export function shellFor(
  platform: PlatformID,
  env: NodeJS.ProcessEnv,
  has: (name: string) => boolean,
): Shell {
  if (platform !== "win32") {
    const fallback = platform === "darwin" ? "/bin/zsh" : "/bin/sh"
    return {
      family: "posix",
      executable: env.SHELL || fallback,
      args: (command) => ["-lc", command],
    }
  }

  if (has("powershell.exe")) {
    return {
      family: "powershell",
      executable: "powershell.exe",
      args: (command) => ["-NoProfile", "-NonInteractive", "-Command", command],
    }
  }

  return {
    family: "cmd",
    executable: "cmd.exe",
    args: (command) => ["/d", "/s", "/c", command],
  }
}

/** The user's home directory as the platform's own environment spells it. */
export function homeFromEnv(platform: PlatformID, env: NodeJS.ProcessEnv): string | undefined {
  if (platform === "win32") return env.USERPROFILE ?? env.HOME
  return env.HOME
}

/**
 * Turns a command line into argv a spawner can use.
 *
 * On POSIX the words are already the argv. On Windows a `.cmd` shim — which is
 * what `npm install -g` writes for every CLI — cannot be executed directly, so
 * the line goes through `cmd.exe`, which is how the shim is meant to be run.
 */
export function commandLine(platform: PlatformID, line: string): string[] {
  if (platform !== "win32") return line.split(/\s+/).filter(Boolean)
  return ["cmd.exe", "/d", "/s", "/c", line]
}