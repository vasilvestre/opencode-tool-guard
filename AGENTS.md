# AGENTS.md — maintainer instructions

Instructions for agents working in this repository.

## What this repo ships

One OpenCode v2 plugin: `@vasilvestre/opencode-tool-guard`.

It registers one permission hook. When a shell command matches a dangerous
pattern and the effect is `allow`, it changes the effect to `ask`. The user
sees the prompt and decides.

The plugin is one file, `index.js`, with no build step and no dependency.

## Layout

| Path | Role |
| --- | --- |
| `index.js` | the plugin, and the only runtime file |
| `index.test.mjs` | tests, `node:test`, no dependency |
| `.github/workflows/ci.yml` | tests on pull request and push |
| `.github/workflows/release.yml` | publishes on version bump |
| `README.md` | public usage, pattern table, modes, known limits |

## The event shape

`ctx.permission.hook('evaluate', handler)` receives a mutable event:

```js
{ sessionID, agent, action, resources, metadata, source, effect, message }
```

- `action` is a permission action string. This plugin only reads `"shell"`.
- `resources` holds the command strings for a `shell` action.
- `effect` is `"allow"`, `"ask"`, or `"deny"`. It is already resolved.
- The handler mutates `effect` and `message`.

## Hard rules

- **Fail silent.** The handler is wrapped in `try` and `catch`, and the catch
  swallows. A throwing permission hook breaks every tool call in the session.
  Never remove the wrapper.
- **Never set `deny`.** The plugin adds friction, it does not block. A plugin
  that denies silently is worse than no plugin.
- **Never touch an `ask` or a `deny`.** Only `allow` is escalated. A `deny` from
  the config or from an agent ruleset short-circuits before the hook, so the
  hook cannot see it. Do not try to work around that.
- **The hook can only escalate.** It runs after the effect is resolved. Turning
  `ask` into `allow` is not possible here, and must not be attempted.
- **The pattern list stays short and tested.** Four patterns. A new pattern
  needs a test that fails without it and passes with it, and a row in the
  README table. A pattern that fires on a normal command is a bug.
- **`warn` is the default.** An unknown or missing mode falls back to `warn`.
  Only the exact string `enforce` escalates.
- **No dependency.** The plugin imports nothing. Adding a package to a small
  plugin is a cost the user pays on every install.

## The patterns

| Name | Rule |
| --- | --- |
| `rm -rf` | `rm` with a recursive flag and a force flag, in any order and in short or long form |
| `git push --force` | `git push` with `--force` or `-f`. `--force-with-lease` is the safe form and must not match |
| `DROP TABLE` | `drop table`, any case, with or without `if exists` |
| `chmod 777` | `chmod` with any flag set and mode `777` or `0777` |

The `rm` rule needs both flags. One alone is not enough.

## Before you commit

```bash
npm test
node --check index.js
```

Every change to `index.js` needs a test. The suite covers each pattern, both
modes, the `deny` and `ask` cases, a non-shell action, and a broken event.

## Release

Published to npm. `.github/workflows/release.yml` publishes on every push to
`main` when the version in `package.json` is not on npm yet.

Bumping the version is the release decision:

```bash
npm version patch   # or minor, or major
git push --follow-tags
```

The workflow stops at "Skip when already published" when the version is
unchanged. It never invents a version. `ci.yml` runs the tests only.

The npm trusted publisher points at `vasilvestre/opencode-tool-guard`,
workflow `release.yml`.

## Commits

Imperative subject, 72 characters or fewer, no trailing period. Say what
changed and why, not how.
