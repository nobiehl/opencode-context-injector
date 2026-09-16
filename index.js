import path from "node:path"
import { readFile } from "node:fs/promises"

const bypassPrefix = "?"

function debugEnabled() {
  return ["1", "true", "yes"].includes((process.env.OPENCODE_CONTEXT_INJECTOR_DEBUG ?? "").toLowerCase())
}

async function debugLog(client, message, extra = {}) {
  if (!debugEnabled() || typeof client?.app?.log !== "function") return
  try {
    await client.app.log({
      body: {
        service: "opencode-context-injector",
        level: "info",
        message,
        extra,
      },
    })
  } catch {}
}

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

function expandInstructions(content) {
  return content.replaceAll("{{CURRENT_DATE}}", new Date().toISOString().slice(0, 10))
}

async function loadInstructions(filename, roots) {
  for (const root of roots) {
    try {
      const instructionsFile = path.join(root, ".opencode", filename)
      const content = expandInstructions((await readFile(instructionsFile, "utf8")).trim())
      if (!content) continue
      return content
    } catch {}
  }
}

export const OpenCodeContextInjector = async ({ client, worktree, directory }) => {
  const roots = [...new Set([worktree, directory].filter((root) => typeof root === "string" && root))]
  const sessionState = new Map()
  const skipIdleSessions = new Set()
  const systemInjectionSessions = new Set()

  return {
    "chat.message": async (input, output) => {
      await debugLog(client, "chat.message", { sessionID: input?.sessionID })
      const parts = output?.parts
      if (!Array.isArray(parts)) return

      const part = parts.find((candidate) =>
        candidate?.type === "text" && !candidate.synthetic && typeof candidate.text === "string",
      )
      if (!part) {
        if (parts.some((candidate) => candidate?.synthetic === true)) {
          systemInjectionSessions.delete(input.sessionID)
        }
        return
      }

      if (part.metadata?.injectContextBypass === true) {
        systemInjectionSessions.delete(input.sessionID)
        skipIdleSessions.add(input.sessionID)
        return
      }

      const trimmedText = normalizeMessageText(part.text)
      if (trimmedText.startsWith("!")) {
        systemInjectionSessions.delete(input.sessionID)
        skipIdleSessions.add(input.sessionID)
        return
      }

      skipIdleSessions.delete(input.sessionID)
      if (trimmedText === bypassPrefix || trimmedText.startsWith(`${bypassPrefix} `)) {
        part.text = trimmedText.slice(bypassPrefix.length).trimStart()
        part.metadata = { ...(part.metadata ?? {}), injectUserBypass: true }
        skipIdleSessions.add(input.sessionID)
        systemInjectionSessions.delete(input.sessionID)
        await debugLog(client, "chat.message.bypass", { sessionID: input?.sessionID })
        return
      }

      systemInjectionSessions.add(input.sessionID)
    },

    "experimental.chat.system.transform": async (input, output) => {
      const sessionID = input?.sessionID
      const marked = Boolean(sessionID && systemInjectionSessions.has(sessionID))
      await debugLog(client, "experimental.chat.system.transform", { sessionID, marked })
      if (!sessionID || !marked) return
      if (!Array.isArray(output?.system)) return

      const instructions = await loadInstructions("inject-user.md", roots)
      if (!instructions || output.system.includes(instructions)) return
      output.system.push(instructions)
      await debugLog(client, "experimental.chat.system.transform.injected", {
        sessionID,
        instructionLength: instructions.length,
        systemEntries: output.system.length,
      })
    },

    "command.execute.before": async (input, output) => {
      systemInjectionSessions.delete(input.sessionID)
      skipIdleSessions.add(input.sessionID)
      if (!Array.isArray(output?.parts)) return

      for (const part of output.parts) {
        if (part?.type !== "text" || typeof part.text !== "string") continue
        part.metadata = { ...(part.metadata ?? {}), injectContextBypass: true }
      }
    },

    "tool.execute.before": async (input) => {
      if (["bash", "shell", "cmd", "powershell"].includes(input.tool)) {
        skipIdleSessions.add(input.sessionID)
      }
    },

    event: async ({ event }) => {
      if (event.type === "session.next.shell.started" || event.type === "session.next.shell.ended") {
        const sessionID = event.properties?.sessionID ?? event.data?.sessionID
        if (sessionID) skipIdleSessions.add(sessionID)
        return
      }

      if (event.type !== "session.status" || event.properties?.status?.type !== "idle") return

      const sessionID = event.properties?.sessionID
      if (!sessionID) return

      const state = sessionState.get(sessionID)
      if (state === "loading" || state === "prompting") return
      if (state === "skip") {
        sessionState.delete(sessionID)
        return
      }

      // A turn can emit more than one idle event (for example, title plus response).
      // Keep the bypass active until the next real user message clears it.
      if (skipIdleSessions.has(sessionID)) return

      sessionState.set(sessionID, "loading")
      try {
        const instructions = await loadInstructions("inject-idle.md", roots)
        if (!instructions) {
          sessionState.delete(sessionID)
          return
        }

        sessionState.set(sessionID, "prompting")
        systemInjectionSessions.delete(sessionID)
        await client.session.prompt({
          path: { id: sessionID },
          body: {
            parts: [{ type: "text", text: instructions, synthetic: true }],
          },
        })
        sessionState.set(sessionID, "skip")
      } catch {
        sessionState.delete(sessionID)
      }
    },
  }
}
