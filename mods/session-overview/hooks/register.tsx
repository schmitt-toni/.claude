import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult, Register, SessionMessage, SessionRateLimit } from 'claude-code'

import type { AnswerSource, ColdCacheHint, ModelPicks, OverviewView, PaneChat, Phase } from '../types'
import {
  CHAT_SYSTEM_FILE,
  ENTRY_SYSTEM,
  MAIN_MODEL_PREAMBLE_FILE,
  MODEL_IDS,
  SEED_SYSTEM,
  STATUS_LABEL,
  SYNTHESIS_SYSTEM,
  TRANSCRIPT_SYSTEM_FILE,
  answerPrompt,
  clip,
  digest,
  entryPrompt,
  firstPrompt,
  forkPrompt,
  formatDuration,
  formatTokens,
  modelName,
  modelStops,
  overviewMarkdown,
  parseJson,
  rule,
  seedPrompt,
  sessionsToDrop,
  stepModel,
  synthesisPrompt,
  toEntry,
  toOverview,
  toSeedEntries,
  transcriptPrompt,
  turnStart,
} from './log'
import type { SessionMeta, SessionRecord, StoreIndex } from './log'

const PANE = 'session-overview'
const PANE_TITLE = 'Session overview'
// The manifest's defaults, by the name /model shows.
const DEFAULT_LOG_MODEL = 'Haiku 5.5'
const DEFAULT_CHAT_MODEL = 'Haiku 5.5'
const DEFAULT_TRANSCRIPT_MODEL = 'Opus 5.5'
const RECENT_NOTES = 6
const TURN_DIGEST_CHARS = 40_000
const SEED_DIGEST_CHARS = 300_000
const TRANSCRIPT_DIGEST_CHARS = 300_000
// How long the prompt cache keeps the session's context after its last request:
// an hour on a subscription, five minutes on an API key or past a usage limit.
const SUBSCRIPTION_CACHE_TTL_MS = 60 * 60 * 1000
const API_CACHE_TTL_MS = 5 * 60 * 1000
const DIALOG_LINE_CHARS = 78
// Wide enough for the longest ask-again label and its hotkey, so the models line up beside them.
const ASK_AGAIN_COLUMNS = 48
// The ✦ and the space after it, so the band's and the dialog's buttons sit under the
// headline's text the way the engine's own notices indent theirs.
const HEADLINE_INDENT_COLUMNS = 2
const RECORD_PREFIX = 'session:'
const UNUSED_INDEX_KEY = 'index'

const EMPTY: OverviewView = { overview: null, recent: [], entryCount: 0, phase: 'idle', error: null }
const view = atom({ plugin: 'session-overview', key: 'view' } as const, EMPTY)
const chat = atom({ plugin: 'session-overview', key: 'chat' } as const, null as PaneChat | null)
const picks = atom({ plugin: 'session-overview', key: 'picks' } as const, { chat: null, transcript: null } as ModelPicks)
const isPaneOpen = atom({ plugin: 'session-overview', key: 'isPaneOpen' } as const, false)

const recordKey = (sessionId: string) => `${RECORD_PREFIX}${sessionId}`
const metaKey = (sessionId: string) => `meta:${sessionId}`

/** A finished turn of the main conversation, captured when it ended. */
type FinishedTurn = {
  messages: readonly SessionMessage[]
  endedAt: number
  /** Wall clock, in milliseconds. */
  durationMs: number
  isAborted: boolean
}

const ASKING_LABEL: Record<AnswerSource, (model: string) => string> = {
  notes: model => `refreshing the overview, then asking ${model}…`,
  context: model => `asking ${model} with the session's full context…`,
  transcript: model => `asking ${model} with a trimmed copy of the conversation…`,
}

const NOTHING_TO_FORK =
  'There is no full context to ask yet: a resumed or cleared session needs one finished turn first. Asking from the transcript works now.'

const PHASE_LABEL: Record<Phase, string> = {
  idle: '',
  seeding: 'reading the history so far…',
  logging: 'writing the note for the last turn…',
  synthesising: 'rebuilding the overview…',
}

// Set from the `userConfig` options each time `register` runs: the log model's id,
// and the /config defaults of the pane's two pickers by name.
let logModel = MODEL_IDS[DEFAULT_LOG_MODEL] ?? DEFAULT_LOG_MODEL
let chatModel = DEFAULT_CHAT_MODEL
let transcriptModel = DEFAULT_TRANSCRIPT_MODEL
// `-p` runs and SDK hosts have nobody to show an overview to, so they are not logged.
let isInteractive = false
// The first prompt of the running turn, to find where the turn starts once it ends.
let turnPrompt: string | undefined
// Model calls run one at a time, so a turn that ends while the previous one is
// still being written waits behind it instead of racing it for the record.
let queue: Promise<void> = Promise.resolve()
// When the main conversation last sent a request, as far as this module saw: a
// finished turn or a fork's answer. Unset until then, as after a resume.
let lastSentAt: number | undefined

export const register: Register = (on, options) => {
  const configuredLogModel = configuredModel(options.logModel, DEFAULT_LOG_MODEL)
  logModel = MODEL_IDS[configuredLogModel] ?? configuredLogModel
  chatModel = configuredModel(options.chatModel, DEFAULT_CHAT_MODEL)
  transcriptModel = configuredModel(options.transcriptModel, DEFAULT_TRANSCRIPT_MODEL)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    isInteractive = e.isInteractive
    if (isInteractive) $.clock.after(0, () => queueStart($))

    return started
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      turnPrompt = undefined
      lastSentAt = undefined
      await publish($, undefined, null)
    }

    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    if (turnPrompt === undefined && !e.isMeta && e.command === undefined) turnPrompt = e.text

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (!isInteractive || e.agentId !== undefined) return completed

    const messages = await $.session.messages()
    const turn: FinishedTurn = {
      messages: messages.slice(turnStart(messages, turnPrompt)),
      endedAt: await $.clock.now(),
      durationMs: e.durationMs,
      isAborted: e.isAborted,
    }
    turnPrompt = undefined
    lastSentAt = turn.endedAt
    $.clock.after(0, () => queueTurn($, turn))

    return completed
  })

  // The pane's own close mark and close key end here too, not only the buttons.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    await update($, isPaneOpen, () => false)

    return closed
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = elements
    // The mobile surface has no text field; the pane there is read-only.
    const Input = 'Input' in elements ? elements.Input : undefined
    const current = await read($, view)
    const asked = await read($, chat)
    const picked = await read($, picks)
    const chatPick = picked.chat ?? chatModel
    const transcriptPick = picked.transcript ?? transcriptModel
    const mainModel = modelName(await $.session.model())
    const notes = current.recent.slice().reverse()
    const progress = progressLine(current)
    const hint = asked?.coldCacheHint ?? null

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={3}>
          <Button key="refresh" plain hotkey="1" label="Refresh" onPress={() => queueRefresh($)} />
          <Button key="fill" plain hotkey="2" label="Put in prompt" onPress={() => void fillPrompt($)} />
          {/* Some terminals cannot reach the pane's own close mark; 9 matches the band's button that opens it. */}
          <Button key="close" plain hotkey="9" label="Close" onPress={() => void closePane($)} />
        </Box>
        {Input && (
          <Box flexDirection="column">
            <Text dimColor>{rule(e.props.bodyColumns, 'Ask about this session')}</Text>
            <Input
              key="ask"
              label="Ask:"
              placeholder="a question about this session"
              submitLabel="ask"
              onSubmit={question => void askNotes($, question)}
            />
            <Box flexDirection="row" gap={1}>
              <Text>Chat model:</Text>
              <Button key="chat-model-prev" plain label="◀" onPress={() => void pickModel($, 'chat', -1)} />
              <Text>{chatPick}</Text>
              <Button key="chat-model-next" plain label="▶" onPress={() => void pickModel($, 'chat', 1)} />
            </Box>
            {asked && (
              <Box flexDirection="column" marginTop={1}>
                <Text bold>{asked.question}</Text>
                {asked.isAsking && <Text dimColor>{ASKING_LABEL[asked.answeredBy](asked.model)}</Text>}
                {asked.error && <Text color="red">{asked.error}</Text>}
                {asked.answer && <Markdown key="answer" text={asked.answer} />}
                {hint && (
                  <Text color="yellow">
                    The session's cache has likely expired (nothing sent for {formatDuration(hint.idleMs)}).
                  </Text>
                )}
                {!asked.isAsking && (
                  <Box flexDirection="column" marginTop={1}>
                    <Box flexDirection="row">
                      <Box width={ASK_AGAIN_COLUMNS}>
                        <Button
                          key="ask-context"
                          plain
                          hotkey="3"
                          label={hint ? `Full context, full price${hint.tokens ? ` (~${formatTokens(hint.tokens)})` : ''}` : 'Ask again from context'}
                          onPress={() => void askContext($, asked.question, hint !== null)}
                        />
                      </Box>
                      <Text dimColor>{mainModel}</Text>
                    </Box>
                    <Box flexDirection="row">
                      <Box width={ASK_AGAIN_COLUMNS}>
                        <Button
                          key="ask-transcript"
                          plain
                          hotkey="4"
                          label={hint ? 'From transcript (trimmed, cheaper)' : 'Ask again from transcript'}
                          onPress={() => void askTranscript($, asked.question)}
                        />
                      </Box>
                      <Box flexDirection="row" gap={1}>
                        <Button key="transcript-model-prev" plain label="◀" onPress={() => void pickModel($, 'transcript', -1)} />
                        <Text>{transcriptPick}</Text>
                        <Button key="transcript-model-next" plain label="▶" onPress={() => void pickModel($, 'transcript', 1)} />
                      </Box>
                    </Box>
                  </Box>
                )}
                <Button key="clear" plain hotkey="5" label="Clear" onPress={() => void clearChat($)} />
              </Box>
            )}
            <Text dimColor>{rule(e.props.bodyColumns)}</Text>
          </Box>
        )}
        {progress && <Text dimColor>{progress}</Text>}
        {current.overview ? (
          <Markdown key="overview" text={overviewMarkdown(current.overview)} />
        ) : (
          <Text dimColor>No overview yet. It is written after the next turn ends, or press Refresh.</Text>
        )}
        {notes.length > 0 && (
          <Box flexDirection="column">
            <Text bold>
              Latest notes <Text dimColor>({notes.length} of {current.entryCount})</Text>
            </Text>
            {notes.map(note => (
              <Text key={String(note.at)} wrap="wrap">
                <Text dimColor>{timeOf(note.at)}</Text> {note.summary}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below

    const { Box, Button, Text } = $.ui.resolve(e)
    const current = await read($, view)
    const isOpen = await read($, isPaneOpen)

    return (
      <Box flexDirection="column" marginTop={1}>
        <Text wrap="truncate-end">
          <Text color="cyan">✦</Text> <Text dimColor>Overview ·</Text> {headline(current)}
        </Text>
        <Box flexDirection="row" paddingLeft={HEADLINE_INDENT_COLUMNS}>
          <Button
            key="overview"
            plain
            hotkey="9"
            label={isOpen ? 'Close overview' : 'Open overview'}
            onPress={() => void togglePane($)}
          />
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const dialog = await next(e)
    const { overview } = await read($, view)
    if (overview === null) return dialog

    const isOpen = await read($, isPaneOpen)

    const { Box, Button, Text } = $.ui.resolve(e)
    const now = overview.inProgress[0]
    const nextStep = overview.next[0]

    // The terminal refuses a tree over 12 rows here, counting a row per 40 characters
    // of each text, so every line stays within two rows. One Text per line, unnested,
    // so a styled fragment never counts as a line of its own.
    return (
      <Box flexDirection="column">
        <Text bold>{clip(`✦ ${STATUS_LABEL[overview.status]} · ${overview.goal}`, DIALOG_LINE_CHARS)}</Text>
        {now && <Text>{clip(`  Now:  ${now}`, DIALOG_LINE_CHARS)}</Text>}
        {nextStep && <Text>{clip(`  Next: ${nextStep}`, DIALOG_LINE_CHARS)}</Text>}
        <Box paddingLeft={HEADLINE_INDENT_COLUMNS}>
          <Button key="overview" label={isOpen ? 'Close overview' : 'Open overview'} onPress={() => void togglePane($)} />
        </Box>
        {dialog}
      </Box>
    )
  })
}

async function togglePane($: EngineInterface) {
  if (await read($, isPaneOpen)) return closePane($)

  await $.ui.open({ id: PANE, title: PANE_TITLE })
  await update($, isPaneOpen, () => true)
}

async function closePane($: EngineInterface) {
  await $.ui.close({ id: PANE })
  await update($, isPaneOpen, () => false)
}

/** Runs `job` after every job queued before it; resolves or rejects with the job itself. */
function runQueued($: EngineInterface, job: () => Promise<void>): Promise<void> {
  const run = queue.then(job)
  queue = run.catch(error => publishError($, describeError(error)))

  return run
}

function queueStart($: EngineInterface) {
  void runQueued($, () => start($)).catch(() => undefined)
}

function queueTurn($: EngineInterface, turn: FinishedTurn) {
  void runQueued($, () => logTurn($, turn)).catch(() => undefined)
}

function queueRefresh($: EngineInterface) {
  void runQueued($, () => refresh($)).catch(() => undefined)
}

async function start($: EngineInterface) {
  const record = await loadRecord($, await $.session.id())
  if (record !== undefined) return publish($, record, null)

  const messages = await $.session.messages()
  if (messages.length > 0) return seed($, messages)

  await publish($, undefined, null)
}

async function logTurn($: EngineInterface, turn: FinishedTurn) {
  const sessionId = await $.session.id()
  const record = await loadRecord($, sessionId)
  if (record === undefined) return seed($, await $.session.messages())
  if (record.seededAt >= turn.endedAt) return

  await setPhase($, 'logging')
  const reply = await $.model.complete({
    model: logModel,
    system: ENTRY_SYSTEM,
    prompt: entryPrompt(
      record.originalGoal,
      record.entries.slice(-5),
      digest(turn.messages, TURN_DIGEST_CHARS),
      turn.isAborted,
    ),
    maxTokens: 800,
  })
  const entry = reply.isAnswered ? toEntry(parseJson(reply.text), turn.endedAt) : undefined
  if (entry === undefined) return publishError($, failure('note for the last turn not written', reply))

  const timed = { ...entry, durationMs: turn.durationMs }
  const logged: SessionRecord = { ...record, entries: [...record.entries, timed], updatedAt: await $.clock.now() }
  await saveRecord($, sessionId, logged)
  await synthesise($, sessionId, logged)
}

async function refresh($: EngineInterface) {
  const sessionId = await $.session.id()
  const record = await loadRecord($, sessionId)
  if (record === undefined) return seed($, await $.session.messages())

  await synthesise($, sessionId, record)
}

async function seed($: EngineInterface, messages: readonly SessionMessage[]) {
  const sessionId = await $.session.id()
  await setPhase($, 'seeding')
  const seededAt = await $.clock.now()
  const originalGoal = firstPrompt(messages)
  const reply = await $.model.complete({
    model: logModel,
    system: SEED_SYSTEM,
    prompt: seedPrompt(originalGoal, digest(messages, SEED_DIGEST_CHARS)),
    maxTokens: 4000,
  })
  const entries = reply.isAnswered ? toSeedEntries(parseJson(reply.text), seededAt) : []
  if (entries.length === 0) return publishError($, failure('history not read', reply))

  await synthesise($, sessionId, { originalGoal, entries, overview: null, updatedAt: seededAt, seededAt })
}

async function synthesise($: EngineInterface, sessionId: string, record: SessionRecord) {
  await setPhase($, 'synthesising')
  const reply = await $.model.complete({
    model: logModel,
    system: SYNTHESIS_SYSTEM,
    prompt: synthesisPrompt(record.originalGoal, record.entries),
    maxTokens: 2000,
  })
  const now = await $.clock.now()
  const overview = reply.isAnswered ? toOverview(parseJson(reply.text), now) : undefined
  const saved: SessionRecord = { ...record, overview: overview ?? record.overview, updatedAt: now }

  await saveRecord($, sessionId, saved)
  await publish($, saved, overview ? null : failure('overview not rebuilt', reply))
}

async function askNotes($: EngineInterface, question: string) {
  const asked = question.trim()
  if (asked === '') return

  const name = await pickedModel($, 'chat')
  await startAnswer($, asked, 'notes', name)
  // A failed rebuild is already shown in the pane's progress line; the question
  // is still answered, from the overview as it stood.
  await runQueued($, () => refresh($)).catch(() => undefined)
  try {
    const system = await readPrompt($, CHAT_SYSTEM_FILE)
    const record = await loadRecord($, await $.session.id())
    const reply = await $.model.complete({
      model: MODEL_IDS[name] ?? name,
      system,
      prompt: answerPrompt(record?.originalGoal ?? '', record?.overview ?? null, record?.entries ?? [], asked),
      maxTokens: 1000,
    })
    await settleAnswer($, asked, 'notes', reply.isAnswered ? reply.text : null, reply.isAnswered ? null : failure('no answer', reply))
  } catch (error) {
    await settleAnswer($, asked, 'notes', null, describeError(error))
  }
}

/**
 * Asks the main model, forked over the session's own context. Unless `isConfirmed`,
 * a likely cold cache shows the hint instead, so the context is not read again at
 * full price without the person choosing it.
 */
async function askContext($: EngineInterface, question: string, isConfirmed: boolean) {
  const hint = isConfirmed ? null : await coldCacheHint($)
  if (hint !== null) {
    return update($, chat, current => (current?.question === question ? { ...current, coldCacheHint: hint } : current))
  }

  await startAnswer($, question, 'context', modelName(await $.session.model()))
  try {
    const preamble = await readPrompt($, MAIN_MODEL_PREAMBLE_FILE)
    const reply = await $.model.fork({ prompt: forkPrompt(preamble, question) })
    if (!reply.isAnswered && reply.reason === 'nothing-to-fork') return settleAnswer($, question, 'context', null, NOTHING_TO_FORK)
    if (reply.isAnswered) lastSentAt = await $.clock.now()

    await settleAnswer($, question, 'context', reply.isAnswered ? reply.text : null, reply.isAnswered ? null : failure('no answer', reply))
  } catch (error) {
    await settleAnswer($, question, 'context', null, describeError(error))
  }
}

async function askTranscript($: EngineInterface, question: string) {
  const name = await pickedModel($, 'transcript')
  await startAnswer($, question, 'transcript', name)
  try {
    const system = await readPrompt($, TRANSCRIPT_SYSTEM_FILE)
    const messages = await $.session.messages()
    const record = await loadRecord($, await $.session.id())
    const reply = await $.model.complete({
      model: MODEL_IDS[name] ?? name,
      system,
      prompt: transcriptPrompt(record?.originalGoal ?? firstPrompt(messages), digest(messages, TRANSCRIPT_DIGEST_CHARS), question),
      maxTokens: 1000,
    })
    await settleAnswer($, question, 'transcript', reply.isAnswered ? reply.text : null, reply.isAnswered ? null : failure('no answer', reply))
  } catch (error) {
    await settleAnswer($, question, 'transcript', null, describeError(error))
  }
}

/** The hint to show before asking from context, or null while the cache is likely still warm or nothing says otherwise. */
async function coldCacheHint($: EngineInterface): Promise<ColdCacheHint | null> {
  if (lastSentAt === undefined) return null

  const usage = await $.session.usage()
  const idleMs = (await $.clock.now()) - lastSentAt
  if (idleMs < cacheTtlMs(usage.rateLimits)) return null

  return { idleMs, tokens: usage.context.tokens ?? null }
}

/** A subscription reports its rate-limit windows; an API key reports none. */
function cacheTtlMs(rateLimits: readonly SessionRateLimit[]): number {
  const isSubscription = rateLimits.length > 0
  const isPastLimit = rateLimits.some(limit => limit.percentUsed >= 100)

  return isSubscription && !isPastLimit ? SUBSCRIPTION_CACHE_TTL_MS : API_CACHE_TTL_MS
}

async function startAnswer($: EngineInterface, question: string, answeredBy: AnswerSource, model: string) {
  await update($, chat, () => ({ question, answeredBy, model, answer: null, isAsking: true, error: null, coldCacheHint: null }))
}

async function pickedModel($: EngineInterface, row: keyof ModelPicks): Promise<string> {
  return (await read($, picks))[row] ?? configuredDefault(row)
}

async function pickModel($: EngineInterface, row: keyof ModelPicks, step: -1 | 1) {
  const configured = configuredDefault(row)
  await update($, picks, current => ({ ...current, [row]: stepModel(modelStops(configured), current[row] ?? configured, step) }))
}

function configuredDefault(row: keyof ModelPicks): string {
  return row === 'chat' ? chatModel : transcriptModel
}

/** The model a /config row holds, or `fallback` when it holds none the rows list. */
function configuredModel(value: unknown, fallback: string): string {
  return typeof value === 'string' && value in MODEL_IDS ? value : fallback
}

async function clearChat($: EngineInterface) {
  await update($, chat, () => null)
}

async function readPrompt($: EngineInterface, file: string) {
  try {
    return await $.fs.read(`${$.plugin.root}/${file}`)
  } catch (error) {
    throw new Error(`${file} could not be read: ${describeError(error)}`)
  }
}

/** Writes an answer, unless a newer question has replaced the one it answers. */
async function settleAnswer(
  $: EngineInterface,
  question: string,
  answeredBy: AnswerSource,
  answer: string | null,
  error: string | null,
) {
  await update($, chat, current =>
    current?.question === question && current.answeredBy === answeredBy
      ? { ...current, answer, error, isAsking: false }
      : current,
  )
}

async function fillPrompt($: EngineInterface) {
  const { overview } = await read($, view)
  if (overview === null) return void $.ui.toast('No overview yet to put in the prompt.')

  const quoted = overviewMarkdown(overview).replace(/^/gm, '> ')
  const note = `Here is the session overview the session-overview mod keeps from its turn log:\n\n${quoted}\n`
  const { text: draft } = await $.prompt.read()
  const filled = await $.prompt.fill({ text: draft.trim() ? `\n\n${note}` : note, mode: 'append' })
  if (!filled.isFilled) {
    $.ui.toast(`The prompt box did not take the overview${filled.refusal ? ` (${filled.refusal})` : ''}.`)
  }
}

async function loadRecord($: EngineInterface, sessionId: string) {
  return (await $.store.get(recordKey(sessionId))) as SessionRecord | undefined
}

async function saveRecord($: EngineInterface, sessionId: string, record: SessionRecord) {
  const bytes = byteLength(record)

  for (const dropped of sessionsToDrop(await readSizes($), sessionId, record.updatedAt, bytes)) {
    await $.store.delete(recordKey(dropped))
    await $.store.delete(metaKey(dropped))
  }

  try {
    await $.store.set(recordKey(sessionId), record)
  } catch (error) {
    throw new Error(`notes not saved (this session's log is ${Math.round(bytes / 1024)} KiB): ${describeError(error)}`)
  }
  await $.store.set(metaKey(sessionId), { updatedAt: record.updatedAt, bytes })
}

/**
 * When each stored session was last saved and how large its notes are, read from
 * each session's own meta key. Every session writes only its own keys: a single
 * index that each session read, changed and wrote back lost half its updates when
 * two sessions saved at once, and a session missing from it was never cleaned up.
 */
async function readSizes($: EngineInterface): Promise<StoreIndex> {
  const keys = await $.store.keys()
  // `index` is not a key this mod uses; a store that holds one has it removed, so
  // it does not count against the 4 MiB.
  if (keys.includes(UNUSED_INDEX_KEY)) await $.store.delete(UNUSED_INDEX_KEY)

  const sizes: StoreIndex = {}
  for (const key of keys) {
    if (!key.startsWith(RECORD_PREFIX)) continue

    const sessionId = key.slice(RECORD_PREFIX.length)
    const meta = (await $.store.get(metaKey(sessionId))) as SessionMeta | undefined
    sizes[sessionId] = meta ?? (await measure($, key))
  }

  return sizes
}

/** A record saved without its meta key (the save stopped in between) is measured from the record itself. */
async function measure($: EngineInterface, key: string): Promise<SessionMeta> {
  const record = (await $.store.get(key)) as SessionRecord

  return { updatedAt: record.updatedAt, bytes: byteLength(record) }
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

async function setPhase($: EngineInterface, phase: Phase) {
  await update($, view, current => ({ ...current, phase, error: null }))
}

async function publish($: EngineInterface, record: SessionRecord | undefined, error: string | null) {
  await update($, view, () => ({
    overview: record?.overview ?? null,
    recent: record?.entries.slice(-RECENT_NOTES) ?? [],
    entryCount: record?.entries.length ?? 0,
    phase: 'idle' as const,
    error,
  }))
}

async function publishError($: EngineInterface, error: string) {
  await update($, view, current => ({ ...current, phase: 'idle' as const, error }))
}

function headline(current: OverviewView): string {
  if (current.overview === null) return progressLine(current) || 'no overview yet'

  return `${STATUS_LABEL[current.overview.status]} · ${current.overview.goal}`
}

function progressLine(current: OverviewView): string {
  if (current.phase !== 'idle') return PHASE_LABEL[current.phase]
  if (current.error !== null) return `Last update failed: ${current.error}`

  return ''
}

function failure(what: string, reply: ModelCompleteResult): string {
  if (reply.isAnswered) return `${what}: the reply was not the expected JSON`
  if (reply.reason === 'api-error') return `${what}: API error ${reply.status ?? 'without status'} (${reply.error})`

  return `${what}: ${reply.reason}`
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function timeOf(at: number): string {
  const date = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
