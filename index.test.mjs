// Tests for tool-guard. Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import plugin, { PATTERNS, findMatch } from './index.js'

// The plugin registers one hook, so drive it through a fake ctx. That is what
// OpenCode does.
async function harness(options) {
  let evaluate
  const ctx = {
    options,
    permission: {
      hook: async (name, cb) => {
        if (name === 'evaluate') evaluate = cb
        return { dispose: async () => {} }
      },
    },
  }
  await plugin.setup(ctx)
  assert.equal(typeof evaluate, 'function', 'evaluate must be registered')

  // Returns the event after the hook ran, so a test can read the mutation.
  const run = async (event) => {
    await evaluate(event)
    return event
  }
  return { run }
}

const shell = (command, effect = 'allow') => ({
  sessionID: 'ses_1',
  agent: 'build',
  action: 'shell',
  resources: [command],
  metadata: {},
  source: 'config',
  effect,
  message: undefined,
})

test('exports a short pattern list', () => {
  assert.equal(PATTERNS.length, 4)
  assert.deepEqual(
    PATTERNS.map((p) => p.name),
    ['rm -rf', 'git push --force', 'DROP TABLE', 'chmod 777'],
  )
})

test('rm -rf becomes ask in enforce mode', async () => {
  const h = await harness({ mode: 'enforce' })
  const event = await h.run(shell('rm -rf /'))
  assert.equal(event.effect, 'ask')
  assert.match(event.message, /rm -rf/)
})

test('every rm flag form is caught', () => {
  const forms = [
    'rm -rf /',
    'rm -fr /tmp/x',
    'rm -r -f /tmp/x',
    'rm -f -r /tmp/x',
    'rm --recursive --force /tmp/x',
    'rm --force --recursive /tmp/x',
    'sudo rm -rf /',
    'sh -c "rm -rf /tmp/x"',
    'bash -lc "sudo rm -fr ~/data"',
  ]
  for (const cmd of forms) assert.equal(findMatch([cmd]), 'rm -rf', cmd)
})

test('a plain rm does not match', () => {
  for (const cmd of ['rm file.txt', 'rm -f file.txt', 'rm -r dir']) {
    assert.equal(findMatch([cmd]), null, cmd)
  }
})

test('git push --force is caught, --force-with-lease is not', () => {
  assert.equal(findMatch(['git push --force origin main']), 'git push --force')
  assert.equal(findMatch(['git push -f origin main']), 'git push --force')
  assert.equal(findMatch(['git push origin main --force']), 'git push --force')
  assert.equal(findMatch(['git push --force-with-lease origin main']), null)
  assert.equal(findMatch(['git push origin main']), null)
})

test('DROP TABLE and chmod 777 are caught', () => {
  assert.equal(findMatch(['psql -c "drop table users"']), 'DROP TABLE')
  assert.equal(findMatch(['psql -c "DROP TABLE IF EXISTS users"']), 'DROP TABLE')
  assert.equal(findMatch(['chmod 777 run.sh']), 'chmod 777')
  assert.equal(findMatch(['chmod -R 777 /var/www']), 'chmod 777')
  assert.equal(findMatch(['chmod 755 run.sh']), null)
})

test('a normal command is untouched in enforce mode', async () => {
  const h = await harness({ mode: 'enforce' })
  const commands = [
    'ls -la',
    'rm notes.txt',
    'git push origin main',
    'git push --force-with-lease',
  ]
  for (const cmd of commands) {
    const event = await h.run(shell(cmd))
    assert.equal(event.effect, 'allow', cmd)
    assert.equal(event.message, undefined, cmd)
  }
})

test('warn mode is the default and changes nothing', async () => {
  const h = await harness(undefined)
  const warned = []
  const original = console.warn
  console.warn = (msg) => warned.push(msg)
  try {
    const event = await h.run(shell('rm -rf /'))
    assert.equal(event.effect, 'allow')
    assert.equal(event.message, undefined)
    assert.equal(warned.length, 1)
    assert.match(warned[0], /rm -rf/)
  } finally {
    console.warn = original
  }
})

test('warn mode stays quiet when nothing matches', async () => {
  const h = await harness({ mode: 'warn' })
  const warned = []
  const original = console.warn
  console.warn = (msg) => warned.push(msg)
  try {
    await h.run(shell('ls -la'))
    assert.equal(warned.length, 0)
  } finally {
    console.warn = original
  }
})

test('an existing deny is never changed', async () => {
  const h = await harness({ mode: 'enforce' })
  const event = await h.run(shell('rm -rf /', 'deny'))
  assert.equal(event.effect, 'deny')
  assert.equal(event.message, undefined)
})

test('an existing ask keeps its own message', async () => {
  const h = await harness({ mode: 'enforce' })
  const event = await h.run({ ...shell('rm -rf /', 'ask'), message: 'from config' })
  assert.equal(event.effect, 'ask')
  assert.equal(event.message, 'from config')
})

test('a non-shell action is untouched', async () => {
  const h = await harness({ mode: 'enforce' })
  const event = await h.run({
    ...shell('rm -rf /'),
    action: 'read',
  })
  assert.equal(event.effect, 'allow')
  assert.equal(event.message, undefined)
})

test('a broken event does not throw', async () => {
  const h = await harness({ mode: 'enforce' })
  const cases = [
    { action: 'shell' },
    { action: 'shell', resources: null, effect: 'allow' },
    { action: 'shell', resources: [42, null, {}], effect: 'allow' },
    { action: 'shell', resources: 'rm -rf /', effect: 'allow' },
    {},
  ]
  for (const event of cases) {
    const before = JSON.stringify(event)
    await h.run(event)
    assert.equal(JSON.stringify(event), before)
  }
  await h.run(undefined)
  await h.run(null)
})
