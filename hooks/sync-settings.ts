#!/usr/bin/env -S deno run --allow-read --allow-write
// Syncs the committed ../settings.shared.json with the untracked
// ../settings.json. settings.json cannot be committed as a whole: other tools
// inject machine-specific hooks into it, and Claude Code itself writes to it.
//
//   sync-settings.ts apply    settings.shared.json -> settings.json
//   sync-settings.ts capture  settings.json -> settings.shared.json
//
// `apply` runs as a SessionStart hook registered by settings.shared.json
// itself. On a fresh machine, run it once by hand to register that hook.
// `capture` is run by hand before committing a change made through /config or
// by editing settings.json directly.
//
// Every top-level key of settings.shared.json except `hooks` is a shared
// preference and is copied as a whole. `capture` only refreshes keys that are
// already shared; a new preference is shared by adding it to
// settings.shared.json once by hand.
//
// A hook handler is managed, and owned by settings.shared.json, when its
// command references a script in this directory (see MANAGED_COMMAND).
// Handlers that do not, such as those other tools inject, are never touched.
// Every repo hook must therefore live in this directory and be referenced
// through `$HOME/.claude/hooks/`.
//
// `apply` prints nothing on success, because Claude Code adds a SessionStart
// hook's stdout to the session context.

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export interface HookHandler {
  type: string;
  command?: string;
  [key: string]: unknown;
}

export interface MatcherGroup {
  matcher?: string;
  hooks: HookHandler[];
  [key: string]: unknown;
}

// Keyed by hook event name, e.g. "PreToolUse".
export type Hooks = Record<string, MatcherGroup[]>;

const MANAGED_COMMAND = /\.claude\/hooks\//;

const SETTINGS_URL = new URL("../settings.json", import.meta.url);
const SHARED_URL = new URL("../settings.shared.json", import.meta.url);

export function isManaged(handler: HookHandler): boolean {
  return typeof handler.command === "string" &&
    MANAGED_COMMAND.test(handler.command);
}

// The managed handlers of `hooks`, in the shape settings.shared.json stores
// them: groups and events without a managed handler are left out.
export function extractManaged(hooks: Hooks): Hooks {
  const managed: Hooks = {};
  for (const [event, groups] of Object.entries(hooks)) {
    const managedGroups = groups
      .map((group) => ({ ...group, hooks: group.hooks.filter(isManaged) }))
      .filter((group) => group.hooks.length > 0);
    if (managedGroups.length === 0) continue;
    managed[event] = managedGroups;
  }
  return managed;
}

function withoutManaged(hooks: Hooks): Hooks {
  const unmanaged: Hooks = {};
  for (const [event, groups] of Object.entries(hooks)) {
    const unmanagedGroups = groups
      .map((group) => ({
        ...group,
        hooks: group.hooks.filter((handler) => !isManaged(handler)),
      }))
      .filter((group) => group.hooks.length > 0);
    if (unmanagedGroups.length === 0) continue;
    unmanaged[event] = unmanagedGroups;
  }
  return unmanaged;
}

// Compares per event, so the order of the events themselves does not count.
// Without that, an event that another tool adds later would make every apply
// rewrite settings.json.
function sameHooks(a: Hooks, b: Hooks): boolean {
  const events = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const event of events) {
    if (JSON.stringify(a[event] ?? []) !== JSON.stringify(b[event] ?? [])) {
      return false;
    }
  }
  return true;
}

function sharedPreferenceKeys(shared: JsonObject): string[] {
  return Object.keys(shared).filter((key) => key !== "hooks");
}

function hooksOf(object: JsonObject, file: string): Hooks {
  const hooks = object.hooks;
  if (hooks === undefined) return {};
  if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) {
    throw new Error(`${file}: "hooks" must be an object`);
  }
  return hooks as unknown as Hooks;
}

export function apply(settings: JsonObject, shared: JsonObject): JsonObject {
  const result: JsonObject = { ...settings };
  for (const key of sharedPreferenceKeys(shared)) {
    result[key] = shared[key];
  }

  const currentHooks = hooksOf(settings, "settings.json");
  const sharedHooks = hooksOf(shared, "settings.shared.json");
  // Rebuilding the hooks would move the managed groups behind any group
  // another tool added since the last apply, a change on every session.
  if (sameHooks(extractManaged(currentHooks), sharedHooks)) return result;

  const hooks = withoutManaged(currentHooks);
  for (const [event, groups] of Object.entries(sharedHooks)) {
    hooks[event] = [...(hooks[event] ?? []), ...groups];
  }
  result.hooks = hooks as unknown as JsonObject;
  return result;
}

export interface CaptureResult {
  shared: JsonObject;
  // Shared keys that settings.json does not set. They keep their shared value
  // instead of being dropped, because a key that was removed from
  // settings.json by accident would otherwise be removed for every machine.
  missingKeys: string[];
}

export function capture(
  settings: JsonObject,
  shared: JsonObject,
): CaptureResult {
  const result: JsonObject = { ...shared };
  const missingKeys: string[] = [];
  for (const key of sharedPreferenceKeys(shared)) {
    if (!(key in settings)) {
      missingKeys.push(key);
      continue;
    }
    result[key] = settings[key];
  }

  const sharedHooks = hooksOf(shared, "settings.shared.json");
  const managedHooks = extractManaged(hooksOf(settings, "settings.json"));
  if (!sameHooks(managedHooks, sharedHooks)) {
    result.hooks = managedHooks as unknown as JsonObject;
  }
  return { shared: result, missingKeys };
}

async function readObject(url: URL, fallback?: JsonObject): Promise<JsonObject> {
  let text: string;
  try {
    text = await Deno.readTextFile(url);
  } catch (error) {
    if (fallback !== undefined && error instanceof Deno.errors.NotFound) {
      return fallback;
    }
    throw error;
  }
  const parsed: Json = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${url.pathname} must contain a JSON object`);
  }
  return parsed;
}

// Writes next to the target and renames over it, so a crash mid-write cannot
// leave a truncated settings.json behind.
async function writeObject(url: URL, object: JsonObject): Promise<void> {
  const temporary = new URL(`${url.href}.sync-tmp`);
  await Deno.writeTextFile(temporary, JSON.stringify(object, null, 2) + "\n");
  await Deno.rename(temporary, url);
}

function sameObject(a: JsonObject, b: JsonObject): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main(args: string[]): Promise<number> {
  const mode = args[0];
  if (mode !== "apply" && mode !== "capture") {
    console.error("usage: sync-settings.ts apply|capture");
    return 1;
  }

  // A machine that has never run Claude Code has no settings.json yet.
  const settings = await readObject(SETTINGS_URL, {});
  const shared = await readObject(SHARED_URL);

  if (mode === "apply") {
    const applied = apply(settings, shared);
    if (sameObject(applied, settings)) return 0;
    await writeObject(SETTINGS_URL, applied);
    return 0;
  }

  const captured = capture(settings, shared);
  for (const key of captured.missingKeys) {
    console.error(
      `settings.json does not set "${key}"; keeping the shared value`,
    );
  }
  if (sameObject(captured.shared, shared)) {
    console.log("settings.shared.json is up to date");
    return 0;
  }
  await writeObject(SHARED_URL, captured.shared);
  console.log("updated settings.shared.json");
  return 0;
}

if (import.meta.main) {
  try {
    Deno.exit(await main(Deno.args));
  } catch (error) {
    console.error(`sync-settings: ${error instanceof Error ? error.message : error}`);
    Deno.exit(1);
  }
}
