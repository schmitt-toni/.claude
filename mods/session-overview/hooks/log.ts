import type { SessionMessage } from 'claude-code'

import type { LogEntry, Overview, OverviewStatus } from '../types'

/** What the mod keeps in `$.store` per session, under `session:<session id>`. */
export type SessionRecord = {
  /** The session's first prompt, the yardstick for the on-track check. */
  originalGoal: string
  entries: LogEntry[]
  overview: Overview | null
  /** Milliseconds since the epoch of the last write; drives the cleanup of old sessions. */
  updatedAt: number
  /**
   * When the seed read the conversation, in milliseconds since the epoch. A turn
   * that ended before this is already in the seeded notes and is not logged again.
   */
  seededAt: number
}

/**
 * What the mod keeps in `$.store` per session beside its record, under
 * `meta:<session id>`: when the record was last written, in milliseconds since
 * the epoch, and its size in bytes of JSON.
 */
export type SessionMeta = { updatedAt: number; bytes: number }

/** Every stored session's meta, by session id. */
export type StoreIndex = Record<string, SessionMeta>

/**
 * The models the /config rows offer, by the name /model shows them under, with
 * the id each is called by. The manifest's `options` list the same names: a
 * /config row can only offer a fixed list, and no API lists the models /model does.
 */
export const MODEL_IDS: Readonly<Record<string, string>> = {
  'Opus 5.5': 'claude-opus-5-5',
  'Fable 5.1': 'claude-fable-5-1',
  'Sonnet 5.5': 'claude-sonnet-5-5',
  'Haiku 5.5': 'claude-haiku-5-5',
  'Haiku 4.5': 'claude-haiku-4-5-20251001',
  'Sonnet 5': 'claude-sonnet-5',
  'Opus 5': 'claude-opus-5',
  'Fable 5': 'claude-fable-5',
  'Opus 4.8': 'claude-opus-4-8',
  'Opus 4.7': 'claude-opus-4-7',
  'Opus 4.6': 'claude-opus-4-6',
  'Sonnet 4.6': 'claude-sonnet-4-6',
}

/** The stops of the pane's ◀ ▶ model selectors. */
const PANE_MODELS = ['Haiku 5.5', 'Sonnet 5.5', 'Opus 5.5']

/** The pane's stops for a row whose /config value is `configured`: the three, and `configured` when it is none of them. */
export function modelStops(configured: string): string[] {
  return PANE_MODELS.includes(configured) ? PANE_MODELS : [...PANE_MODELS, configured]
}

/** The stop one step from `current`, wrapping around at either end. */
export function stepModel(stops: readonly string[], current: string, step: -1 | 1): string {
  const at = Math.max(0, stops.indexOf(current))

  return stops[(at + step + stops.length) % stops.length] ?? current
}

const DAY_MS = 24 * 60 * 60 * 1000

// `$.store` refuses a write once the plugin's JSON passes 4 MiB in all, for every
// session together. Cleanup starts below that so the write that triggers it still fits.
export const STORE_SOFT_LIMIT_BYTES = 3.5 * 1024 * 1024
export const STALE_AFTER_MS = 30 * DAY_MS

/**
 * The sessions to delete before `keepId`'s record of `keepBytes` is written:
 * every other session untouched for 30 days, then the least recently updated
 * ones until the store is back under the soft limit. `keepId` is never dropped.
 */
export function sessionsToDrop(index: StoreIndex, keepId: string, now: number, keepBytes: number): string[] {
  const others = Object.entries(index).filter(([id]) => id !== keepId)
  const stale = others.filter(([, session]) => now - session.updatedAt > STALE_AFTER_MS).map(([id]) => id)
  const fresh = others
    .filter(([id]) => !stale.includes(id))
    .sort(([, a], [, b]) => a.updatedAt - b.updatedAt)

  let total = keepBytes + fresh.reduce((sum, [, session]) => sum + session.bytes, 0)
  const dropped = [...stale]
  for (const [id, session] of fresh) {
    if (total <= STORE_SOFT_LIMIT_BYTES) break
    dropped.push(id)
    total -= session.bytes
  }

  return dropped
}

const PROMPT_CHARS = 4000
const ASSISTANT_CHARS = 3000
const TOOL_INPUT_CHARS = 200
const TOOL_RESULT_CHARS = 300

function isPrompt(message: SessionMessage): boolean {
  // A user row that carries tool results is the engine answering tool calls, not the person.
  return message.role === 'user' && !message.toolResults?.length && message.text !== ''
}

/**
 * Where the turn that just ended starts: the last prompt holding `anchor` (the
 * turn's first submitted prompt), else the last prompt of all.
 */
export function turnStart(messages: readonly SessionMessage[], anchor: string | undefined): number {
  const probe = anchor?.trim().slice(0, 200)
  if (probe) {
    const anchored = messages.findLastIndex(message => isPrompt(message) && message.text.includes(probe))
    if (anchored !== -1) return anchored
  }

  return Math.max(0, messages.findLastIndex(isPrompt))
}

export function firstPrompt(messages: readonly SessionMessage[]): string {
  return clip(messages.find(isPrompt)?.text ?? '', PROMPT_CHARS)
}

/**
 * The conversation as plain lines for the log model, at most `budget`
 * characters. Over budget, the opening quarter and the most recent part are
 * kept and the middle is replaced by a line saying how much was left out.
 */
export function digest(messages: readonly SessionMessage[], budget: number): string {
  const lines = messages.flatMap(describe)
  const whole = lines.join('\n')
  if (whole.length <= budget) return whole

  const head = takeWithin(lines, budget / 4)
  const tail = takeWithin(lines.slice(head.length).reverse(), budget - head.join('\n').length).reverse()
  const omitted = lines.length - head.length - tail.length

  return [...head, `[... ${omitted} lines omitted ...]`, ...tail].join('\n')
}

function describe(message: SessionMessage): string[] {
  if (message.role === 'user') {
    return isPrompt(message) ? [`USER: ${clip(message.text, PROMPT_CHARS)}`] : []
  }

  const lines = message.text ? [`ASSISTANT: ${clip(message.text, ASSISTANT_CHARS)}`] : []
  for (const use of message.toolUses) {
    const input = clip(oneLine(JSON.stringify(use.input)), TOOL_INPUT_CHARS)
    const outcome =
      use.text === undefined ? '' : ` -> ${use.isError ? 'ERROR ' : ''}${clip(oneLine(use.text), TOOL_RESULT_CHARS)}`
    lines.push(`TOOL ${use.tool}(${input})${outcome}`)
  }

  return lines
}

function takeWithin(lines: readonly string[], budget: number): string[] {
  const taken: string[] = []
  let used = 0
  for (const line of lines) {
    if (used + line.length + 1 > budget) break
    taken.push(line)
    used += line.length + 1
  }

  return taken
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

const NOTE_FIELDS = `- summary: one or two sentences: what was asked and what was done or found. Name files, commands and results concretely.
- decisions: choices made (by the person or the assistant) that later work depends on. Empty when there are none.
- questions: things left open or waiting on the person. Empty when there are none.
Write plainly, without filler.`

export const ENTRY_SYSTEM = `You keep the log of a long-running Claude Code session for the person running it. You get the session's original goal, the latest notes of the log for context, and a digest of one finished turn: the person's prompt, the assistant's text and its tool calls. Write the note for that turn.

Reply with JSON only, no code fence:
{"summary": "...", "decisions": ["..."], "questions": ["..."]}

${NOTE_FIELDS}`

export const SEED_SYSTEM = `You start the log of a long-running Claude Code session for the person running it. You get the session's original goal and a digest of its history so far, in which a middle part may be left out. Split the history into its main phases, in order, and write one note per phase, at most 12.

Reply with JSON only, no code fence:
{"entries": [{"summary": "...", "decisions": ["..."], "questions": ["..."]}]}

${NOTE_FIELDS}`

export const SYNTHESIS_SYSTEM = `You write the overview of a long-running Claude Code session, for a person coming back to it after a break who needs to know where things stand. You get the original goal (the session's first prompt) and every note of the session's log, oldest first, each with its time.

Reply with JSON only, no code fence:
{"goal": "...", "status": "on-track", "statusReason": "...", "done": ["..."], "inProgress": ["..."], "next": ["..."], "decisions": ["..."], "openQuestions": ["..."]}

- goal: what the session is trying to achieve now, in one sentence. Say so when it has moved away from the original goal.
- status: "on-track" when recent work serves the goal and moves it forward; "drifting" when recent work has moved off the goal without the person deciding so; "stuck" when recent turns repeat or fail on the same problem; "unclear" when the log is too thin to tell.
- statusReason: one sentence backing the status, pointing at specific notes.
- done, inProgress, next: short items, most important first, at most 6 each.
- decisions: decisions still in force, at most 8.
- openQuestions: questions still waiting on the person, at most 6. Leave out the ones a later note answered.`

export function entryPrompt(goal: string, recent: readonly LogEntry[], turn: string, isAborted: boolean): string {
  return [
    `Original goal:\n${goal || '(unknown)'}`,
    `Latest notes:\n${recent.length ? formatEntries(recent) : '(none yet)'}`,
    `The turn${isAborted ? ' (interrupted by the person before it finished)' : ''}:\n${turn}`,
  ].join('\n\n')
}

export function seedPrompt(goal: string, history: string): string {
  return [`Original goal:\n${goal || '(unknown)'}`, `History:\n${history}`].join('\n\n')
}

export function synthesisPrompt(goal: string, entries: readonly LogEntry[]): string {
  return [`Original goal:\n${goal || '(unknown)'}`, `Log, oldest first:\n${formatEntries(entries)}`].join('\n\n')
}

// The chat's instructions live in the mod's prompts/ folder, read on every
// question, so they can be edited without touching code or reloading the mod.
export const CHAT_SYSTEM_FILE = 'prompts/chat-system.md'
export const MAIN_MODEL_PREAMBLE_FILE = 'prompts/main-model-preamble.md'
export const TRANSCRIPT_SYSTEM_FILE = 'prompts/transcript-system.md'

export function answerPrompt(goal: string, overview: Overview | null, entries: readonly LogEntry[], question: string): string {
  return [
    `Original goal:\n${goal || '(unknown)'}`,
    `Current overview:\n${overview ? overviewMarkdown(overview) : '(not written yet)'}`,
    `Log, oldest first:\n${entries.length ? formatEntries(entries) : '(no notes yet)'}`,
    `Question:\n${question}`,
  ].join('\n\n')
}

/**
 * The question as the main model reads it at the end of its own context. A fork
 * takes no system prompt of its own (it reuses the session's, which is what lets
 * the prompt cache serve it), so the preamble is the only place to frame it.
 */
export function forkPrompt(preamble: string, question: string): string {
  return `${preamble.trim()}\n\nQuestion: ${question}`
}

export function transcriptPrompt(goal: string, history: string, question: string): string {
  return [`Original goal:\n${goal || '(unknown)'}`, `Conversation:\n${history}`, `Question:\n${question}`].join('\n\n')
}

/** The name /model shows for `modelId`, or the id itself for a model the /config rows do not list. */
export function modelName(modelId: string): string {
  return Object.entries(MODEL_IDS).find(([, id]) => id === modelId)?.[0] ?? modelId
}

/** `220k tokens`, or `900 tokens` below a thousand. */
export function formatTokens(tokens: number): string {
  return tokens < 1000 ? `${tokens} tokens` : `${Math.round(tokens / 1000)}k tokens`
}

/** A dim rule across `columns` cells, opened by `title` when one is given. */
export function rule(columns: number, title?: string): string {
  const head = title ? `── ${title} ` : ''

  return head + '─'.repeat(Math.max(0, columns - head.length))
}

/** `1h 4m`, `3m 12s` or `45s`. */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`

  return `${seconds}s`
}

function formatEntries(entries: readonly LogEntry[]): string {
  return entries
    .map((entry, i) => {
      const took = entry.durationMs === undefined ? '' : ` (turn took ${formatDuration(entry.durationMs)})`
      // ISO 8601 in UTC: the model only needs the order and the gaps between notes.
      const lines = [`${i + 1}. [${new Date(entry.at).toISOString()}]${took} ${entry.summary}`]
      if (entry.decisions.length) lines.push(`   decided: ${entry.decisions.join('; ')}`)
      if (entry.questions.length) lines.push(`   open: ${entry.questions.join('; ')}`)

      return lines.join('\n')
    })
    .join('\n')
}

/** The JSON object in a model reply, tolerating a code fence or words around it. */
export function parseJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined

  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

function strings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []

  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').slice(0, max)
}

function fields(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}

export function toEntry(value: unknown, at: number, isSeeded = false): LogEntry | undefined {
  const reply = fields(value)
  if (typeof reply?.summary !== 'string' || reply.summary.trim() === '') return undefined

  const entry: LogEntry = {
    at,
    summary: reply.summary.trim(),
    decisions: strings(reply.decisions, 8),
    questions: strings(reply.questions, 8),
  }

  return isSeeded ? { ...entry, isSeeded } : entry
}

export function toSeedEntries(value: unknown, at: number): LogEntry[] {
  const entries = fields(value)?.entries
  if (!Array.isArray(entries)) return []

  return entries.flatMap(entry => toEntry(entry, at, true) ?? [])
}

const STATUSES: readonly OverviewStatus[] = ['on-track', 'drifting', 'stuck', 'unclear']

export function toOverview(value: unknown, at: number): Overview | undefined {
  const reply = fields(value)
  if (typeof reply?.goal !== 'string' || reply.goal.trim() === '') return undefined

  const status = STATUSES.find(known => known === reply.status) ?? 'unclear'

  return {
    at,
    goal: reply.goal.trim(),
    status,
    statusReason: typeof reply.statusReason === 'string' ? reply.statusReason.trim() : '',
    done: strings(reply.done, 6),
    inProgress: strings(reply.inProgress, 6),
    next: strings(reply.next, 6),
    decisions: strings(reply.decisions, 8),
    openQuestions: strings(reply.openQuestions, 6),
  }
}

export const STATUS_LABEL: Record<OverviewStatus, string> = {
  'on-track': 'On track',
  drifting: 'Drifting',
  stuck: 'Stuck',
  unclear: 'Unclear',
}

export function overviewMarkdown(overview: Overview): string {
  const sections: [string, string[]][] = [
    ['Done', overview.done],
    ['In progress', overview.inProgress],
    ['Next', overview.next],
    ['Decisions', overview.decisions],
    ['Open questions', overview.openQuestions],
  ]
  const reason = overview.statusReason ? ` — ${overview.statusReason}` : ''

  return [
    `**Goal:** ${overview.goal}`,
    `**Status:** ${STATUS_LABEL[overview.status]}${reason}`,
    ...sections
      .filter(([, items]) => items.length > 0)
      .map(([title, items]) => `**${title}**\n${items.map(item => `- ${item}`).join('\n')}`),
  ].join('\n\n')
}
