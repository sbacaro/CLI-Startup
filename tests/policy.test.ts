import { test } from "node:test"
import assert from "node:assert/strict"

import { describeStatus, UPDATE_POLICY, type ComponentStatus } from "../src/policy.ts"

test("describes a fully current set without an action line", () => {
  const text = describeStatus([
    { id: "superpowers", installed: "7.0.1", available: "7.0.1", state: "current" },
  ])
  assert.match(text, /superpowers: 7\.0\.1 \(current\)/)
  assert.doesNotMatch(text, /startup_update/)
})

test("marks an outdated component with its target version", () => {
  const text = describeStatus([
    { id: "superpowers", installed: "6.4.2", available: "7.0.1", state: "outdated" },
  ])
  assert.match(text, /6\.4\.2 -> 7\.0\.1/)
  assert.match(text, /startup_update/)
})

test("lists every actionable component in one line", () => {
  const components: ComponentStatus[] = [
    { id: "superpowers", installed: "6.4.2", available: "7.0.1", state: "outdated" },
    { id: "rea", installed: undefined, available: "6.8.0", state: "missing" },
    { id: "ui-ux-pro-max", installed: "2.15.0", available: "2.15.0", state: "current" },
  ]
  const text = describeStatus(components)
  assert.match(text, /startup_update.*superpowers.*rea/)
})

test("says so when there is nothing to report", () => {
  assert.equal(describeStatus([]), "No components configured.")
})

test("the policy names every tool and the credential rule", () => {
  assert.match(UPDATE_POLICY, /startup_status/)
  assert.match(UPDATE_POLICY, /startup_provision/)
  assert.match(UPDATE_POLICY, /startup_update/)
  assert.match(UPDATE_POLICY, /never in a repository/i)
})
