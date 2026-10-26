import path from "node:path"
import { readFile, stat } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"

const pluginID = "opencode-context-injector"
const shellTools = new Set(["bash", "shell", "cmd", "powershell"])

function normalizeMessageText(text) {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed
  try {
    const parsed = JSON.parse(trimmed)
    return typeof parsed === "string" ? parsed.trimStart() : trimmed
  } catch {
    return trimmed
  }
}

/** @param {import("@opencode/plugin/promise/session").SessionPrompt["prompt"]} prompt */
function removeBypassPrefix(prompt) {
  const text = normalizeMessageText(prompt.text)
  if (text !== "?" && !text.startsWith("? ")) return false
  const replacement = text.slice(1).trimStart()
  const removed = prompt.text.endsWith(replacement) ? prompt.text.length - replacement.length : undefined
  for (const attachment of [...(prompt.files ?? []), ...(prompt.agents ?? []), ...(prompt.skills ?? [])]) {
    if (!attachment.mention) continue
    if (removed === undefined || attachment.mention.start < removed) {
      delete attachment.mention
    } else {
      attachment.mention = {
        ...attachment.mention,
        start: attachment.mention.start - removed,
        end: attachment.mention.end - removed,
      }
    }
  }
  prompt.text = replacement
  return true
}

/** @param {Awaited<ReturnType<import("@opencode/plugin/promise/plugin").Context["session"]["context"]>>} messages */
function latestInput(messages) {
  return messages.findLast((message) => ["user", "synthetic", "shell"].includes(message.type))
}

// Plugin.define is an identity helper. A typed definition keeps this single-file
// installation dependency-free while checking it against the released V2 API.
/** @type {import("@opencode/plugin/promise/plugin").Plugin} */
const OpenCodeContextInjector = {
  id: pluginID,
  async setup(ctx) {
    const controller = new AbortController()
    const { signal } = controller
    const debug = ctx.options.debug === true || ["1", "true", "yes"].includes(
      (process.env.OPENCODE_CONTEXT_INJECTOR_DEBUG ?? "").toLowerCase(),
    )
    const roots = [...new Set([ctx.location.directory, ctx.location.project.directory])]
    /** @type {Map<string, {stamp: string, content: string}>} */
    const files = new Map()
    /** @type {Map<string, {inputID: string, injectUser: boolean, skipIdle: boolean, followup: "pending" | "sending" | "done"}>} */
    const sessions = new Map()

    function debugLog(message, extra = {}) {
      if (debug) console.info(JSON.stringify({ service: pluginID, message, ...extra }))
    }

    async function loadInstructions(filename) {
      for (const root of roots) {
        const file = path.join(root, ".opencode", filename)
        try {
          const info = await stat(file, { bigint: true })
          const stamp = `${info.mtimeNs}:${info.ctimeNs}:${info.size}`
          let cached = files.get(file)
          if (cached?.stamp !== stamp) {
            cached = { stamp, content: (await readFile(file, { encoding: "utf8", signal })).trim() }
            files.set(file, cached)
          }
          if (!cached.content) continue
          return cached.content.replaceAll("{{CURRENT_DATE}}", new Date().toISOString().slice(0, 10))
        } catch (error) {
          files.delete(file)
          if (signal.aborted) return
          if (!["ENOENT", "ENOTDIR"].includes(error.code)) {
            console.warn(`${pluginID}: unable to read ${filename} (${error.code ?? "unknown error"})`)
          }
        }
      }
    }

    /** @param {NonNullable<ReturnType<typeof latestInput>>} input @param {string} sessionID */
    function stateFor(input, sessionID) {
      let state = sessions.get(sessionID)
      if (state?.inputID !== input.id) {
        state = { inputID: input.id, injectUser: !bypassed(input), skipIdle: false, followup: "pending" }
        sessions.set(sessionID, state)
      }
      return state
    }

    /** @param {ReturnType<typeof latestInput>} input */
    function bypassed(input) {
      return input?.type !== "user" || input.metadata?.injectUserBypass === true ||
        input.metadata?.injectContextBypass === true || normalizeMessageText(input.text).startsWith("!")
    }

    await ctx.session.hook("prompt", (event) => {
      // Persist the decision on the admitted message, not on the session:
      // queued prompts and admission retries must not change an active turn.
      if (event.metadata?.injectContextBypass === true) return
      if (removeBypassPrefix(event.prompt)) {
        event.metadata = { ...event.metadata, injectUserBypass: true }
        debugLog("prompt.bypass", { sessionID: event.sessionID })
      }
    })

    await ctx.session.hook("context", async (event) => {
      // Read delivered input, not pending inbox items. This also recovers the
      // correct bypass state after a reload, continuation, or session fork.
      const input = latestInput(await ctx.session.context({ sessionID: event.sessionID }, { signal }))
      if (signal.aborted) return
      // Compaction may remove the originating input from the active window.
      // Keep its already verified decision for this plugin instance's turn.
      const state = input ? stateFor(input, event.sessionID) : sessions.get(event.sessionID)
      if (!state?.injectUser) return
      const instructions = await loadInstructions("inject-user.md")
      if (!instructions || signal.aborted) return
      if (event.system.some((part) => part.type === "text" && part.text === instructions)) return
      event.system.push({ type: "text", text: instructions })
      debugLog("context.injected", { sessionID: event.sessionID, instructionLength: instructions.length })
    })

    await ctx.tool.hook("execute.before", (event) => {
      if (!shellTools.has(event.tool)) return
      const state = sessions.get(event.sessionID)
      if (state) state.skipIdle = true
    })

    /** @param {import("@opencode/client").OpenCodeEvent} event */
    async function handleEvent(event) {
      if (!("sessionID" in event.data)) return
      const sessionID = event.data.sessionID
      if (!sessionID || !sessions.has(sessionID)) return
      if (["session.deleted", "session.archived", "session.moved"].includes(event.type)) {
        sessions.delete(sessionID)
        return
      }
      // The public subscription covers ALL locations on the shared service.
      if (event.location && (event.location.directory !== ctx.location.directory ||
        ("workspaceID" in event.location && event.location.workspaceID !== ctx.location.workspaceID))) return
      if (event.type === "session.shell.started" || event.type === "session.shell.ended") {
        sessions.get(sessionID).skipIdle = true
        return
      }
      if (event.type !== "session.status" || event.data.status?.type !== "idle") return
      const previous = sessions.get(sessionID)
      if (previous.followup !== "pending" || previous.skipIdle || signal.aborted) return
      previous.followup = "sending"
      try {
        const session = await ctx.session.get({ sessionID }, { signal })
        if (session.location.directory !== ctx.location.directory || session.time.archived !== undefined ||
          session.outcome !== "succeeded") {
          previous.followup = "done"
          return
        }
        const messages = await ctx.session.context({ sessionID }, { signal })
        const input = latestInput(messages)
        if (!previous.injectUser || (input && (input.id !== previous.inputID || bypassed(input)))) {
          previous.followup = "done"
          return
        }
        // Shell calls made before a reload are visible in the transcript too.
        const turn = input ? messages.slice(messages.indexOf(input) + 1) : messages
        if (turn.some((message) => message.type === "assistant" &&
          message.content.some((part) => part.type === "tool" && shellTools.has(part.name)))) {
          previous.followup = "done"
          return
        }
        const instructions = await loadInstructions("inject-idle.md")
        if (!instructions || signal.aborted || previous.skipIdle || sessions.get(sessionID) !== previous) {
          previous.followup = "done"
          return
        }
        await ctx.session.synthetic({
          sessionID,
          id: `${previous.inputID}_context_injector_idle`,
          text: instructions,
          description: "Project idle follow-up",
          metadata: { contextInjector: { sourceID: previous.inputID } },
          delivery: "queue",
        }, { signal })
        previous.followup = "done"
        debugLog("idle.injected", { sessionID, instructionLength: instructions.length })
      } catch {
        previous.followup = "pending"
        if (!signal.aborted) console.warn(`${pluginID}: idle follow-up failed; a later idle event may retry`)
      }
    }

    // Do not block the server's plugin activation on a long-lived event stream.
    // Reconnect on stream failure; cancellation also stops the retry timer.
    const subscription = (async () => {
      while (!signal.aborted) {
        try {
          for await (const event of ctx.event.subscribe({ signal })) {
            if (signal.aborted) break
            await handleEvent(event)
          }
        } catch {
          if (!signal.aborted) console.warn(`${pluginID}: event stream disconnected; reconnecting`)
        }
        if (signal.aborted) break
        try {
          await delay(1000, undefined, { signal })
        } catch {
          break
        }
      }
    })()

    debugLog("loaded")
    return async () => {
      controller.abort()
      await subscription
      sessions.clear()
      files.clear()
    }
  },
}

export default OpenCodeContextInjector
