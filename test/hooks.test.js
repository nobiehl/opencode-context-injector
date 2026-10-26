import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile, unlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { setTimeout as delay } from "node:timers/promises"

import plugin from "../index.js"

async function createPlugin(t, files = {}, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-context-injector-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, ".opencode"))
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(root, ".opencode", name), content)
  }
  const sessionHooks = {}
  const toolHooks = {}
  const histories = new Map()
  const outcomes = new Map()
  const prompts = []
  const events = []
  let wake = Promise.withResolvers()
  let subscriptionSignal
  let subscriptions = 0
  let promptCounter = 0

  const ctx = {
    options: options.pluginOptions ?? {},
    location: { directory: root, project: { directory: options.projectRoot ?? root } },
    session: {
      hook: async (name, callback) => { sessionHooks[name] = callback },
      context: async ({ sessionID }) => histories.get(sessionID) ?? [],
      get: async ({ sessionID }) => ({
        location: { directory: root }, time: {}, outcome: outcomes.get(sessionID) ?? "succeeded",
      }),
      synthetic: async (request, requestOptions) => {
        assert.equal(requestOptions.signal.aborted, false)
        if (options.synthetic) await options.synthetic(request)
        prompts.push(request)
      },
    },
    tool: { hook: async (name, callback) => { toolHooks[name] = callback } },
    event: {
      subscribe: async function* ({ signal }) {
        subscriptionSignal = signal
        subscriptions += 1
        const onAbort = () => wake.resolve()
        signal.addEventListener("abort", onAbort)
        try {
          if (options.disconnectOnce && subscriptions === 1) throw new Error("Disconnected")
          while (!signal.aborted) {
            const next = events.shift()
            if (next) {
              yield next
              continue
            }
            await wake.promise
            wake = Promise.withResolvers()
          }
        } finally {
          signal.removeEventListener("abort", onAbort)
        }
      },
    },
  }

  let cleanup = await plugin.setup(ctx)
  t.after(() => cleanup())

  async function prompt(text = "Please inspect the project.", sessionID = "ses_1", extra = {}) {
    const event = { sessionID, messageID: `msg_${++promptCounter}`, prompt: { text, ...extra.prompt },
      metadata: extra.metadata, delivery: extra.delivery ?? "steer" }
    await sessionHooks.prompt(event)
    return event
  }

  function deliver(event) {
    const history = histories.get(event.sessionID) ?? []
    history.push({ id: event.messageID, type: "user", ...event.prompt, metadata: event.metadata })
    histories.set(event.sessionID, history)
  }

  async function user(text, sessionID = "ses_1", extra = {}) {
    const event = await prompt(text, sessionID, extra)
    deliver(event)
    return event
  }

  async function context(sessionID = "ses_1", system = [{ type: "text", text: "Base system prompt" }]) {
    const event = { sessionID, system, messages: [], options: {}, tools: {} }
    await sessionHooks.context(event)
    return event
  }

  async function emit(type, data = {}, location = { directory: root }) {
    const drained = Promise.withResolvers()
    events.push({ type, data, location }, { type: "test.drained", data: {} })
    // The sentinel is pulled only after handleEvent has completed.
    const originalShift = events.shift.bind(events)
    events.shift = () => {
      const event = originalShift()
      if (event?.type === "test.drained") drained.resolve()
      return event
    }
    wake.resolve()
    await drained.promise
    events.shift = originalShift
  }

  const idle = (sessionID = "ses_1", location) => emit("session.status",
    { sessionID, status: { type: "idle" } }, location)

  return { root, ctx, histories, outcomes, prompts, sessionHooks, toolHooks, user, prompt, deliver, context, emit, idle,
    signal: () => subscriptionSignal,
    subscriptions: () => subscriptions,
    cleanup: () => cleanup(),
    reload: async () => { await cleanup(); cleanup = await plugin.setup(ctx) },
  }
}

test("default export is a V2 plugin definition without V1 hooks", () => {
  assert.equal(plugin.id, "opencode-context-injector")
  assert.equal(typeof plugin.setup, "function")
  assert.deepEqual(Object.keys(plugin), ["id", "setup"])
})

test("normal instructions go into structured system parts, not user text", async (t) => {
  const p = await createPlugin(t, { "inject-user.md": "Keep changes focused." })
  const event = await p.user("Please inspect the project.")
  const output = await p.context()
  assert.equal(event.prompt.text, "Please inspect the project.")
  assert.deepEqual(output.system, [
    { type: "text", text: "Base system prompt" }, { type: "text", text: "Keep changes focused." },
  ])
  await p.context("ses_1", output.system)
  assert.equal(output.system.length, 2)
})

test("instructions remain present on tool-driven continuations", async (t) => {
  const p = await createPlugin(t, { "inject-user.md": "Stay focused." })
  await p.user("Inspect.")
  await p.context()
  p.histories.get("ses_1").push({ type: "assistant", content: [] })
  assert.equal((await p.context()).system[1].text, "Stay focused.")
})

test("compaction retains the verified active-turn decision when input leaves the context window", async (t) => {
  const p = await createPlugin(t, { "inject-user.md": "Rules.", "inject-idle.md": "Follow up." })
  const input = await p.user("Inspect.")
  await p.context()
  p.histories.set("ses_1", [{ type: "compaction", status: "completed", summary: "Earlier work." }])
  assert.equal((await p.context()).system.length, 2)
  await p.idle()
  assert.equal(p.prompts[0].id, `${input.messageID}_context_injector_idle`)

  await p.user("? Next task.")
  await p.context()
  p.histories.set("ses_1", [{ type: "compaction", status: "completed", summary: "Earlier work." }])
  assert.equal((await p.context()).system.length, 1)
  await p.idle()
  assert.equal(p.prompts.length, 1)
})

for (const text of ["? skip this once", '"? skip this once"', "   ? skip this once", "?"]) {
  test(`bypass persists on the admitted input: ${JSON.stringify(text)}`, async (t) => {
    const p = await createPlugin(t, { "inject-user.md": "Rules.", "inject-idle.md": "Follow up." })
    const event = await p.user(text)
    assert.equal(event.prompt.text, text === "?" ? "" : "skip this once")
    assert.equal(event.metadata.injectUserBypass, true)
    assert.equal((await p.context()).system.length, 1)
    await p.idle()
    await p.idle()
    assert.equal(p.prompts.length, 0)
  })
}

test("a question without the bypass delimiter stays unchanged", async (t) => {
  const p = await createPlugin(t, { "inject-user.md": "Rules." })
  const event = await p.user("?what does this do?")
  assert.equal(event.prompt.text, "?what does this do?")
  assert.equal((await p.context()).system.length, 2)
})

test("bypass preserves metadata and fixes attachment mention offsets", async (t) => {
  const p = await createPlugin(t)
  const event = await p.user("? inspect @guide", "ses_1", {
    metadata: { custom: true },
    prompt: { files: [{ uri: "file:///guide.md", mention: { start: 10, end: 16, text: "@guide" } }] },
  })
  assert.deepEqual(event.metadata, { custom: true, injectUserBypass: true })
  assert.deepEqual(event.prompt.files[0].mention, { start: 8, end: 14, text: "@guide" })
})

test("quoted bypass drops mention offsets that cannot be mapped safely", async (t) => {
  const p = await createPlugin(t)
  const event = await p.user('"? inspect @guide"', "ses_1", {
    prompt: { files: [{ uri: "file:///guide.md", mention: { start: 11, end: 17, text: "@guide" } }] },
  })
  assert.equal(event.prompt.files[0].mention, undefined)
})

test("queued bypass does not change the active normal turn", async (t) => {
  const p = await createPlugin(t, { "inject-user.md": "Rules." })
  await p.user("Active task.")
  const queued = await p.prompt("? queued question", "ses_1", { delivery: "queue" })
  assert.equal((await p.context()).system.length, 2)
  p.deliver(queued)
  assert.equal((await p.context()).system.length, 1)
})

test("queued normal prompt does not clear the active bypass", async (t) => {
  const p = await createPlugin(t, { "inject-user.md": "Rules.", "inject-idle.md": "Follow up." })
  await p.user("? Active task.")
  const queued = await p.prompt("Next task.", "ses_1", { delivery: "queue" })
  assert.equal((await p.context()).system.length, 1)
  await p.idle()
  assert.equal(p.prompts.length, 0)
  p.deliver(queued)
  assert.equal((await p.context()).system.length, 2)
})

test("idle follow-up is queued once with a stable id; repeated idle events do not loop", async (t) => {
  const p = await createPlugin(t, { "inject-user.md": "Rules.", "inject-idle.md": "Check remaining work." })
  const input = await p.user("Inspect.")
  await p.context()
  await p.idle()
  await p.idle()
  await p.idle()
  assert.equal(p.prompts.length, 1)
  assert.equal(p.prompts[0].text, "Check remaining work.")
  assert.equal(p.prompts[0].id, `${input.messageID}_context_injector_idle`)
  assert.equal(p.prompts[0].delivery, "queue")
  p.histories.get("ses_1").push({ ...p.prompts[0], type: "synthetic" })
  assert.equal((await p.context()).system.length, 1)
  await p.idle()
  assert.equal(p.prompts.length, 1)
  await p.user("Another task.")
  await p.context()
  await p.idle()
  assert.equal(p.prompts.length, 2)
})

test("a failed idle admission can retry without changing its id", async (t) => {
  let attempts = 0
  const ids = []
  const p = await createPlugin(t, { "inject-idle.md": "Follow up." }, {
    synthetic: async (request) => {
      ids.push(request.id)
      if (++attempts === 1) throw new Error("Admission failed")
    },
  })
  await p.user("Inspect.")
  await p.context()
  await p.idle()
  await p.idle()
  assert.equal(p.prompts.length, 1)
  assert.equal(ids[0], ids[1])
})

test("synthetic inputs never receive user instructions or idle follow-ups", async (t) => {
  const p = await createPlugin(t, { "inject-user.md": "Rules.", "inject-idle.md": "Follow up." })
  p.histories.set("ses_1", [{ id: "msg_synthetic", type: "synthetic", text: "Automation." }])
  assert.equal((await p.context()).system.length, 1)
  await p.idle()
  assert.equal(p.prompts.length, 0)
})

test("explicit integration bypass skips both injection chains", async (t) => {
  const p = await createPlugin(t, { "inject-user.md": "Rules.", "inject-idle.md": "Follow up." })
  await p.user("Command template.", "ses_1", { metadata: { injectContextBypass: true } })
  assert.equal((await p.context()).system.length, 1)
  await p.idle()
  assert.equal(p.prompts.length, 0)
})

test("shell messages and shell events suppress idle follow-up", async (t) => {
  const p = await createPlugin(t, { "inject-user.md": "Rules.", "inject-idle.md": "Follow up." })
  await p.user("! echo hello")
  assert.equal((await p.context()).system.length, 1)
  await p.idle()
  assert.equal(p.prompts.length, 0)
  await p.user("Inspect.")
  await p.context()
  await p.emit("session.shell.started", { sessionID: "ses_1" })
  await p.idle()
  assert.equal(p.prompts.length, 0)
})

test("model shell tools suppress idle but keep normal system injection", async (t) => {
  const p = await createPlugin(t, { "inject-user.md": "Rules.", "inject-idle.md": "Follow up." })
  await p.user("Run tests.")
  await p.context()
  await p.toolHooks["execute.before"]({ sessionID: "ses_1", tool: "shell" })
  assert.equal((await p.context()).system.length, 2)
  await p.idle()
  assert.equal(p.prompts.length, 0)
})

test("reload recovers bypass and prior shell activity from delivered history", async (t) => {
  const p = await createPlugin(t, { "inject-user.md": "Rules.", "inject-idle.md": "Follow up." })
  await p.user("? Inspect.")
  await p.reload()
  assert.equal((await p.context()).system.length, 1)
  await p.idle()
  assert.equal(p.prompts.length, 0)
  await p.user("Run tests.")
  p.histories.get("ses_1").push({ type: "assistant", content: [{ type: "tool", name: "shell" }] })
  await p.reload()
  await p.context()
  await p.idle()
  assert.equal(p.prompts.length, 0)
})

test("failed and interrupted tasks do not launch autonomous follow-ups", async (t) => {
  const p = await createPlugin(t, { "inject-idle.md": "Follow up." })
  for (const outcome of ["failed", "interrupted"]) {
    await p.user("Inspect.")
    await p.context()
    p.outcomes.set("ses_1", outcome)
    await p.idle()
  }
  assert.equal(p.prompts.length, 0)
})

test("global events from other locations and untracked sessions are ignored", async (t) => {
  const p = await createPlugin(t, { "inject-idle.md": "Follow up." })
  await p.user("Inspect.")
  await p.context()
  await p.idle("ses_1", { directory: path.join(p.root, "other-project") })
  await p.idle("ses_untracked")
  assert.equal(p.prompts.length, 0)
  await p.idle()
  assert.equal(p.prompts.length, 1)
})

test("public events without workspace IDs still match their directory", async (t) => {
  const p = await createPlugin(t, { "inject-idle.md": "Follow up." })
  p.ctx.location.workspaceID = "workspace-current"
  await p.user("Inspect.")
  await p.context()
  await p.idle("ses_1", { directory: p.root, workspaceID: "workspace-other" })
  assert.equal(p.prompts.length, 0)
  await p.idle()
  assert.equal(p.prompts.length, 1)
})

test("archived, deleted and moved sessions release their tracked state", async (t) => {
  const p = await createPlugin(t, { "inject-idle.md": "Follow up." })
  for (const type of ["session.archived", "session.deleted", "session.moved"]) {
    await p.user("Inspect.")
    await p.context()
    await p.emit(type, { sessionID: "ses_1" })
    await p.idle()
  }
  assert.equal(p.prompts.length, 0)
})

test("missing and empty files disable injection; large files are accepted", async (t) => {
  const p = await createPlugin(t, { "inject-user.md": "  \n", "inject-idle.md": "" })
  await p.user("Inspect.")
  assert.equal((await p.context()).system.length, 1)
  await p.idle()
  assert.equal(p.prompts.length, 0)
  const text = "x".repeat(5001)
  await writeFile(path.join(p.root, ".opencode", "inject-user.md"), text)
  assert.equal((await p.context()).system[1].text, text)
  await unlink(path.join(p.root, ".opencode", "inject-user.md"))
  assert.equal((await p.context()).system.length, 1)
})

test("cached instruction files update on edits and expand the current date", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-26T23:59:59Z") })
  const p = await createPlugin(t, { "inject-user.md": "Date: {{CURRENT_DATE}}" })
  await p.user("Inspect.")
  assert.equal((await p.context()).system[1].text, "Date: 2026-10-26")
  t.mock.timers.setTime(new Date("2026-10-27T00:00:01Z").getTime())
  assert.equal((await p.context()).system[1].text, "Date: 2026-10-27")
  await writeFile(path.join(p.root, ".opencode", "inject-user.md"), "Updated.")
  assert.equal((await p.context()).system[1].text, "Updated.")
})

test("project root is a fallback for nested locations; local files take precedence", async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "opencode-context-parent-"))
  t.after(() => rm(parent, { recursive: true, force: true }))
  await mkdir(path.join(parent, ".opencode"))
  await writeFile(path.join(parent, ".opencode", "inject-user.md"), "Root rules.")
  const p = await createPlugin(t, {}, { projectRoot: parent })
  await p.user("Inspect.")
  assert.equal((await p.context()).system[1].text, "Root rules.")
  await writeFile(path.join(p.root, ".opencode", "inject-user.md"), "Local rules.")
  assert.equal((await p.context()).system[1].text, "Local rules.")
})

test("cleanup aborts the subscription and is safe to call twice", async (t) => {
  const p = await createPlugin(t)
  await p.cleanup()
  assert.equal(p.signal().aborted, true)
  await p.cleanup()
})

test("a disconnected event stream reconnects and cleanup cancels its retry timer", async (t) => {
  const p = await createPlugin(t, {}, { disconnectOnce: true })
  await delay(1100)
  assert.equal(p.subscriptions(), 2)
  await p.cleanup()
  assert.equal(p.signal().aborted, true)
})

test("debug logging is optional and never includes instruction text", async (t) => {
  const logs = []
  const original = console.info
  console.info = (entry) => logs.push(JSON.parse(entry))
  t.after(() => { console.info = original })
  const disabled = await createPlugin(t, { "inject-user.md": "PRIVATE instruction text" })
  await disabled.user("Inspect.")
  await disabled.context()
  assert.equal(logs.length, 0)
  const enabled = await createPlugin(t, { "inject-user.md": "PRIVATE instruction text" }, { pluginOptions: { debug: true } })
  await enabled.user("Inspect.")
  await enabled.context()
  assert.deepEqual(logs.map((entry) => entry.message), ["loaded", "context.injected"])
  assert.equal(logs[1].instructionLength, "PRIVATE instruction text".length)
  assert.equal(JSON.stringify(logs).includes("PRIVATE"), false)
})
