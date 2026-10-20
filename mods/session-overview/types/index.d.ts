export type OverviewStatus = 'on-track' | 'drifting' | 'stuck' | 'unclear'

/**
 * One note of the session's log: one per finished turn of the main
 * conversation, or one per phase of the history a seed summarised.
 */
export type LogEntry = {
  /** When the note was written, in milliseconds since the epoch. */
  at: number
  summary: string
  decisions: string[]
  questions: string[]
  /** Written by the seed from history that predates the mod logging the session. */
  isSeeded?: boolean
  /** How long the turn took, wall clock, in milliseconds. Absent on seeded notes. */
  durationMs?: number
}

export type Overview = {
  /** When the overview was rebuilt, in milliseconds since the epoch. */
  at: number
  goal: string
  status: OverviewStatus
  statusReason: string
  done: string[]
  inProgress: string[]
  next: string[]
  decisions: string[]
  openQuestions: string[]
}

export type Phase = 'idle' | 'seeding' | 'logging' | 'synthesising'

/** What every display draws from: the current session's overview and its latest notes. */
export type OverviewView = {
  overview: Overview | null
  recent: LogEntry[]
  entryCount: number
  phase: Phase
  error: string | null
}

/**
 * Where a question in the pane is answered from: `notes`, the chat model over
 * the overview and notes; `context`, the main model forked over the session's
 * own context; `transcript`, the transcript model over a trimmed copy of the
 * conversation.
 */
export type AnswerSource = 'notes' | 'context' | 'transcript'

/**
 * Shown in place of asking from context when the session's prompt cache has
 * likely expired: how long the main conversation sent nothing, in milliseconds,
 * and the context a fork would read again at full price, in tokens.
 */
export type ColdCacheHint = { idleMs: number; tokens: number | null }

/** The one question asked in the pane and its answer. */
export type PaneChat = {
  question: string
  answeredBy: AnswerSource
  /** The model answering, by the name /model shows. */
  model: string
  answer: string | null
  isAsking: boolean
  error: string | null
  coldCacheHint: ColdCacheHint | null
}

/**
 * The models picked in the pane for the rest of the session, by the name
 * /model shows; null where the /config setting applies.
 */
export type ModelPicks = { chat: string | null; transcript: string | null }

declare module 'claude-code' {
  interface PluginState {
    'session-overview': {
      view: OverviewView
      chat: PaneChat | null
      picks: ModelPicks
      /** Whether the overview pane is open, so the buttons that open it offer to close it instead. */
      isPaneOpen: boolean
    }
  }
}
