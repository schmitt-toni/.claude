import assert from "node:assert/strict";
import schema from "../findings.schema.json" with { type: "json" };
import {
  anchorError,
  buildReview,
  CATEGORIES,
  FINDING_FIELDS,
  findIssueReferences,
  type GeneralFinding,
  type InlineFinding,
  MAX_TITLE_WORDS,
  parseArgs,
  parseDiff,
  parseFindings,
  type PullRequest,
  renderComment,
  renderSummary,
  SEVERITY_ORDER,
  SIDES,
} from "./post-review.ts";

function finding(overrides: Partial<InlineFinding> = {}): InlineFinding {
  return {
    severity: "minor",
    category: "Bug",
    blocking: false,
    inline: true,
    path: "src/app.ts",
    line: 3,
    side: "RIGHT",
    title: "Off-by-one in loop bound",
    explanation: "The loop skips the last element.",
    ...overrides,
  };
}

function generalFinding(
  overrides: Partial<GeneralFinding> = {},
): GeneralFinding {
  return {
    severity: "minor",
    category: "Docs",
    blocking: false,
    inline: false,
    title: "README still documents the old flag",
    explanation: "The --legacy flag was removed.",
    ...overrides,
  };
}

const PULL_REQUEST: PullRequest = {
  url: "https://github.com/acme/shop/pull/12",
  host: "github.com",
  owner: "acme",
  repo: "shop",
  number: 12,
  headSha: "abc123",
  author: "octocat",
};
const BLOB_URL = "https://github.com/acme/shop/blob/abc123";

function rawFinding(overrides: Record<string, unknown> = {}) {
  return {
    severity: "minor",
    category: "Bug",
    path: "src/app.ts",
    line: 3,
    title: "Off-by-one in loop bound",
    explanation: "The loop skips the last element.",
    ...overrides,
  };
}

function errorsFor(overrides: Record<string, unknown>): string[] {
  return parseFindings({ findings: [rawFinding(overrides)] }).errors
    .map((error) => error.replace(/^findings\[0\]: /, ""));
}

const DIFF = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,4 +1,5 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+-- looks like a header",
  " const c = 4;",
  " const d = 5;",
  "@@ -20,2 +21,3 @@ function tail() {",
  " return a;",
  "+// added",
  " }",
  "\\ No newline at end of file",
  "diff --git a/old.txt b/old.txt",
  "deleted file mode 100644",
  "--- a/old.txt",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-first",
  "-second",
  'diff --git "a/caf\\303\\251 menu.md" "b/caf\\303\\251 menu.md"',
  '--- "a/caf\\303\\251 menu.md"',
  '+++ "b/caf\\303\\251 menu.md"',
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "diff --git a/with space.txt b/with space.txt",
  "--- a/with space.txt\t",
  "+++ b/with space.txt\t",
  "@@ -1 +1 @@",
  "-x",
  "+y",
  "diff --git a/logo.png b/logo.png",
  "Binary files a/logo.png and b/logo.png differ",
  "",
].join("\n");

Deno.test("parseArgs reads all options", () => {
  assert.deepEqual(
    parseArgs(["--pr", "12", "--repo", "acme/shop", "--dry-run", "f.json"]),
    { pr: 12, repo: "acme/shop", dryRun: true, file: "f.json" },
  );
});

Deno.test("parseArgs rejects a missing or non-numeric PR", () => {
  assert.throws(() => parseArgs(["f.json"]), /--pr is required/);
  assert.throws(
    () => parseArgs(["--pr", "abc", "f.json"]),
    /pull request number/,
  );
  assert.throws(
    () => parseArgs(["--pr", "--dry-run", "f.json"]),
    /needs a value/,
  );
});

Deno.test("parseFindings applies defaults", () => {
  const { findings, errors } = parseFindings({
    findings: [rawFinding(), rawFinding({ severity: "major" })],
  });
  assert.deepEqual(errors, []);
  const [minor, major] = findings;
  assert.ok(minor.inline);
  assert.equal(minor.side, "RIGHT");
  assert.equal(minor.blocking, false);
  assert.equal(major.blocking, true);
});

Deno.test("parseFindings accepts findings that are not inline", () => {
  const { findings, errors } = parseFindings({
    findings: [
      rawFinding({ inline: false, path: undefined, line: undefined }),
      rawFinding({ inline: false, line: undefined }),
      rawFinding({ inline: false, startLine: 1, fix: "Do x." }),
    ],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(
    findings.map(({ inline, path, line, startLine }) => ({
      inline,
      path,
      line,
      startLine,
    })),
    [
      { inline: false, path: undefined, line: undefined, startLine: undefined },
      {
        inline: false,
        path: "src/app.ts",
        line: undefined,
        startLine: undefined,
      },
      { inline: false, path: "src/app.ts", line: 3, startLine: 1 },
    ],
  );
});

Deno.test("parseFindings checks the anchor of findings that are not inline", () => {
  assert.deepEqual(errorsFor({ inline: "no" }), [
    "inline must be true or false",
  ]);
  assert.deepEqual(errorsFor({ inline: false, path: undefined }), [
    "line needs a path",
  ]);
  assert.deepEqual(
    errorsFor({ inline: false, line: undefined, startLine: 1 }),
    ["startLine needs a line"],
  );
  assert.deepEqual(errorsFor({ inline: false, side: "RIGHT" }), [
    "side only applies to inline findings",
  ]);
  assert.match(
    errorsFor({ inline: false, suggestion: "y" })[0],
    /use fix instead/,
  );
  assert.deepEqual(errorsFor({ path: undefined, line: undefined }), [
    "path must be a non-empty string",
    "line must be a positive integer",
  ]);
});

Deno.test("parseFindings requires at least one finding", () => {
  assert.match(parseFindings({ findings: [] }).errors[0], /at least one/);
  assert.match(parseFindings([]).errors[0], /"findings" array/);
});

Deno.test("parseFindings reports every problem with its index", () => {
  const { errors } = parseFindings({
    findings: [
      rawFinding(),
      rawFinding({ severity: "huge", category: "bug", line: 0, extra: 1 }),
    ],
  });
  assert.deepEqual(errors, [
    'findings[1]: unknown field "extra"',
    "findings[1]: severity must be one of: critical, major, minor, nitpick, question",
    "findings[1]: category must be one of: Security, Bug, Performance, Error Handling, Maintainability, Tests, Docs, Style",
    "findings[1]: line must be a positive integer",
  ]);
});

Deno.test("parseFindings enforces the blocking rules", () => {
  assert.deepEqual(errorsFor({ severity: "critical", blocking: false }), [
    "a critical finding is always blocking",
  ]);
  assert.deepEqual(errorsFor({ severity: "nitpick", blocking: true }), [
    "a nitpick finding is never blocking",
  ]);
  assert.match(
    errorsFor({ severity: "major", blocking: false })[0],
    /must start its explanation with "Non-blocking because/,
  );
  assert.match(
    errorsFor({
      severity: "major",
      explanation: "Non-blocking because it only affects admins.",
    })[0],
    /set blocking to false/,
  );
  assert.deepEqual(
    errorsFor({
      severity: "major",
      blocking: false,
      explanation: "Non-blocking because it only affects admins.",
    }),
    [],
  );
});

Deno.test("parseFindings checks title, range, fix and suggestion", () => {
  assert.match(
    errorsFor({
      title: "one two three four five six seven eight nine ten eleven",
    })[0],
    /11 words/,
  );
  assert.match(errorsFor({ startLine: 3 })[0], /startLine must be lower/);
  assert.match(
    errorsFor({ fix: "Do x.", suggestion: "y" })[0],
    /either fix or suggestion/,
  );
  assert.match(
    errorsFor({ side: "LEFT", suggestion: "y" })[0],
    /needs side RIGHT/,
  );
});

Deno.test("parseDiff maps commentable lines to hunks per side", () => {
  const files = parseDiff(DIFF);
  const app = files.get("src/app.ts")!;
  assert.deepEqual([...app.right.entries()], [
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 0],
    [21, 1],
    [22, 1],
    [23, 1],
  ]);
  assert.deepEqual([...app.left.entries()], [
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [20, 1],
    [21, 1],
  ]);
});

Deno.test("parseDiff handles deleted, quoted, spaced and binary files", () => {
  const files = parseDiff(DIFF);
  assert.deepEqual([...files.get("old.txt")!.left.keys()], [1, 2]);
  assert.equal(files.get("old.txt")!.right.size, 0);
  assert.deepEqual([...files.get("café menu.md")!.right.keys()], [1]);
  assert.deepEqual([...files.get("with space.txt")!.right.keys()], [1]);
  assert.equal(files.has("logo.png"), false);
});

Deno.test("anchorError accepts lines in the diff", () => {
  const files = parseDiff(DIFF);
  assert.equal(anchorError(finding({ line: 3 }), files), undefined);
  assert.equal(
    anchorError(finding({ startLine: 1, line: 5 }), files),
    undefined,
  );
  assert.equal(
    anchorError(finding({ path: "old.txt", line: 2, side: "LEFT" }), files),
    undefined,
  );
});

Deno.test("anchorError rejects lines GitHub cannot comment on", () => {
  const files = parseDiff(DIFF);
  assert.match(
    anchorError(finding({ path: "nope.ts" }), files)!,
    /not in the PR diff/,
  );
  assert.match(
    anchorError(finding({ line: 10 }), files)!,
    /not in the diff on the RIGHT side$/,
  );
  assert.match(
    anchorError(finding({ path: "old.txt", line: 1 }), files)!,
    /\(it is on the LEFT side\)/,
  );
  assert.match(
    anchorError(finding({ startLine: 4, line: 22 }), files)!,
    /more than one diff hunk/,
  );
});

Deno.test("renderComment uses the blocking or non-blocking header", () => {
  assert.equal(
    renderComment(
      finding({ severity: "critical", category: "Security", blocking: true }),
    ),
    [
      "🔴 **Critical** · ⛔ **Blocking** · `Security`",
      "**Off-by-one in loop bound**",
      "The loop skips the last element.",
    ].join("\n\n"),
  );
  assert.equal(
    renderComment(finding({ fix: "Move the check into the caller." })),
    [
      "🟡 **Minor** · `Bug`",
      "**Off-by-one in loop bound**",
      "The loop skips the last element.",
      "Move the check into the caller.",
    ].join("\n\n"),
  );
});

Deno.test("renderComment fences suggestions safely", () => {
  assert.match(
    renderComment(finding({ suggestion: "for (i = 0; i <= n; i++) {\n" })),
    /\n\n```suggestion\nfor \(i = 0; i <= n; i\+\+\) \{\n```$/,
  );
  assert.match(
    renderComment(finding({ suggestion: "```ts\nx\n```" })),
    /\n\n````suggestion\n```ts\nx\n```\n````$/,
  );
  assert.match(
    renderComment(finding({ suggestion: "" })),
    /\n\n```suggestion\n```$/,
  );
});

Deno.test("renderSummary counts severities and lists blocking issues", () => {
  const summary = renderSummary([
    finding({
      severity: "critical",
      blocking: true,
      title: "SQL injection",
      path: "db.ts",
      line: 9,
    }),
    finding({
      severity: "major",
      blocking: true,
      title: "Lost update",
      startLine: 2,
      line: 4,
    }),
    finding({ severity: "question" }),
  ], BLOB_URL);
  assert.equal(
    summary,
    [
      "# 🤖 Review",
      "2 blocking issues must be resolved before merge.",
      [
        "| Severity | Count |",
        "|---|---|",
        "| 🔴 Critical | 1 |",
        "| 🟠 Major | 1 |",
        "| 🟡 Minor | 0 |",
        "| 🔵 Nitpick | 0 |",
        "| 💬 Question | 1 |",
      ].join("\n"),
      [
        "## ⛔ Blocking issues",
        "- 🔴 SQL injection (db.ts:9)",
        "- 🟠 Lost update (src/app.ts:2-4)",
      ].join("\n"),
    ].join("\n\n"),
  );
});

Deno.test("renderSummary omits the blocking section when there is none", () => {
  const summary = renderSummary([finding()], BLOB_URL);
  assert.match(
    summary,
    /^# 🤖 Review\n\nNo blocking issues, a few suggestions below\./,
  );
  assert.doesNotMatch(summary, /Blocking issues/);
  assert.match(
    renderSummary(
      [finding({ severity: "critical", blocking: true })],
      BLOB_URL,
    ),
    /\n1 blocking issue must be resolved before merge\.\n/,
  );
});

Deno.test("buildReview orders comments and picks the review state", () => {
  const review = buildReview([
    finding({ severity: "nitpick", path: "a.ts", line: 1 }),
    finding({ severity: "minor", path: "b.ts", line: 7 }),
    finding({ severity: "minor", path: "a.ts", line: 9 }),
    finding({
      severity: "major",
      blocking: true,
      path: "z.ts",
      startLine: 2,
      line: 5,
    }),
  ], PULL_REQUEST);
  assert.equal(review.commit_id, "abc123");
  assert.equal(review.event, "REQUEST_CHANGES");
  assert.deepEqual(
    review.comments.map(({ body: _body, ...anchor }) => anchor),
    [
      {
        path: "z.ts",
        line: 5,
        side: "RIGHT",
        start_line: 2,
        start_side: "RIGHT",
      },
      { path: "a.ts", line: 9, side: "RIGHT" },
      { path: "b.ts", line: 7, side: "RIGHT" },
      { path: "a.ts", line: 1, side: "RIGHT" },
    ],
  );
  assert.equal(buildReview([finding()], PULL_REQUEST).event, "COMMENT");
});

Deno.test("renderSummary lists findings that are not inline", () => {
  const summary = renderSummary([
    generalFinding({
      severity: "major",
      category: "Bug",
      blocking: true,
      path: "src/orders/café repo.ts",
      startLine: 86,
      line: 88,
      title: "Unchanged caller now passes cents",
      explanation: "The repository still divides by 100.",
      fix: "Drop the division.",
    }),
    generalFinding({ severity: "nitpick", path: "README.md" }),
    generalFinding({ severity: "question" }),
  ], BLOB_URL);
  assert.equal(
    summary.slice(summary.indexOf("## ⛔ Blocking issues")),
    [
      [
        "## ⛔ Blocking issues",
        "- 🟠 Unchanged caller now passes cents (src/orders/café repo.ts:86-88)",
      ].join("\n"),
      "## General findings",
      "🟠 **Major** · ⛔ **Blocking** · `Bug`",
      "**Unchanged caller now passes cents**",
      "https://github.com/acme/shop/blob/abc123/src/orders/caf%C3%A9%20repo.ts#L86-L88",
      "The repository still divides by 100.",
      "Drop the division.",
      "---",
      "🔵 **Nitpick** · `Docs`",
      "**README still documents the old flag**",
      "https://github.com/acme/shop/blob/abc123/README.md",
      "The --legacy flag was removed.",
      "---",
      "💬 **Question** · `Docs`",
      "**README still documents the old flag**",
      "The --legacy flag was removed.",
    ].join("\n\n"),
  );
});

Deno.test("buildReview posts only inline findings as comments", () => {
  const review = buildReview([
    generalFinding({ severity: "critical", blocking: true }),
    finding({ path: "a.ts", line: 4 }),
  ], PULL_REQUEST);
  assert.equal(review.event, "REQUEST_CHANGES");
  assert.deepEqual(review.comments.map(({ path, line }) => ({ path, line })), [
    { path: "a.ts", line: 4 },
  ]);
  assert.match(review.body, /## General findings\n\n🔴 \*\*Critical\*\*/);
  assert.match(review.body, /- 🔴 README still documents the old flag\n/);
});

Deno.test("findIssueReferences ignores code, entities and URLs", () => {
  assert.deepEqual(
    findIssueReferences(finding({
      title: "See #12 and #12 again",
      explanation:
        "Use `arr[#3]`, &#123;, https://x.dev/#45 or\n```\n#7\n```\nbut not #8.",
    })),
    ["#12", "#8"],
  );
});

Deno.test("the schema matches the fields and values the script accepts", () => {
  const { properties, required } = schema.$defs.finding;
  assert.deepEqual(Object.keys(properties).sort(), [...FINDING_FIELDS].sort());
  assert.deepEqual(properties.severity.enum, SEVERITY_ORDER);
  assert.deepEqual(properties.category.enum, CATEGORIES);
  assert.deepEqual(properties.side.enum, SIDES);

  for (const field of required) {
    assert.notDeepEqual(errorsFor({ [field]: undefined }), [], field);
  }
  const only = (fields: string[]) =>
    Object.fromEntries(
      Object.entries(rawFinding()).filter(([key]) => fields.includes(key)),
    );
  assert.deepEqual(
    parseFindings({ findings: [{ ...only(required), inline: false }] }).errors,
    [],
  );
  assert.deepEqual(
    parseFindings({ findings: [only([...required, "path", "line"])] }).errors,
    [],
  );

  const title = new RegExp(properties.title.pattern, "u");
  const words = (count: number) => Array(count).fill("word").join(" ");
  assert.match(words(MAX_TITLE_WORDS), title);
  assert.doesNotMatch(words(MAX_TITLE_WORDS + 1), title);
  assert.doesNotMatch("two\nlines", title);
});
