#!/usr/bin/env -S deno run --allow-run=gh
// PostToolUse hook for the Bash call that posts a review with
// skills/post-pr-review/scripts/post-review.ts. It watches the pull request
// and wakes Claude to run /re-review once the PR author re-requests a review
// from the account that posted it.
//
// settings.shared.json registers it with `asyncRewake`: it runs in the background,
// and Claude Code wakes Claude, even in an idle session, when it exits with
// code 2. Claude reads the hook's stderr on wake-up. The hook's `timeout`
// bounds the watch: Claude Code kills the process when it is reached, and
// nothing is reported.
//
// Exit codes:
//   0  nothing to do. The Bash call did not post a review, or the watch ended
//      without a re-request: the PR was closed, merged or converted to draft,
//      or the same account posted a newer review, whose own watch takes over.
//   2  wake Claude. The review was re-requested, or the watch broke.

export interface PostedReview {
  host: string;
  owner: string;
  repo: string;
  number: number;
  reviewId: number;
  reviewUrl: string;
  pullRequestUrl: string;
}

export interface WatchedReview {
  // GraphQL node ID, the form timeline items carry.
  nodeId: string;
  submittedAt: string;
  reviewer: string;
}

export type TimelineItem =
  | {
    __typename: "ReviewRequestedEvent";
    createdAt: string;
    // null for a team or user the token cannot see.
    requestedReviewer: { __typename: string; login?: string } | null;
  }
  | {
    __typename: "PullRequestReview";
    id: string;
    // null while the review is pending.
    submittedAt: string | null;
    author: { login: string } | null;
  };

export interface PullRequestSnapshot {
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  // Only items created after the watched review was submitted.
  timelineItems: { nodes: TimelineItem[] };
}

export type Verdict = "wait" | "stop" | "re-review";

const POLL_INTERVAL_MS = 5 * 60 * 1000;
// A single failed poll (network blip, rate limit) must not end a watch that
// runs for hours. A persistent failure (expired gh auth, deleted repository)
// must not leave the user waiting for a re-review that will never start.
const MAX_CONSECUTIVE_FAILURES = 3;

// The line post-review.ts prints after it posted a review. A dry run prints a
// preview instead, so it never starts a watch.
const POSTED_REVIEW =
  /^Posted [A-Z_]+ review: ((https?:\/\/([^/\s]+)\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+))#pullrequestreview-(\d+))$/m;

const PULL_REQUEST_QUERY = `
query($owner: String!, $repo: String!, $number: Int!, $since: DateTime!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      state
      isDraft
      timelineItems(since: $since, last: 100, itemTypes: [REVIEW_REQUESTED_EVENT, PULL_REQUEST_REVIEW]) {
        nodes {
          __typename
          ... on ReviewRequestedEvent {
            createdAt
            requestedReviewer { __typename ... on User { login } }
          }
          ... on PullRequestReview { id submittedAt author { login } }
        }
      }
    }
  }
}`;

export function parsePostedReview(stdout: string): PostedReview | undefined {
  const match = stdout.match(POSTED_REVIEW);
  if (!match) return undefined;
  return {
    reviewUrl: match[1],
    pullRequestUrl: match[2],
    host: match[3],
    owner: match[4],
    repo: match[5],
    number: Number(match[6]),
    reviewId: Number(match[7]),
  };
}

export function decide(
  pullRequest: PullRequestSnapshot,
  review: WatchedReview,
): Verdict {
  if (pullRequest.state !== "OPEN") return "stop";
  if (pullRequest.isDraft) return "stop";

  const submittedAt = Date.parse(review.submittedAt);
  const items = pullRequest.timelineItems.nodes;
  const superseded = items.some((item) =>
    item.__typename === "PullRequestReview" &&
    item.id !== review.nodeId &&
    item.author?.login === review.reviewer &&
    item.submittedAt !== null &&
    Date.parse(item.submittedAt) > submittedAt
  );
  if (superseded) return "stop";

  const reRequested = items.some((item) =>
    item.__typename === "ReviewRequestedEvent" &&
    item.requestedReviewer?.login === review.reviewer &&
    Date.parse(item.createdAt) > submittedAt
  );
  return reRequested ? "re-review" : "wait";
}

export function reReviewMessage(posted: PostedReview): string {
  return `The author of ${posted.pullRequestUrl} re-requested a review after ${posted.reviewUrl}. Invoke the /re-review skill for ${posted.owner}/${posted.repo}#${posted.number} now.`;
}

export function brokenWatchMessage(
  posted: PostedReview,
  error: unknown,
): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `The re-review watch on ${posted.pullRequestUrl} stopped after ${MAX_CONSECUTIVE_FAILURES} failed checks: ${reason}. /re-review will not start automatically for it. Tell the user; do not run /re-review.`;
}

async function gh(args: string[]): Promise<string> {
  const { code, stdout, stderr } = await new Deno.Command("gh", {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (code !== 0) {
    const message = new TextDecoder().decode(stderr).trim();
    throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${message}`);
  }
  return new TextDecoder().decode(stdout);
}

async function fetchWatchedReview(
  posted: PostedReview,
): Promise<WatchedReview> {
  const review = JSON.parse(
    await gh([
      "api",
      "--hostname",
      posted.host,
      `repos/${posted.owner}/${posted.repo}/pulls/${posted.number}/reviews/${posted.reviewId}`,
    ]),
  );
  return {
    nodeId: review.node_id,
    submittedAt: review.submitted_at,
    reviewer: review.user.login,
  };
}

async function fetchPullRequest(
  posted: PostedReview,
  since: string,
): Promise<PullRequestSnapshot> {
  const response = JSON.parse(
    await gh([
      "api",
      "graphql",
      "--hostname",
      posted.host,
      "-f",
      `owner=${posted.owner}`,
      "-f",
      `repo=${posted.repo}`,
      "-F",
      `number=${posted.number}`,
      "-f",
      `since=${since}`,
      "-f",
      `query=${PULL_REQUEST_QUERY}`,
    ]),
  );
  const pullRequest = response.data?.repository?.pullRequest;
  if (!pullRequest) {
    throw new Error(`${posted.pullRequestUrl} was not found`);
  }
  return pullRequest;
}

async function readPostedReview(): Promise<PostedReview | undefined> {
  try {
    const input = JSON.parse(await new Response(Deno.stdin.readable).text());
    return parsePostedReview(String(input?.tool_response?.stdout ?? ""));
  } catch {
    return undefined;
  }
}

async function main(): Promise<number> {
  const posted = await readPostedReview();
  if (posted === undefined) return 0;

  let review: WatchedReview | undefined;
  let failures = 0;
  while (true) {
    try {
      review ??= await fetchWatchedReview(posted);
      const verdict = decide(
        await fetchPullRequest(posted, review.submittedAt),
        review,
      );
      failures = 0;
      if (verdict === "stop") return 0;
      if (verdict === "re-review") {
        console.error(reReviewMessage(posted));
        return 2;
      }
    } catch (error) {
      failures++;
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(brokenWatchMessage(posted, error));
        return 2;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

if (import.meta.main) {
  Deno.exit(await main());
}
