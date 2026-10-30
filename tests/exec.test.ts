import { test } from "node:test"
import assert from "node:assert/strict"

import { expandHome, runCommand } from "../src/exec.ts"
import { hostPlatform } from "../src/platform.ts"

const windows = hostPlatform() === "win32"

/**
 * Commands for the host that is actually running, so the same behaviours are
 * verified on every platform instead of only on POSIX.
 */
const probe = {
  echo: windows ? "Write-Output -NoEnumerate 'hello'" : "printf hello",
  exit: (code: number) => (windows ? `exit ${code}` : `exit ${code}`),
  stderr: windows
    ? "$host.ui.WriteErrorLine('oops'); exit 1"
    : "printf oops >&2; exit 1",
  sleep: windows ? "Start-Sleep -Seconds 5" : "sleep 5",
}

test("expands a leading tilde against the home directory", () => {
  assert.equal(expandHome("~/.config/opencode", "/Users/me"), "/Users/me/.config/opencode")
  assert.equal(expandHome("~/", "/Users/me"), "/Users/me/")
})

test("expands a tilde written with a Windows separator", () => {
  // A marker file is written by another tool and may use either separator.
  assert.equal(
    expandHome(String.raw`~\.config\opencode`, String.raw`C:\Users\me`),
    String.raw`C:\Users\me\.config\opencode`,
  )
})

test("leaves an absolute path untouched", () => {
  assert.equal(expandHome("/opt/homebrew/bin", "/Users/me"), "/opt/homebrew/bin")
})

test("leaves a Windows absolute path untouched", () => {
  assert.equal(expandHome(String.raw`C:\tools\rea.cmd`, String.raw`C:\Users\me`), String.raw`C:\tools\rea.cmd`)
})

test("leaves a bare tilde inside a path untouched", () => {
  assert.equal(expandHome("/tmp/~cache", "/Users/me"), "/tmp/~cache")
})

test("runs a command and reports success", async () => {
  const result = await runCommand(probe.echo)
  assert.equal(result.code, 0)
  assert.match(result.stdout, /hello/)
})

test("reports a non-zero exit without throwing", async () => {
  const result = await runCommand(probe.exit(3))
  assert.equal(result.code, 3)
})

test("captures stderr", async () => {
  const result = await runCommand(probe.stderr)
  assert.equal(result.code, 1)
  assert.match(result.stderr, /oops/)
})

test("a command killed by its timeout reports code 124", async () => {
  const started = Date.now()
  const result = await runCommand(probe.sleep, { timeoutMs: 50 })

  assert.equal(result.code, 124)
  assert.match(result.stderr, /timed out/)
  // A timeout must return promptly instead of waiting for the full command.
  assert.ok(Date.now() - started < 2_000)
})

test("honours an injected environment", async () => {
  const result = await runCommand(windows ? "$env:PROBE_VALUE" : 'printf %s "$PROBE_VALUE"', {
    env: { ...process.env, PROBE_VALUE: "injected" },
  })
  assert.equal(result.stdout.trim(), "injected")
})