import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelCompleteInput, ModelForkResult, On, SessionMessage, SessionUsage } from 'claude-code'

import {
  CHAT_SYSTEM_FILE,
  SEED_SYSTEM,
  STALE_AFTER_MS,
  STORE_SOFT_LIMIT_BYTES,
  SYNTHESIS_SYSTEM,
  TRANSCRIPT_SYSTEM_FILE,
  modelStops,
  sessionsToDrop,
  stepModel,
} from '../hooks/log'
import type { SessionRecord } from '../hooks/log'
import type { Overview } from '../types'

const PLUGIN = 'session-overview'
const NOW = Date.UTC(2026, 9, 19, 12)
const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const OVERVIEW_REPLY = JSON.stringify({
  goal: 'Build the overview mod',
  status: 'on-track',
  statusReason: 'Every note advances the mod.',
  done: ['Wrote the manifest'],
  inProgress: [],
  next: ['Preview the displays'],
  decisions: ['Haiku writes the notes'],
  openQuestions: [],
})
const SEED_REPLY = JSON.stringify({
  entries: [
    { summary: 'Agreed on the displays.', decisions: [], questions: [] },
    { summary: 'Wrote the hooks module.', decisions: [], questions: [] },
  ],
})

const MESSAGES: SessionMessage[] = [
  { role: 'user', text: 'Build a session overview mod', toolUses: [] },
  { role: 'assistant', text: 'Asked about displays.', toolUses: [] },
  { role: 'user', text: 'Write the hooks module', toolUses: [] },
  {
    role: 'assistant',
    text: 'Writing it.',
    toolUses: [{ tool_use_id: 't1', tool: 'Write', input: { file_path: 'hooks/register.tsx' }, text: 'File created' }],
  },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: 'File created', isError: false }] },
  { role: 'assistant', text: 'Done.', toolUses: [] },
]

const RECORD: SessionRecord = {
  originalGoal: 'Build a session overview mod',
  entries: [{ at: NOW - 60_000, summary: 'Agreed on the displays.', decisions: [], questions: [] }],
  overview: null,
  updatedAt: NOW - 60_000,
  seededAt: NOW - 120_000,
}

const TURN = { answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 'turn-1', reason: 'answer' } as const

type Kind = 'seed' | 'synthesis' | 'answer' | 'transcript' | 'entry'

const ANSWER_REPLY = 'About 2 more turns (an estimate).'
const CHAT_PROMPT = 'The chat system prompt from prompts/chat-system.md.'
const PREAMBLE = 'The main-model preamble from prompts/main-model-preamble.md.'
const TRANSCRIPT_PROMPT = 'The transcript system prompt from prompts/transcript-system.md.'
const MINUTE = 60_000
const HOUR = 60 * MINUTE

// A subscription reports its rate-limit windows, so the cache is taken to last an hour.
const SUBSCRIPTION_USAGE: SessionUsage = {
  startedAt: NOW - HOUR,
  context: { tokens: 220_000, window: 1_000_000, percent: 22 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 40 }],
}

function kindOf(call: ModelCompleteInput): Kind {
  if (call.system?.includes(SEED_SYSTEM)) return 'seed'
  if (call.system?.includes(SYNTHESIS_SYSTEM)) return 'synthesis'
  if (call.system?.includes(CHAT_PROMPT)) return 'answer'
  if (call.system?.includes(TRANSCRIPT_PROMPT)) return 'transcript'

  return 'entry'
}

function replyFor(kind: Kind, callCount: number): string {
  if (kind === 'seed') return SEED_REPLY
  if (kind === 'synthesis') return OVERVIEW_REPLY
  if (kind === 'answer') return ANSWER_REPLY
  if (kind === 'transcript') return 'The transcript model answers.'

  return JSON.stringify({ summary: `Note ${callCount}.` })
}

/**
 * The engine beneath the plugin: one session with MESSAGES, a log model that
 * always answers, and the mod's prompt files, of which `missing` cannot be read.
 */
function session(on: On, store: Record<string, unknown>, missing?: string) {
  const calls: ModelCompleteInput[] = []
  const clock = mock.clock(on, { now: NOW })
  // The plugin's store, kept here rather than in mock.store so a test can read it back.
  const memory = new Map(Object.entries(store))
  on('store.get', ($, e) => ({ value: memory.get(e.key) }))
  on('store.set', ($, e) => {
    memory.set(e.key, JSON.parse(JSON.stringify(e.value)))

    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    memory.delete(e.key)

    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...memory.keys()] }))
  on('fs.read', ($, e) => {
    if (missing && e.path.endsWith(missing)) return { deny: `ENOENT: ${missing}` }

    if (e.path.endsWith(CHAT_SYSTEM_FILE)) return { value: CHAT_PROMPT }
    if (e.path.endsWith(TRANSCRIPT_SYSTEM_FILE)) return { value: TRANSCRIPT_PROMPT }

    return { value: PREAMBLE }
  })
  on('session.id', () => ({ value: 's1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: SUBSCRIPTION_USAGE }))
  on('session.messages', () => ({ value: MESSAGES }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('model.complete', ($, e) => {
    calls.push(e)

    return { value: { isAnswered: true as const, text: replyFor(kindOf(e), calls.length), usage: USAGE } }
  })

  return { calls, clock, memory }
}

function openPane($: Engine) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'Pane',
    requestId: 'session-overview',
    props: {
      title: 'Session overview',
      isFocused: true,
      bodyColumns: 60,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  })
}

test('logs a finished turn, then rebuilds the overview from every note', async ($, on) => {
  const { calls, clock } = session(on, { 'session:s1': RECORD })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()

  await $.turn.complete(TURN)
  await clock.settle()

  expect(calls.map(kindOf)).toEqual(['entry', 'synthesis'])
  expect(calls[0]?.prompt).toContain('USER: Write the hooks module')
  expect(calls[0]?.prompt).not.toContain('USER: Build a session overview mod')
  expect(calls[1]?.prompt).toContain('Agreed on the displays.')
  expect(calls[1]?.prompt).toContain('(turn took 1s) Note 1.')

  const pane = await openPane($)
  expect((await pane.find({ key: 'overview' }))?.text).toContain('**Goal:** Build the overview mod')
  expect((await pane.find({ type: 'Text', text: /^Latest notes/ }))?.text).toContain('(2 of 2)')
  expect(await pane.find({ type: 'Text', text: /failed|…/ })).toBeUndefined()
  await pane.unmount()

  // The second turn's note sees the first one, so the record reached the store.
  await $.turn.complete({ ...TURN, turnId: 'turn-2' })
  await clock.settle()
  expect(calls[2]?.prompt).toContain('Note 1.')
})

test('seeds a session that has history but no log yet', async ($, on) => {
  const { calls, clock } = session(on, {})
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()

  expect(calls.map(kindOf)).toEqual(['seed', 'synthesis'])
  expect(calls[0]?.prompt).toContain('Build a session overview mod')

  const pane = await openPane($)
  expect((await pane.find({ key: 'overview' }))?.text).toContain('**Status:** On track')
  expect((await pane.find({ type: 'Text', text: /^Latest notes/ }))?.text).toContain('(2 of 2)')
  await pane.unmount()
})

test('does not log a session without anyone at the prompt', async ($, on) => {
  const { calls, clock } = session(on, { 'session:s1': RECORD })
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await $.turn.complete(TURN)
  await clock.settle()

  expect(calls).toEqual([])
})

test('the band opens the pane only when pressed, then offers to close it', async ($, on) => {
  const opened: string[] = []
  const closed: string[] = []
  on('ui.open', ($, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true as const } }
  })
  on('ui.close', ($, e) => {
    closed.push(e.id)

    return { value: undefined }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 10,
        bodyColumns: 100,
        scroll: { offset: 0, bodyRows: 9 },
        view: {},
      },
    })
    const openedBefore = opened.length
    expect((await band.find({ type: 'Text', text: /no overview yet/ }))?.type).toBe('Text')
    expect((await band.find({ key: 'overview' }))?.text).toBe('Open overview')
    expect(opened).toHaveLength(openedBefore)

    await band.press({ key: 'overview' })
    expect(opened).toHaveLength(openedBefore + 1)
    expect(opened.at(-1)).toBe('session-overview')
    expect((await band.find({ key: 'overview' }))?.text).toBe('Close overview')

    await band.press({ key: 'overview' })
    expect(closed.at(-1)).toBe('session-overview')
    expect((await band.find({ key: 'overview' }))?.text).toBe('Open overview')
    await band.unmount()
  }
})

test('the question dialog shows status, now and next within its rows, and opens the pane on a press', async ($, on) => {
  const long = ' and more'.repeat(40)
  const overview: Overview = {
    at: NOW,
    goal: `Build the overview mod${long}`,
    status: 'on-track',
    statusReason: '',
    done: [],
    inProgress: [`Live testing${long}`],
    next: [`Check the dialog${long}`],
    decisions: [],
    openQuestions: [],
  }
  const { clock } = session(on, { 'session:s1': { ...RECORD, overview } })
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true as const } }
  })
  on('ui.close', () => ({ value: undefined }))
  // The dialog itself, as core draws it from the original props.
  on('ui.render', { component: 'AskUserQuestion' }, () => ({ type: 'engine' as const, ref: 0 }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const dialog = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'AskUserQuestion',
      props: { tool: 'AskUserQuestion', questions: [] },
    })
    expect((await dialog.find({ type: 'Text', text: /^✦ On track · Build the overview mod/ }))?.text.length).toBe(78)
    expect(await dialog.find({ type: 'Text', text: /^ {2}Now: {2}Live testing/ })).toBeDefined()
    expect(await dialog.find({ type: 'Text', text: /^ {2}Next: Check the dialog/ })).toBeDefined()

    expect((await dialog.find({ key: 'overview' }))?.text).toBe('Open overview')
    await dialog.press({ key: 'overview' })
    expect(opened.at(-1)).toBe('session-overview')
    expect((await dialog.find({ key: 'overview' }))?.text).toBe('Close overview')
    await dialog.press({ key: 'overview' })
    await dialog.unmount()
  }
})

/** The main model behind `$.model.fork`, answering `reply`; returns the prompts it was asked. */
function forkedModel(on: On, reply: ModelForkResult = { isAnswered: true, text: 'The main model answers.', usage: USAGE }) {
  const forks: string[] = []
  on('model.fork', ($, e) => {
    forks.push(e.prompt)

    return { value: reply }
  })

  return forks
}

test('a question in the pane goes to the chat model, and on request to the main model or the transcript model', async ($, on) => {
  const timed = { ...RECORD, entries: RECORD.entries.map(entry => ({ ...entry, durationMs: 125_000 })) }
  const { calls, clock } = session(on, { 'session:s1': timed })
  const forks = forkedModel(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()

  const pane = await openPane($)
  expect(await pane.find({ key: 'ask-context' })).toBeUndefined()

  expect((await pane.find({ type: 'Text', text: /^── Ask about this session ─+$/ }))?.text).toHaveLength(60)

  await pane.input({ key: 'ask', text: 'How long will it still run?' })
  // The overview is rebuilt first, so the answer reads the newest one.
  expect(calls.map(kindOf)).toEqual(['synthesis', 'answer'])
  expect(calls[1]?.model).toBe('claude-haiku-5-5')
  expect(calls[1]?.prompt).toContain('**Goal:** Build the overview mod')
  expect(calls[1]?.prompt).toContain('(turn took 2m 5s) Agreed on the displays.')
  expect(calls[1]?.prompt).toContain('Question:\nHow long will it still run?')
  expect((await pane.find({ key: 'answer' }))?.text).toBe(ANSWER_REPLY)
  // The main model is shown beside its button, as it cannot be picked.
  expect(await pane.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()

  await pane.press({ key: 'ask-context' })
  expect(forks).toEqual([`${PREAMBLE}\n\nQuestion: How long will it still run?`])
  expect((await pane.find({ key: 'answer' }))?.text).toBe('The main model answers.')

  await pane.press({ key: 'ask-transcript' })
  expect(calls.map(kindOf)).toEqual(['synthesis', 'answer', 'transcript'])
  expect(calls[2]?.model).toBe('claude-opus-5-5')
  expect(calls[2]?.prompt).toContain('Original goal:\nBuild a session overview mod')
  expect(calls[2]?.prompt).toContain('USER: Write the hooks module')
  expect(calls[2]?.prompt).toContain('Question:\nHow long will it still run?')
  expect((await pane.find({ key: 'answer' }))?.text).toBe('The transcript model answers.')

  await pane.press({ key: 'clear' })
  expect(await pane.find({ key: 'answer' })).toBeUndefined()
  expect(await pane.find({ key: 'clear' })).toBeUndefined()
  await pane.unmount()
})

test('the pane picks the chat and transcript models for the session, starting from /config', async ($, on) => {
  const { calls, clock } = session(on, { 'session:s1': RECORD })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()

  const pane = await openPane($)
  expect(await pane.find({ type: 'Text', text: 'Haiku 5.5' })).toBeDefined()
  await pane.press({ key: 'chat-model-next' })
  expect(await pane.find({ type: 'Text', text: 'Sonnet 5.5' })).toBeDefined()

  await pane.input({ key: 'ask', text: 'Where are we?' })
  expect(calls.at(-1)?.model).toBe('claude-sonnet-5-5')

  await pane.press({ key: 'transcript-model-prev' })
  await pane.press({ key: 'ask-transcript' })
  expect(kindOf(calls.at(-1)!)).toBe('transcript')
  expect(calls.at(-1)?.model).toBe('claude-sonnet-5-5')
  await pane.unmount()

  // The picks hold for the session, across closing and opening the pane.
  const reopened = await openPane($)
  expect(await reopened.find({ type: 'Text', text: 'Sonnet 5.5' })).toBeDefined()
  await reopened.unmount()
})

test(
  'the /config rows set the log model and the pickers\' starting models',
  { options: { logModel: 'Sonnet 4.6', chatModel: 'Opus 4.8', transcriptModel: 'Haiku 4.5' } },
  async ($, on) => {
    const { calls, clock } = session(on, { 'session:s1': RECORD })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await clock.settle()
    await $.turn.complete(TURN)
    await clock.settle()

    expect(calls.map(call => call.model)).toEqual(['claude-sonnet-4-6', 'claude-sonnet-4-6'])

    const pane = await openPane($)
    await pane.input({ key: 'ask', text: 'Where are we?' })
    expect(calls.at(-1)?.model).toBe('claude-opus-4-8')
    await pane.press({ key: 'ask-transcript' })
    expect(calls.at(-1)?.model).toBe('claude-haiku-4-5-20251001')
    await pane.unmount()
  },
)

test('asking from context after the cache likely expired shows the hint first, with both ways on', async ($, on) => {
  const { calls, clock } = session(on, { 'session:s1': RECORD })
  const forks = forkedModel(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()
  await $.turn.complete(TURN)
  await clock.settle()

  const pane = await openPane($)
  await pane.input({ key: 'ask', text: 'Where are we?' })

  // Within the hour, the cache is taken to be warm: no hint.
  await clock.advance(30 * MINUTE)
  await pane.press({ key: 'ask-context' })
  expect(forks).toHaveLength(1)

  await clock.advance(HOUR + 12 * MINUTE)
  await pane.press({ key: 'ask-context' })
  expect(forks).toHaveLength(1)
  expect((await pane.find({ type: 'Text', text: /cache has likely expired/ }))?.text).toContain('nothing sent for 1h 12m')
  expect((await pane.find({ key: 'ask-context' }))?.text).toBe('Full context, full price (~220k tokens)')
  expect((await pane.find({ key: 'ask-transcript' }))?.text).toBe('From transcript (trimmed, cheaper)')

  await pane.press({ key: 'ask-context' })
  expect(forks).toHaveLength(2)
  expect(await pane.find({ type: 'Text', text: /cache has likely expired/ })).toBeUndefined()

  // The fork just read the cache, so it is warm again.
  await clock.advance(10 * MINUTE)
  await pane.press({ key: 'ask-context' })
  expect(forks).toHaveLength(3)
  expect(calls.filter(call => kindOf(call) === 'transcript')).toHaveLength(0)
  await pane.unmount()
})

test('asking from context before a resumed session finished a turn says so', async ($, on) => {
  const { clock } = session(on, { 'session:s1': RECORD })
  forkedModel(on, { isAnswered: false, reason: 'nothing-to-fork' })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()

  const pane = await openPane($)
  await pane.input({ key: 'ask', text: 'Where are we?' })
  await pane.press({ key: 'ask-context' })

  expect((await pane.find({ type: 'Text', text: /no full context/ }))?.text).toContain('needs one finished turn first')
  expect(await pane.find({ key: 'ask-transcript' })).toBeDefined()
  await pane.unmount()
})

test('a prompt file that cannot be read is shown as the answer\'s error', async ($, on) => {
  const { calls, clock } = session(on, { 'session:s1': RECORD }, CHAT_SYSTEM_FILE)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()

  const pane = await openPane($)
  await pane.input({ key: 'ask', text: 'Where are we?' })

  expect(calls.map(kindOf)).toEqual(['synthesis'])
  expect((await pane.find({ type: 'Text', text: /could not be read/ }))?.text).toContain('prompts/chat-system.md')
  await pane.unmount()
})

test('the pane puts the overview in the prompt box, after a draft', async ($, on) => {
  const { clock } = session(on, {})
  const filled: string[] = []
  on('prompt.read', () => ({ value: { text: 'my draft', cursor: 8 } }))
  on('prompt.fill', ($, e) => {
    filled.push(e.text)

    return { isFilled: true }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()

  const pane = await openPane($)
  await pane.press({ key: 'fill' })

  expect(filled).toHaveLength(1)
  expect(filled[0]).toMatch(/^\n\nHere is the session overview/)
  expect(filled[0]).toContain('> **Goal:** Build the overview mod')
  await pane.unmount()
})

test("a save cleans up through each session's own meta key, and removes the unused index key", async ($, on) => {
  const stale = NOW - STALE_AFTER_MS - 1
  const { clock, memory } = session(on, {
    'session:s1': RECORD,
    'meta:s1': { updatedAt: RECORD.updatedAt, bytes: 100 },
    'session:stale': { ...RECORD, updatedAt: stale },
    'meta:stale': { updatedAt: stale, bytes: 100 },
    // Notes saved without their meta key are measured from the notes themselves.
    'session:no-meta': { ...RECORD, updatedAt: stale },
    index: { s1: { updatedAt: 0, bytes: 0 } },
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()

  await $.turn.complete(TURN)
  await clock.settle()

  expect([...memory.keys()].sort()).toEqual(['meta:s1', 'session:s1'])
  expect(memory.get('meta:s1')).toEqual(expect.objectContaining({ updatedAt: NOW }))
})

test('the pickers step through Haiku, Sonnet and Opus 5.5, and a /config default outside them', () => {
  expect(stepModel(modelStops('Haiku 5.5'), 'Opus 5.5', 1)).toBe('Haiku 5.5')
  expect(stepModel(modelStops('Haiku 5.5'), 'Haiku 5.5', -1)).toBe('Opus 5.5')
  expect(modelStops('Opus 4.8')).toEqual(['Haiku 5.5', 'Sonnet 5.5', 'Opus 5.5', 'Opus 4.8'])
  expect(stepModel(modelStops('Opus 4.8'), 'Opus 4.8', 1)).toBe('Haiku 5.5')
})

test('cleanup drops stale sessions, then the least recently updated, never the current one', () => {
  const third = STORE_SOFT_LIMIT_BYTES / 3
  const index = {
    stale: { updatedAt: NOW - STALE_AFTER_MS - 1, bytes: 10 },
    oldest: { updatedAt: NOW - 3000, bytes: third },
    newer: { updatedAt: NOW - 2000, bytes: third },
    current: { updatedAt: NOW - 1000, bytes: third },
  }

  // current growing to half the limit pushes the total past it; dropping the oldest is enough.
  expect(sessionsToDrop(index, 'current', NOW, STORE_SOFT_LIMIT_BYTES / 2)).toEqual(['stale', 'oldest'])
  expect(sessionsToDrop(index, 'current', NOW, third)).toEqual(['stale'])
  expect(sessionsToDrop({ current: { updatedAt: NOW, bytes: 2 * STORE_SOFT_LIMIT_BYTES } }, 'current', NOW, 0)).toEqual([])
})
