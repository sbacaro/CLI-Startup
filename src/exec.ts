import { spawn } from "node:child_process"

import { commandExists, hostPlatform, pathExists, shellFor, type PlatformID } from "./platform.ts"

export type CommandResult = {
  code: number
  stdout: string
  stderr: string
}

/**
 * Expands a leading `~` against the given home directory.
 *
 * A marker file is written by another tool and may use either separator, so both
 * forms are accepted rather than only the one this machine happens to use.
 */
export function expandHome(path: string, home: string): string {
  if (path === "~") return home
  if (path.startsWith("~/")) return `${home}${path.slice(1)}`
  // Same rule with the other separator: the separator is kept, so a Windows
  // home that ends in a backslash does not become `me\.config`.
  if (path.startsWith("~\\")) return `${home.replace(/[\\/]+$/, "")}${path.slice(1)}`
  return path
}

export type RunOptions = {
  cwd?: string
  timeoutMs?: number
  signal?: AbortSignal
  platform?: PlatformID
  env?: NodeJS.ProcessEnv
}

/**
 * Runs a shell command and resolves with its output.
 *
 * A non-zero exit is a normal result, not an exception: callers decide whether a
 * failure is expected (a probe for a missing binary) or a real error (an
 * installer that failed). Commands run through the user's shell — a login shell
 * on POSIX, PowerShell on Windows — so a PATH set up by Homebrew, `uv`, or
 * `winget` resolves `graphify`, `rea`, and the rest.
 */
export async function runCommand(command: string, options: RunOptions = {}): Promise<CommandResult> {
  const platform = options.platform ?? hostPlatform()
  const env = options.env ?? process.env
  const shell = shellFor(platform, env, (name) => commandExists(platform, name, env, pathExists))

  return new Promise((resolve) => {
    const child = spawn(shell.executable, shell.args(command), {
      cwd: options.cwd,
      signal: options.signal,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      // Windows cannot deliver a POSIX signal; `kill` still terminates the tree
      // once the shell is a direct child.
      windowsHide: true,
    })

    let stdout = ""
    let stderr = ""
    let settled = false

    const finish = (result: CommandResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(
      () => {
        child.kill("SIGTERM")
        finish({ code: 124, stdout, stderr: `${stderr}\ntimed out` })
      },
      options.timeoutMs ?? 10 * 60 * 1000,
    )

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on("error", (error) => {
      finish({ code: 127, stdout, stderr: `${stderr}${error.message}` })
    })

    child.on("close", (code) => {
      finish({ code: code ?? 0, stdout, stderr })
    })
  })
}