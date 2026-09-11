import path from "node:path"
import { readFile } from "node:fs/promises"

const maxInstructionsLength = 4000
const bypassPrefix = "?"

function expandInstructions(content) {
  return content.replaceAll("{{CURRENT_DATE}}", new Date().toISOString().slice(0, 10))
}

async function loadInstructions(filename, roots) {
  for (const root of roots) {
    try {
      const instructionsFile = path.join(root, ".opencode", filename)
      const content = expandInstructions((await readFile(instructionsFile, "utf8")).trim())
      if (!content || content.length > maxInstructionsLength) continue
      return content
    } catch {}
  }
}

export const OpenCodeContextInjector = async ({ client, worktree, directory }) => {
  const roots = [...new Set([worktree, directory].filter((root) => typeof root === "string" && root))]
  const sessionState = new Map()
  const bypassSessions = new Set()

  return {
    "chat.message": async (input, output) => {
      const parts = output?.parts
      if (!Array.isArray(parts)) return

      const part = parts.find((candidate) =>
        candidate?.type === "text" && !candidate.synthetic && typeof candidate.text === "string",
      )
      if (!part) return

      const trimmedText = part.text.trimStart()
      if (trimmedText === bypassPrefix || trimmedText.startsWith(`${bypassPrefix} `)) {
        part.text = trimmedText.slice(bypassPrefix.length).trimStart()
        part.metadata = { ...(part.metadata ?? {}), injectUserBypass: true }
        bypassSessions.add(input.sessionID)
        return
      }

      bypassSessions.delete(input.sessionID)
      const instructions = await loadInstructions("inject-user.md", roots)
      if (!instructions) return

      const suffix = `\n\n${instructions}`
      if (part.text.endsWith(suffix)) return
      part.text += suffix
    },

    event: async ({ event }) => {
      if (event.type !== "session.status" || event.properties?.status?.type !== "idle") return

      const sessionID = event.properties?.sessionID
      if (!sessionID) return

      const state = sessionState.get(sessionID)
      if (state === "loading" || state === "prompting") return
      if (state === "skip") {
        sessionState.delete(sessionID)
        return
      }

      if (bypassSessions.delete(sessionID)) return

      sessionState.set(sessionID, "loading")
      try {
        const instructions = await loadInstructions("inject-idle.md", roots)
        if (!instructions) {
          sessionState.delete(sessionID)
          return
        }

        sessionState.set(sessionID, "prompting")
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
