import { spawn } from "node:child_process"

export type CommandResult = {
  code: number
  stdout: string
  stderr: string
}

/** Expands a leading `~` against the given home directory. */
export function expandHome(path: string, home: string): string {
  if (path === "~") return home
  if (path.startsWith("~/")) return `${home}${path.slice(1)}`
  return path
}

/**
 * Runs a shell command and resolves with its output.
 *
 * A non-zero exit is a normal result, not an exception: callers decide whether a
 * failure is expected (a probe for a missing binary) or a real error (an
 * installer that failed). Commands run through the user's shell so a login PATH
 * resolves `graphify`, `uv`, and the rest.
 */
export async function runCommand(
  command: string,
  options: { cwd?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<CommandResult> {
  const shell = process.env.SHELL || "/bin/zsh"

  return new Promise((resolve) => {
    const child = spawn(shell, ["-lc", command], {
      cwd: options.cwd,
      signal: options.signal,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
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
