import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { OpenCodeContextInjector } from "../index.js"

async function createPlugin(files = {}, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-context-injector-"))
  await mkdir(path.join(root, ".opencode"))
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(root, ".opencode", name), content)
  }

  const prompts = []
  const hooks = await OpenCodeContextInjector({
    client: {
      app: options.app,
      session: { prompt: async (request) => prompts.push(request) },
    },
    worktree: root,
    directory: root,
  })

  return { root, hooks, prompts }
}

test("injects normal instructions into the system prompt without changing user text", async () => {
  const { root, hooks } = await createPlugin({ "inject-user.md": "Keep changes focused." })
  try {
    const message = { type: "text", text: "Please inspect the project." }
    await hooks["chat.message"]({ sessionID: "session-1" }, { parts: [message] })

    const output = { system: ["Base system prompt"] }
    await hooks["experimental.chat.system.transform"]({ sessionID: "session-1" }, output)

    assert.equal(message.text, "Please inspect the project.")
    assert.deepEqual(output.system, ["Base system prompt", "Keep changes focused."])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("bypass and synthetic idle prompts do not receive normal instructions", async () => {
  const { root, hooks, prompts } = await createPlugin({
    "inject-user.md": "Keep changes focused.",
    "inject-idle.md": "Check the remaining work.",
  })
  try {
    const bypass = { type: "text", text: "? skip this once" }
    await hooks["chat.message"]({ sessionID: "session-2" }, { parts: [bypass] })
    const bypassOutput = { system: ["Base system prompt"] }
    await hooks["experimental.chat.system.transform"]({ sessionID: "session-2" }, bypassOutput)
    assert.equal(bypass.text, "skip this once")
    assert.deepEqual(bypassOutput.system, ["Base system prompt"])

    await hooks.event({
      event: { type: "session.status", properties: { sessionID: "session-2", status: { type: "idle" } } },
    })
    await hooks.event({
      event: { type: "session.status", properties: { sessionID: "session-2", status: { type: "idle" } } },
    })
    assert.equal(prompts.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("bypass also handles the quoted text used by opencode run", async () => {
  const { root, hooks, prompts } = await createPlugin({
    "inject-user.md": "Keep changes focused.",
    "inject-idle.md": "Check the remaining work.",
  })
  try {
    const bypass = { type: "text", text: '"? skip this once"' }
    await hooks["chat.message"]({ sessionID: "session-quoted" }, { parts: [bypass] })
    const output = { system: ["Base system prompt"] }
    await hooks["experimental.chat.system.transform"]({ sessionID: "session-quoted" }, output)
    assert.equal(bypass.text, "skip this once")
    assert.deepEqual(output.system, ["Base system prompt"])

    await hooks.event({
      event: { type: "session.status", properties: { sessionID: "session-quoted", status: { type: "idle" } } },
    })
    assert.equal(output.system.length, 1)
    assert.equal(prompts.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("accepts instruction files without an artificial size limit", async () => {
  const instructions = "Keep this verified context.\n" + "x".repeat(5000)
  const { root, hooks } = await createPlugin({ "inject-user.md": instructions })
  try {
    await hooks["chat.message"]({ sessionID: "session-3" }, { parts: [{ type: "text", text: "Continue." }] })
    const output = { system: ["Base system prompt"] }
    await hooks["experimental.chat.system.transform"]({ sessionID: "session-3" }, output)
    assert.equal(output.system[1], instructions)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("logs hook execution only when debug mode is enabled", async () => {
  const previousDebug = process.env.OPENCODE_CONTEXT_INJECTOR_DEBUG
  process.env.OPENCODE_CONTEXT_INJECTOR_DEBUG = "1"
  const logs = []
  const { root, hooks } = await createPlugin(
    { "inject-user.md": "Keep this verified context." },
    { app: { log: async (entry) => logs.push(entry) } },
  )
  try {
    await hooks["chat.message"]({ sessionID: "session-4" }, { parts: [{ type: "text", text: "Continue." }] })
    await hooks["experimental.chat.system.transform"]({ sessionID: "session-4" }, { system: ["Base"] })

    assert.deepEqual(
      logs.map((entry) => entry.body.message),
      ["chat.message", "experimental.chat.system.transform", "experimental.chat.system.transform.injected"],
    )
    assert.equal(logs[2].body.extra.instructionLength, "Keep this verified context.".length)
  } finally {
    await rm(root, { recursive: true, force: true })
    if (previousDebug === undefined) delete process.env.OPENCODE_CONTEXT_INJECTOR_DEBUG
    else process.env.OPENCODE_CONTEXT_INJECTOR_DEBUG = previousDebug
  }
})
