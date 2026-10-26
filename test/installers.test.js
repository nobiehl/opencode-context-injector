import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { once } from "node:events"
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { setTimeout as delay } from "node:timers/promises"

const repo = fileURLToPath(new URL("..", import.meta.url))

async function sandbox(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-context-install-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const config = path.join(root, "config")
  const project = path.join(root, "project with spaces")
  await mkdir(project)
  return { root, config, project }
}

for (const kind of ["powershell", "bash"]) {
  test(`${kind} installer creates files and preserves customizations on reinstall`, async (t) => {
    let executable = kind === "powershell" ? "pwsh" : "bash"
    if (kind === "bash" && process.platform === "win32") {
      const git = spawnSync("where.exe", ["git"], { encoding: "utf8" }).stdout?.trim().split(/\r?\n/)[0]
      if (git) executable = path.resolve(path.dirname(git), "..", "bin", "bash.exe")
    }
    const available = spawnSync(executable, [kind === "powershell" ? "-Version" : "--version"], { encoding: "utf8" })
    if (available.error || available.status !== 0) return t.skip(`${executable} is not available`)
    const { root, config, project } = await sandbox(t)
    const args = kind === "powershell"
      ? ["-NoProfile", "-File", path.join(repo, "install.ps1"), "-ProjectPath", project]
      : [path.join(repo, "install.sh"), project]
    const run = (overrides = {}) => spawnSync(executable, args, {
      cwd: repo, encoding: "utf8", timeout: 30000,
      env: { ...process.env, OPENCODE_CONFIG_DIR: config, OPENCODE_PLUGIN_DIR: path.join(config, "plugins"), ...overrides },
    })
    const first = run()
    assert.equal(first.status, 0, first.stderr || first.stdout)
    const installed = path.join(config, "plugins", "opencode-context-injector.js")
    assert.equal(await readFile(installed, "utf8"), await readFile(path.join(repo, "index.js"), "utf8"))
    const user = path.join(project, ".opencode", "inject-user.md")
    const idle = path.join(project, ".opencode", "inject-idle.md")
    const command = path.join(config, "commands", "setup-inject-context.md")
    for (const file of [user, idle, command]) {
      await access(file)
      await writeFile(file, "Custom content\r\n", "utf8")
    }
    await writeFile(path.join(config, "plugins", "inject-user.js"), "// legacy")
    const second = run()
    assert.equal(second.status, 0, second.stderr || second.stdout)
    assert.match(second.stdout + second.stderr, /inject-user\.js/)
    for (const file of [user, idle, command]) assert.equal(await readFile(file, "utf8"), "Custom content\r\n")
    const xdg = path.join(root, "xdg")
    const third = run({ OPENCODE_CONFIG_DIR: "", OPENCODE_PLUGIN_DIR: "", XDG_CONFIG_HOME: xdg })
    assert.equal(third.status, 0, third.stderr || third.stdout)
    await access(path.join(xdg, "opencode", "plugins", "opencode-context-injector.js"))
  })
}

test("OpenCode V2 activates the installed single-file plugin in an isolated private server", {
  skip: process.env.OPENCODE_SMOKE !== "1",
}, async (t) => {
  const { root, config } = await sandbox(t)
  await mkdir(path.join(config, "plugins"), { recursive: true })
  await writeFile(path.join(config, "plugins", "opencode-context-injector.js"),
    await readFile(path.join(repo, "index.js")))
  // Keep one private server alive: a cold location activates its plugins
  // asynchronously, so a one-shot plugin.list request can return an empty list.
  const password = randomBytes(24).toString("hex")
  const server = spawn("opencode", ["serve", "--stdio", "--hostname", "127.0.0.1", "--port", "0"], {
    cwd: root,
    env: {
      ...process.env,
      OPENCODE_CONFIG: "", OPENCODE_CONFIG_CONTENT: "", OPENCODE_CONFIG_DIR: config,
      OPENCODE_CONTEXT_INJECTOR_DEBUG: "0",
      OPENCODE_PASSWORD: password,
      OPENCODE_DISABLE_MODELS_FETCH: "1",
      OPENCODE_DB: path.join(root, "opencode.db"),
      XDG_CONFIG_HOME: path.join(root, "xdg-config"), XDG_DATA_HOME: path.join(root, "data"),
      XDG_CACHE_HOME: path.join(root, "cache"), XDG_STATE_HOME: path.join(root, "state"),
    },
  })
  server.stderr.resume()
  const exited = once(server, "exit")
  try {
    const url = await new Promise((resolve, reject) => {
      let output = ""
      const timer = setTimeout(() => reject(new Error("Private OpenCode server did not start")), 15000)
      server.once("error", (error) => { clearTimeout(timer); reject(error) })
      server.once("exit", () => reject(new Error("Private OpenCode server exited before startup")))
      server.stdout.on("data", (chunk) => {
        output += chunk.toString()
        for (const line of output.split(/\r?\n/).slice(0, -1)) {
          if (!line.startsWith('{"url":')) continue
          clearTimeout(timer)
          resolve(JSON.parse(line).url)
          return
        }
      })
      exited.then(() => clearTimeout(timer), () => clearTimeout(timer))
    })
    const headers = {
      Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
      "x-opencode-directory": encodeURIComponent(root),
    }
    let plugins = []
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await fetch(new URL("/api/plugin", url), { headers, signal: AbortSignal.timeout(10000) })
      assert.equal(response.status, 200)
      plugins = (await response.json()).data
      if (plugins.some((entry) => entry.id === "opencode-context-injector" || entry.state.status === "failed")) break
      await delay(100)
    }
    const matches = plugins.filter((entry) => entry.id === "opencode-context-injector")
    assert.equal(matches.length, 1, JSON.stringify(plugins))
    assert.equal(matches[0].state.status, "active", JSON.stringify(matches[0].state))
  } finally {
    server.stdin.end()
    const timer = setTimeout(() => server.kill(), 5000)
    await exited
    clearTimeout(timer)
  }
})
