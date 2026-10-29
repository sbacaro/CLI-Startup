import { test } from "node:test"
import assert from "node:assert/strict"

import { expandHome, runCommand } from "../src/exec.ts"

test("expands a leading tilde against the home directory", () => {
  assert.equal(expandHome("~/.config/opencode", "/Users/me"), "/Users/me/.config/opencode")
  assert.equal(expandHome("~/", "/Users/me"), "/Users/me/")
})

test("leaves an absolute path untouched", () => {
  assert.equal(expandHome("/opt/homebrew/bin", "/Users/me"), "/opt/homebrew/bin")
})

test("leaves a bare tilde inside a path untouched", () => {
  assert.equal(expandHome("/tmp/~cache", "/Users/me"), "/tmp/~cache")
})

test("runs a command and reports success", async () => {
  const result = await runCommand("printf hello")
  assert.equal(result.code, 0)
  assert.equal(result.stdout, "hello")
})

test("reports a non-zero exit without throwing", async () => {
  const result = await runCommand("exit 3")
  assert.equal(result.code, 3)
})

test("captures stderr", async () => {
  const result = await runCommand("printf oops >&2; exit 1")
  assert.equal(result.code, 1)
  assert.equal(result.stderr, "oops")
})

test("a command killed by its timeout reports code 124", async () => {
  const started = Date.now()
  const result = await runCommand("sleep 5", { timeoutMs: 50 })

  assert.equal(result.code, 124)
  assert.match(result.stderr, /timed out/)
  // A timeout must return promptly instead of waiting for the full command.
  assert.ok(Date.now() - started < 1_000)
})
