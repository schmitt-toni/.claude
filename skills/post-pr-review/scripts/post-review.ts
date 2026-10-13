#!/usr/bin/env -S deno run --allow-run=gh --allow-read
// Renders review findings into GitHub inline comments and a review summary,
// validates every inline anchor against the PR diff and posts the review in one
// call. Findings that are not inline are rendered into the review summary. The
// findings file follows ../findings.schema.json.
//
// Usage: post-review.ts --pr <number> [--repo <[host/]owner/name>] [--dry-run] <findings.json>
//   --pr       required. Pull request number.
//   --repo     optional. Repository of the PR. Defaults to the repository of
//              the current directory.
//   --dry-run  optional. Validate and print the review instead of posting it.
//
// Exits 1 and lists every problem when the findings or the PR do not allow
// posting the review.

export type Severity = "critical" | "major" | "minor" | "nitpick" | "question";

export const SIDES = ["LEFT", "RIGHT"] as const;
export type Side = typeof SIDES[number];

export const CATEGORIES = [
  "Security",
  "Bug",
  "Performance",
  "Error Handling",
  "Maintainability",
  "Tests",
  "Docs",
  "Style",
] as const;
export type Category = typeof CATEGORIES[number];

interface FindingBase {
  severity: Severity;
  category: Category;
  blocking: boolean;
  title: string;
  explanation: string;
  fix?: string;
}

export interface InlineFinding extends FindingBase {
  inline: true;
  path: string;
  line: number;
  startLine?: number;
  side: Side;
  suggestion?: string;
}

// Posted in the review summary. Its lines are line numbers of the file at the
// PR's head commit and are not checked against the diff.
export interface GeneralFinding extends FindingBase {
  inline: false;
  path?: string;
  line?: number;
  startLine?: number;
}

export type Finding = InlineFinding | GeneralFinding;

export interface ReviewComment {
  path: string;
  line: number;
  side: Side;
  start_line?: number;
  start_side?: Side;
  body: string;
}

export interface ReviewPayload {
  commit_id: string;
  event: "REQUEST_CHANGES" | "COMMENT";
  body: string;
  comments: ReviewComment[];
}

export interface FileDiff {
  // Commentable line number → index of the hunk it belongs to, per side.
  left: Map<number, number>;
  right: Map<number, number>;
}

export interface PullRequest {
  url: string;
  host: string;
  owner: string;
  repo: string;
  number: number;
  headSha: string;
  author: string;
}

interface Options {
  pr: number;
  repo?: string;
  dryRun: boolean;
  file: string;
}

const SEVERITIES: Record<Severity, { emoji: string; label: string }> = {
  critical: { emoji: "🔴", label: "Critical" },
  major: { emoji: "🟠", label: "Major" },
  minor: { emoji: "🟡", label: "Minor" },
  nitpick: { emoji: "🔵", label: "Nitpick" },
  question: { emoji: "💬", label: "Question" },
};
export const SEVERITY_ORDER = Object.keys(SEVERITIES) as Severity[];

export const FINDING_FIELDS = new Set([
  "severity",
  "category",
  "blocking",
  "inline",
  "path",
  "line",
  "startLine",
  "side",
  "title",
  "explanation",
  "fix",
  "suggestion",
]);
export const MAX_TITLE_WORDS = 10;
const NON_BLOCKING_PREFIX = "Non-blocking because";

const USAGE =
  "Usage: post-review.ts --pr <number> [--repo <[host/]owner/name>] [--dry-run] <findings.json>";

class UsageError extends Error {}

export function parseArgs(args: string[]): Options {
  let pr: string | undefined;
  let repo: string | undefined;
  let dryRun = false;
  let file: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--pr" || arg === "--repo") {
      const value = args[++index];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(`${arg} needs a value`);
      }
      if (arg === "--pr") pr = value;
      else repo = value;
      continue;
    }
    if (arg.startsWith("--")) throw new UsageError(`unknown option ${arg}`);
    if (file !== undefined) {
      throw new UsageError("only one findings file can be given");
    }
    file = arg;
  }

  if (pr === undefined) throw new UsageError("--pr is required");
  if (!/^\d+$/.test(pr)) {
    throw new UsageError(`--pr must be a pull request number, got "${pr}"`);
  }
  if (file === undefined) throw new UsageError("the findings file is missing");
  return { pr: Number(pr), repo, dryRun, file };
}

export function parseFindings(
  input: unknown,
): { findings: Finding[]; errors: string[] } {
  if (!isRecord(input) || !Array.isArray(input.findings)) {
    return {
      findings: [],
      errors: ['the file must contain an object with a "findings" array'],
    };
  }
  if (input.findings.length === 0) {
    return {
      findings: [],
      errors: ["there are no findings; a review needs at least one"],
    };
  }

  const findings: Finding[] = [];
  const errors: string[] = [];
  input.findings.forEach((entry: unknown, index: number) => {
    const result = parseFinding(entry);
    if (Array.isArray(result)) {
      errors.push(...result.map((error) => `findings[${index}]: ${error}`));
      return;
    }
    findings.push(result);
  });
  return { findings, errors };
}

function parseFinding(entry: unknown): Finding | string[] {
  if (!isRecord(entry)) return ["must be an object"];

  const errors = Object.keys(entry)
    .filter((key) => !FINDING_FIELDS.has(key))
    .map((key) => `unknown field "${key}"`);
  const {
    severity,
    category,
    blocking,
    inline = true,
    path,
    line,
    startLine,
    side,
    title,
    explanation,
    fix,
    suggestion,
  } = entry;
  const isInline = inline !== false;

  if (!isSeverity(severity)) {
    errors.push(`severity must be one of: ${SEVERITY_ORDER.join(", ")}`);
  }
  if (!isCategory(category)) {
    errors.push(`category must be one of: ${CATEGORIES.join(", ")}`);
  }
  if (blocking !== undefined && typeof blocking !== "boolean") {
    errors.push("blocking must be true or false");
  }
  if (typeof inline !== "boolean") errors.push("inline must be true or false");
  if ((isInline || path !== undefined) && !isNonEmptyString(path)) {
    errors.push("path must be a non-empty string");
  }
  if ((isInline || line !== undefined) && !isLineNumber(line)) {
    errors.push("line must be a positive integer");
  }
  if (!isInline && line !== undefined && path === undefined) {
    errors.push("line needs a path");
  }
  if (startLine !== undefined && !isLineNumber(startLine)) {
    errors.push("startLine must be a positive integer");
  }
  if (!isInline && startLine !== undefined && line === undefined) {
    errors.push("startLine needs a line");
  }
  if (isLineNumber(line) && isLineNumber(startLine) && startLine >= line) {
    errors.push("startLine must be lower than line; omit it for a single line");
  }
  if (isInline && side !== undefined && !isSide(side)) {
    errors.push('side must be "LEFT" or "RIGHT"');
  }
  if (!isInline && side !== undefined) {
    errors.push("side only applies to inline findings");
  }
  errors.push(...titleErrors(title));
  if (!isNonEmptyString(explanation)) {
    errors.push("explanation must be a non-empty string");
  }
  if (fix !== undefined && !isNonEmptyString(fix)) {
    errors.push("fix must be a non-empty string");
  }
  if (suggestion !== undefined && typeof suggestion !== "string") {
    errors.push("suggestion must be a string");
  }
  if (fix !== undefined && suggestion !== undefined) {
    errors.push("use either fix or suggestion, not both");
  }
  if (!isInline && suggestion !== undefined) {
    errors.push(
      "a suggestion can only be applied from an inline comment; use fix instead",
    );
  }
  if (isInline && suggestion !== undefined && side === "LEFT") {
    errors.push(
      "a suggestion replaces lines in the PR's version of the file, so it needs side RIGHT",
    );
  }
  if (isSeverity(severity)) {
    errors.push(...blockingErrors(severity, blocking, explanation));
  }

  if (errors.length > 0) return errors;
  const validSeverity = severity as Severity;
  const finding = {
    severity: validSeverity,
    category: category as Category,
    blocking: typeof blocking === "boolean"
      ? blocking
      : isBlockingByDefault(validSeverity),
    title: (title as string).trim(),
    explanation: (explanation as string).trim(),
    fix: fix as string | undefined,
  };
  if (!isInline) {
    return {
      ...finding,
      inline: false,
      path: path as string | undefined,
      line: line as number | undefined,
      startLine: startLine as number | undefined,
    };
  }
  return {
    ...finding,
    inline: true,
    path: path as string,
    line: line as number,
    startLine: startLine as number | undefined,
    side: (side ?? "RIGHT") as Side,
    suggestion: suggestion as string | undefined,
  };
}

function titleErrors(title: unknown): string[] {
  if (!isNonEmptyString(title)) return ["title must be a non-empty string"];
  if (title.includes("\n")) return ["title must be a single line"];
  const words = title.trim().split(/\s+/).length;
  if (words > MAX_TITLE_WORDS) {
    return [`title has ${words} words; the maximum is ${MAX_TITLE_WORDS}`];
  }
  return [];
}

function blockingErrors(
  severity: Severity,
  blocking: unknown,
  explanation: unknown,
): string[] {
  if (severity === "critical" && blocking === false) {
    return ["a critical finding is always blocking"];
  }
  if (!isBlockingByDefault(severity) && blocking === true) {
    return [`a ${severity} finding is never blocking`];
  }
  if (severity !== "major" || !isNonEmptyString(explanation)) return [];

  const explainsNonBlocking = explanation.trimStart().startsWith(
    NON_BLOCKING_PREFIX,
  );
  if (blocking === false && !explainsNonBlocking) {
    return [
      `a non-blocking major finding must start its explanation with "${NON_BLOCKING_PREFIX} …"`,
    ];
  }
  if (blocking !== false && explainsNonBlocking) {
    return [
      `the explanation starts with "${NON_BLOCKING_PREFIX}" but the finding is blocking; set blocking to false`,
    ];
  }
  return [];
}

function isBlockingByDefault(severity: Severity): boolean {
  return severity === "critical" || severity === "major";
}

export function parseDiff(diff: string): Map<string, FileDiff> {
  const files = new Map<string, FileDiff>();
  let current: FileDiff | undefined;
  let oldPath: string | undefined;
  let hunk = -1;
  let oldLine = 0;
  let newLine = 0;
  let oldRemaining = 0;
  let newRemaining = 0;

  for (const text of diff.split("\n")) {
    // Hunk bodies are consumed by their header's line counts rather than by
    // their content, because a removed line that reads "-- x" or an added one
    // that reads "++ y" looks exactly like a file header.
    if (current && (oldRemaining > 0 || newRemaining > 0)) {
      const marker = text[0];
      if (marker === "\\") continue;
      if (marker === "+") {
        current.right.set(newLine++, hunk);
        newRemaining--;
        continue;
      }
      if (marker === "-") {
        current.left.set(oldLine++, hunk);
        oldRemaining--;
        continue;
      }
      current.left.set(oldLine++, hunk);
      current.right.set(newLine++, hunk);
      oldRemaining--;
      newRemaining--;
      continue;
    }

    if (text.startsWith("diff --git ")) {
      current = undefined;
      oldPath = undefined;
      continue;
    }
    if (text.startsWith("--- ")) {
      oldPath = parseDiffPath(text.slice(4), "a/");
      continue;
    }
    if (text.startsWith("+++ ")) {
      const path = parseDiffPath(text.slice(4), "b/") ?? oldPath;
      if (path === undefined) continue;
      current = { left: new Map(), right: new Map() };
      hunk = -1;
      files.set(path, current);
      continue;
    }

    const header = text.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!current || !header) continue;
    hunk++;
    oldLine = Number(header[1]);
    oldRemaining = header[2] === undefined ? 1 : Number(header[2]);
    newLine = Number(header[3]);
    newRemaining = header[4] === undefined ? 1 : Number(header[4]);
  }
  return files;
}

// Git appends a tab to a header path that contains a space, and C-quotes a
// path with special or non-ASCII characters ("b/caf\303\251.txt").
function parseDiffPath(raw: string, prefix: string): string | undefined {
  const trimmed = raw.endsWith("\t") ? raw.slice(0, -1) : raw;
  const path = trimmed.startsWith('"') ? unquoteGitPath(trimmed) : trimmed;
  if (path === "/dev/null") return undefined;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function unquoteGitPath(quoted: string): string {
  const escapes: Record<string, number> = {
    a: 7,
    b: 8,
    t: 9,
    n: 10,
    v: 11,
    f: 12,
    r: 13,
    '"': 34,
    "\\": 92,
  };
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  const inner = quoted.slice(1, -1);
  for (let index = 0; index < inner.length; index++) {
    const char = inner[index];
    if (char !== "\\") {
      bytes.push(...encoder.encode(char));
      continue;
    }
    const octal = inner.slice(index + 1, index + 4);
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(parseInt(octal, 8));
      index += 3;
      continue;
    }
    const escaped = inner[++index];
    bytes.push(escapes[escaped] ?? escaped.charCodeAt(0));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

export function anchorError(
  finding: InlineFinding,
  files: Map<string, FileDiff>,
): string | undefined {
  const file = files.get(finding.path);
  if (!file) {
    return `${finding.path} is not in the PR diff, or has no text changes to comment on`;
  }

  const lines = finding.side === "RIGHT" ? file.right : file.left;
  const otherSide: Side = finding.side === "RIGHT" ? "LEFT" : "RIGHT";
  const otherLines = finding.side === "RIGHT" ? file.left : file.right;
  const hunk = lines.get(finding.line);
  if (hunk === undefined) {
    const hint = otherLines.has(finding.line)
      ? ` (it is on the ${otherSide} side)`
      : "";
    return `${finding.path}:${finding.line} is not in the diff on the ${finding.side} side${hint}`;
  }
  if (finding.startLine === undefined) return undefined;

  const startHunk = lines.get(finding.startLine);
  if (startHunk === undefined) {
    return `${finding.path}:${finding.startLine} (startLine) is not in the diff on the ${finding.side} side`;
  }
  // GitHub rejects the whole review with a 422 when a multi-line comment
  // spans two hunks.
  if (startHunk !== hunk) {
    return `${finding.path}:${finding.startLine}-${finding.line} spans more than one diff hunk; a range must stay inside one hunk`;
  }
  return undefined;
}

export function renderComment(finding: InlineFinding): string {
  const sections = [...renderHeading(finding), finding.explanation];
  if (finding.fix !== undefined) sections.push(finding.fix);
  if (finding.suggestion !== undefined) {
    sections.push(suggestionBlock(finding.suggestion));
  }
  return sections.join("\n\n");
}

function renderGeneralFinding(
  finding: GeneralFinding,
  blobUrl: string,
): string {
  const sections = renderHeading(finding);
  const link = permalink(finding, blobUrl);
  if (link !== undefined) sections.push(link);
  sections.push(finding.explanation);
  if (finding.fix !== undefined) sections.push(finding.fix);
  return sections.join("\n\n");
}

function renderHeading(finding: Finding): string[] {
  const { emoji, label } = SEVERITIES[finding.severity];
  const header = finding.blocking
    ? `${emoji} **${label}** · ⛔ **Blocking** · \`${finding.category}\``
    : `${emoji} **${label}** · \`${finding.category}\``;
  return [header, `**${finding.title}**`];
}

// blobUrl points at the PR's head commit, so the link keeps showing the code
// the finding was written about after later pushes.
function permalink(
  finding: GeneralFinding,
  blobUrl: string,
): string | undefined {
  if (finding.path === undefined) return undefined;
  const file = `${blobUrl}/${
    finding.path.split("/").map(encodeURIComponent).join("/")
  }`;
  if (finding.line === undefined) return file;
  if (finding.startLine === undefined) return `${file}#L${finding.line}`;
  return `${file}#L${finding.startLine}-L${finding.line}`;
}

// Markdown closes a fence only on a backtick run at least as long as the
// opening one, so a suggestion that contains ``` needs a longer fence.
function suggestionBlock(code: string): string {
  const longestRun = Math.max(
    0,
    ...(code.match(/`+/g) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  const content = code.endsWith("\n") ? code.slice(0, -1) : code;
  // An empty suggestion block tells GitHub to delete the commented lines.
  if (content === "") return `${fence}suggestion\n${fence}`;
  return `${fence}suggestion\n${content}\n${fence}`;
}

export function renderSummary(findings: Finding[], blobUrl: string): string {
  const blocking = findings.filter((finding) => finding.blocking);
  const rows = SEVERITY_ORDER.map((severity) => {
    const { emoji, label } = SEVERITIES[severity];
    const count = findings.filter((finding) => finding.severity === severity)
      .length;
    return `| ${emoji} ${label} | ${count} |`;
  });
  const sections = [
    "# 🤖 Review",
    verdict(blocking.length),
    ["| Severity | Count |", "|---|---|", ...rows].join("\n"),
  ];
  if (blocking.length > 0) {
    const items = blocking.map((finding) => {
      const item = `- ${SEVERITIES[finding.severity].emoji} ${finding.title}`;
      const where = location(finding);
      return where === undefined ? item : `${item} (${where})`;
    });
    sections.push(["## ⛔ Blocking issues", ...items].join("\n"));
  }
  const general = findings.filter((finding): finding is GeneralFinding =>
    !finding.inline
  );
  if (general.length > 0) {
    const entries = general.map((finding) =>
      renderGeneralFinding(finding, blobUrl)
    );
    sections.push(`## General findings\n\n${entries.join("\n\n---\n\n")}`);
  }
  return sections.join("\n\n");
}

function verdict(blockingCount: number): string {
  if (blockingCount === 0) {
    return "No blocking issues, a few suggestions below.";
  }
  if (blockingCount === 1) {
    return "1 blocking issue must be resolved before merge.";
  }
  return `${blockingCount} blocking issues must be resolved before merge.`;
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) =>
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
    compareStrings(a.path ?? "", b.path ?? "") ||
    (a.startLine ?? a.line ?? 0) - (b.startLine ?? b.line ?? 0)
  );
}

export function buildReview(
  findings: Finding[],
  pullRequest: PullRequest,
): ReviewPayload {
  const sorted = sortFindings(findings);
  return {
    commit_id: pullRequest.headSha,
    event: sorted.some((finding) => finding.blocking)
      ? "REQUEST_CHANGES"
      : "COMMENT",
    body: renderSummary(sorted, blobUrl(pullRequest)),
    comments: sorted
      .filter((finding): finding is InlineFinding => finding.inline)
      .map(toReviewComment),
  };
}

function blobUrl(pullRequest: PullRequest): string {
  return `https://${pullRequest.host}/${pullRequest.owner}/${pullRequest.repo}/blob/${pullRequest.headSha}`;
}

function toReviewComment(finding: InlineFinding): ReviewComment {
  const comment: ReviewComment = {
    path: finding.path,
    line: finding.line,
    side: finding.side,
    body: renderComment(finding),
  };
  if (finding.startLine === undefined) return comment;
  return {
    ...comment,
    start_line: finding.startLine,
    start_side: finding.side,
  };
}

// GitHub links every #123 to issue or PR 123, so a finding that numbers
// itself or points at "point #2" of this review links somewhere unrelated.
// Only a warning: a deliberate reference to an issue or PR is legitimate.
export function findIssueReferences(finding: Finding): string[] {
  const prose = [finding.title, finding.explanation, finding.fix ?? ""]
    .join("\n")
    .replace(/(`{3,}|~{3,})[\s\S]*?\1/g, "")
    .replace(/`[^`\n]*`/g, "");
  return [...new Set(prose.match(/(?<![\w&#/])#\d+\b/g) ?? [])];
}

function issueReferenceWarnings(findings: Finding[]): string[] {
  return findings.flatMap((finding) => {
    const references = findIssueReferences(finding);
    if (references.length === 0) return [];
    return [
      `${location(finding) ?? `"${finding.title}"`}: ${
        references.join(", ")
      } will link to a GitHub issue or PR; keep it only if that is intended`,
    ];
  });
}

export function renderPreview(
  pullRequest: PullRequest,
  review: ReviewPayload,
  warnings: string[],
): string {
  const total = review.comments.length;
  const comments = review.comments.flatMap((comment, index) => [
    "",
    `===== Comment ${index + 1}/${total} · ${comment.path}:${
      comment.start_line === undefined ? "" : `${comment.start_line}-`
    }${comment.line} (${comment.side}) =====`,
    comment.body,
  ]);
  const parts = [
    `PR:     ${pullRequest.url}`,
    `Commit: ${review.commit_id}`,
    `Event:  ${review.event}`,
    "",
    "===== Review summary =====",
    review.body,
    ...comments,
  ];
  if (warnings.length > 0) {
    parts.push(
      "",
      "===== Warnings =====",
      ...warnings.map((warning) => `- ${warning}`),
    );
  }
  return parts.join("\n");
}

function location(finding: Finding): string | undefined {
  if (finding.path === undefined) return undefined;
  if (finding.line === undefined) return finding.path;
  const lines = finding.startLine === undefined
    ? `${finding.line}`
    : `${finding.startLine}-${finding.line}`;
  return `${finding.path}:${lines}`;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSeverity(value: unknown): value is Severity {
  return typeof value === "string" && value in SEVERITIES;
}

function isCategory(value: unknown): value is Category {
  return (CATEGORIES as readonly unknown[]).includes(value);
}

function isSide(value: unknown): value is Side {
  return (SIDES as readonly unknown[]).includes(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isLineNumber(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

async function gh(args: string[], stdin?: string): Promise<string> {
  const child = new Deno.Command("gh", {
    args,
    stdin: stdin === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  if (stdin !== undefined) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(stdin));
    await writer.close();
  }
  const { code, stdout, stderr } = await child.output();
  if (code !== 0) {
    const message = new TextDecoder().decode(stderr).trim();
    throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${message}`);
  }
  return new TextDecoder().decode(stdout);
}

function repoArgs(repo: string | undefined): string[] {
  return repo === undefined ? [] : ["--repo", repo];
}

async function fetchPullRequest(
  number: number,
  repo: string | undefined,
): Promise<PullRequest> {
  const view = JSON.parse(
    await gh([
      "pr",
      "view",
      String(number),
      ...repoArgs(repo),
      "--json",
      "url,headRefOid,author",
    ]),
  );
  const match = String(view.url).match(
    /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/\d+$/,
  );
  if (!match) throw new Error(`unexpected pull request URL: ${view.url}`);
  return {
    url: view.url,
    host: match[1],
    owner: match[2],
    repo: match[3],
    number,
    headSha: view.headRefOid,
    author: view.author.login,
  };
}

async function readFindingsFile(file: string): Promise<unknown> {
  const text = await Deno.readTextFile(file);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${file} is not valid JSON: ${
        error instanceof Error ? error.message : error
      }`,
    );
  }
}

function printErrors(heading: string, errors: string[]): void {
  console.error(heading);
  for (const error of errors) console.error(`- ${error}`);
}

async function main(args: string[]): Promise<number> {
  const options = parseArgs(args);
  const { findings, errors } = parseFindings(
    await readFindingsFile(options.file),
  );
  if (errors.length > 0) {
    printErrors("The findings file is invalid:", errors);
    return 1;
  }

  const pullRequest = await fetchPullRequest(options.pr, options.repo);
  const diff = parseDiff(
    await gh([
      "pr",
      "diff",
      String(options.pr),
      ...repoArgs(options.repo),
      "--color",
      "never",
    ]),
  );
  const anchorErrors = findings
    .filter((finding): finding is InlineFinding => finding.inline)
    .map((finding) => anchorError(finding, diff))
    .filter((error): error is string => error !== undefined);
  if (anchorErrors.length > 0) {
    printErrors(
      "These findings cannot be anchored to the PR diff:",
      anchorErrors,
    );
    return 1;
  }

  const review = buildReview(findings, pullRequest);
  if (review.event === "REQUEST_CHANGES") {
    const viewer = (await gh([
      "api",
      "--hostname",
      pullRequest.host,
      "user",
      "--jq",
      ".login",
    ])).trim();
    // GitHub refuses REQUEST_CHANGES from the PR's own author.
    if (viewer === pullRequest.author) {
      console.error(
        `${pullRequest.url} was opened by ${viewer}, the account posting this review. GitHub does not accept "Request changes" on your own pull request, and this review has blocking findings.`,
      );
      return 1;
    }
  }

  const warnings = issueReferenceWarnings(findings);
  if (options.dryRun) {
    console.log(renderPreview(pullRequest, review, warnings));
    return 0;
  }

  const response = JSON.parse(
    await gh(
      [
        "api",
        "--hostname",
        pullRequest.host,
        "--method",
        "POST",
        `repos/${pullRequest.owner}/${pullRequest.repo}/pulls/${pullRequest.number}/reviews`,
        "--input",
        "-",
      ],
      JSON.stringify(review),
    ),
  );
  console.log(`Posted ${review.event} review: ${response.html_url}`);
  for (const warning of warnings) console.error(`Warning: ${warning}`);
  return 0;
}

if (import.meta.main) {
  try {
    Deno.exit(await main(Deno.args));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof UsageError) console.error(USAGE);
    Deno.exit(1);
  }
}
