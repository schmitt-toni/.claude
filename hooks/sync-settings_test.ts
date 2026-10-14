import assert from "node:assert/strict";
import {
  apply,
  capture,
  extractManaged,
  type HookHandler,
  type Hooks,
  isManaged,
  type JsonObject,
} from "./sync-settings.ts";

const NVM: HookHandler = {
  type: "command",
  command: "sh $HOME/.claude/hooks/nvm-autouse.sh",
  timeout: 5,
};
const POLICY: HookHandler = {
  type: "command",
  command: "$HOME/.claude/hooks/agent-model-policy.sh",
};
const ITERM: HookHandler = {
  type: "command",
  command: "/Users/someone/.config/iterm2/cc-status",
};
const ORCA: HookHandler = { type: "command", command: "orca-hook" };

function settingsWith(hooks: Hooks, preferences: JsonObject = {}): JsonObject {
  return { ...preferences, hooks: hooks as unknown as JsonObject };
}

Deno.test("isManaged recognizes commands that reference the hooks directory", () => {
  assert.equal(isManaged(NVM), true);
  assert.equal(
    isManaged({ type: "command", command: 'cat "$HOME/.claude/hooks/x.md"' }),
    true,
  );
  assert.equal(isManaged(ITERM), false);
  assert.equal(isManaged({ type: "prompt" }), false);
});

Deno.test("extractManaged drops unmanaged handlers, empty groups and empty events", () => {
  const hooks: Hooks = {
    PreToolUse: [
      { hooks: [ITERM] },
      { matcher: "Bash", hooks: [ORCA, NVM] },
    ],
    Stop: [{ hooks: [ORCA] }],
  };

  assert.deepEqual(extractManaged(hooks), {
    PreToolUse: [{ matcher: "Bash", hooks: [NVM] }],
  });
});

Deno.test("apply copies shared preferences and keeps local-only keys", () => {
  const settings: JsonObject = { theme: "light", effortLevel: "high" };
  const shared: JsonObject = { theme: "dark", autoCompactEnabled: true };

  assert.deepEqual(apply(settings, shared), {
    theme: "dark",
    effortLevel: "high",
    autoCompactEnabled: true,
  });
});

Deno.test("apply adds shared hooks next to unmanaged ones", () => {
  const settings = settingsWith({ PreToolUse: [{ hooks: [ITERM] }] });
  const shared = settingsWith({
    PreToolUse: [{ matcher: "Bash", hooks: [NVM] }],
    SessionStart: [{ hooks: [POLICY] }],
  });

  assert.deepEqual(apply(settings, shared).hooks, {
    PreToolUse: [{ hooks: [ITERM] }, { matcher: "Bash", hooks: [NVM] }],
    SessionStart: [{ hooks: [POLICY] }],
  });
});

Deno.test("apply replaces outdated managed hooks and removes ones no longer shared", () => {
  const oldNvm = { ...NVM, timeout: 1 };
  const settings = settingsWith({
    PreToolUse: [
      { hooks: [ITERM] },
      { matcher: "Bash", hooks: [oldNvm] },
    ],
    PreCompact: [{ hooks: [POLICY] }],
  });
  const shared = settingsWith({
    PreToolUse: [{ matcher: "Bash", hooks: [NVM] }],
  });

  assert.deepEqual(apply(settings, shared).hooks, {
    PreToolUse: [{ hooks: [ITERM] }, { matcher: "Bash", hooks: [NVM] }],
  });
});

Deno.test("apply keeps unmanaged handlers that share a group with a managed one", () => {
  const settings = settingsWith({
    PreToolUse: [{ matcher: "Bash", hooks: [ORCA, { ...NVM, timeout: 1 }] }],
  });
  const shared = settingsWith({
    PreToolUse: [{ matcher: "Bash", hooks: [NVM] }],
  });

  assert.deepEqual(apply(settings, shared).hooks, {
    PreToolUse: [
      { matcher: "Bash", hooks: [ORCA] },
      { matcher: "Bash", hooks: [NVM] },
    ],
  });
});

Deno.test("apply leaves hook order alone when the managed hooks are current", () => {
  // Another tool appended ORCA after the managed group since the last apply.
  const settings = settingsWith({
    PreToolUse: [{ matcher: "Bash", hooks: [NVM] }, { hooks: [ORCA] }],
  });
  const shared = settingsWith({
    PreToolUse: [{ matcher: "Bash", hooks: [NVM] }],
  });

  assert.deepEqual(apply(settings, shared), settings);
});

Deno.test("apply removes every managed hook when nothing is shared", () => {
  const settings = settingsWith({
    PreToolUse: [{ hooks: [ITERM] }, { matcher: "Bash", hooks: [NVM] }],
  });

  assert.deepEqual(apply(settings, { theme: "dark" }).hooks, {
    PreToolUse: [{ hooks: [ITERM] }],
  });
});

Deno.test("apply is idempotent", () => {
  const settings = settingsWith(
    { PreToolUse: [{ hooks: [ITERM] }], Stop: [{ hooks: [ORCA] }] },
    { theme: "light" },
  );
  const shared = settingsWith(
    { PreToolUse: [{ matcher: "Bash", hooks: [NVM] }] },
    { theme: "dark" },
  );

  const once = apply(settings, shared);
  assert.deepEqual(apply(once, shared), once);
});

Deno.test("apply rejects hooks that are not an object", () => {
  assert.throws(
    () => apply({ hooks: [] }, { theme: "dark" }),
    /settings\.json: "hooks" must be an object/,
  );
});

Deno.test("capture refreshes shared preferences without adding new keys", () => {
  const settings: JsonObject = { theme: "light", effortLevel: "high" };
  const shared: JsonObject = { theme: "dark" };

  assert.deepEqual(capture(settings, shared), {
    shared: { theme: "light" },
    missingKeys: [],
  });
});

Deno.test("capture keeps and reports shared keys that settings.json does not set", () => {
  const shared: JsonObject = { theme: "dark", editorMode: "vim" };

  assert.deepEqual(capture({ theme: "light" }, shared), {
    shared: { theme: "light", editorMode: "vim" },
    missingKeys: ["editorMode"],
  });
});

Deno.test("capture takes the managed hooks and ignores unmanaged ones", () => {
  const editedNvm = { ...NVM, timeout: 10 };
  const settings = settingsWith({
    PreToolUse: [{ hooks: [ITERM] }, { matcher: "Bash", hooks: [editedNvm] }],
    Stop: [{ hooks: [ORCA] }],
  });
  const shared = settingsWith({
    PreToolUse: [{ matcher: "Bash", hooks: [NVM] }],
  });

  assert.deepEqual(capture(settings, shared).shared.hooks, {
    PreToolUse: [{ matcher: "Bash", hooks: [editedNvm] }],
  });
});

Deno.test("capture after apply leaves settings.shared.json unchanged", () => {
  const settings = settingsWith(
    { PreToolUse: [{ hooks: [ITERM] }] },
    { theme: "light", effortLevel: "high" },
  );
  const shared = settingsWith(
    {
      PreToolUse: [{ matcher: "Bash", hooks: [NVM] }],
      SessionStart: [{ hooks: [POLICY] }],
    },
    { theme: "dark" },
  );

  assert.deepEqual(capture(apply(settings, shared), shared).shared, shared);
});
