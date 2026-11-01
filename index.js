// tool-guard — OpenCode v2 plugin.
//
// Escalate a dangerous shell command from "allow" to "ask". The permission
// hook runs after the effect is resolved, so it can only add friction, never
// remove it. A configured deny never reaches the hook as allow.
//
// Modes:
//   warn    (default) log the match, change nothing
//   enforce set effect to "ask" and name the pattern in message

// Case-insensitive patterns. Each one is tested against every string in
// `resources` when the action is "shell".
//
// The rm rule needs both a recursive flag and a force flag, in any order and
// in short or long form, optionally after sudo or inside sh -c. A plain
// `rm file.txt` must not match.
const RM_RECURSIVE = String.raw`(?:-[a-zA-Z]*r[a-zA-Z]*|--recursive)`
const RM_FORCE = String.raw`(?:-[a-zA-Z]*f[a-zA-Z]*|--force)`

export const PATTERNS = [
  {
    name: 'rm -rf',
    // Both flags must appear as separate words, in either order. A short flag
    // may bundle them (`-rf`, `-fr`), which the word boundary still catches.
    test: (cmd) => {
      if (!/\brm\b/i.test(cmd)) return false
      const words = cmd.split(/\s+/)
      const has = (re) => words.some((w) => re.test(w))
      const recursive = has(new RegExp(`^${RM_RECURSIVE}$`, 'i'))
      const force = has(new RegExp(`^${RM_FORCE}$`, 'i'))
      return recursive && force
    },
  },
  {
    name: 'git push --force',
    // --force-with-lease is the safe form and must not match.
    test: (cmd) =>
      /\bgit\s+push\b/i.test(cmd) &&
      cmd.split(/\s+/).some((w) => /^(?:--force|-f)$/i.test(w)),
  },
  {
    name: 'DROP TABLE',
    test: (cmd) => /\bdrop\s+table\b/i.test(cmd),
  },
  {
    name: 'chmod 777',
    test: (cmd) => /\bchmod\b(?:\s+-[a-zA-Z]+)*\s+0?777\b/i.test(cmd),
  },
]

export function findMatch(resources) {
  if (!Array.isArray(resources)) return null
  for (const resource of resources) {
    if (typeof resource !== 'string') continue
    for (const pattern of PATTERNS) {
      if (pattern.test(resource)) return pattern.name
    }
  }
  return null
}

export default {
  id: 'vasilvestre.opencode-tool-guard',
  async setup(ctx) {
    const mode = ctx?.options?.mode === 'enforce' ? 'enforce' : 'warn'

    await ctx.permission.hook('evaluate', (event) => {
      // A throwing permission hook breaks every tool call. Never let it out.
      try {
        if (!event || event.action !== 'shell') return
        const name = findMatch(event.resources)
        if (!name) return

        if (mode === 'warn') {
          console.warn(`tool-guard: "${name}" matched in warn mode, not escalated`)
          return
        }
        if (event.effect !== 'allow') return
        event.effect = 'ask'
        event.message = `tool-guard: "${name}" needs your approval`
      } catch {
        // Swallowed on purpose: see the comment above.
      }
    })
  },
}
