import assert from "node:assert/strict";
import {
  decide,
  parsePostedReview,
  type PullRequestSnapshot,
  type TimelineItem,
  type WatchedReview,
} from "./re-review-watch.ts";

const REVIEW: WatchedReview = {
  nodeId: "PRR_watched",
  submittedAt: "2026-10-14T10:00:00Z",
  reviewer: "reviewer",
};

function snapshot(
  items: TimelineItem[] = [],
  overrides: Partial<PullRequestSnapshot> = {},
): PullRequestSnapshot {
  return {
    state: "OPEN",
    isDraft: false,
    timelineItems: { nodes: items },
    ...overrides,
  };
}

function reRequest(
  login: string | undefined,
  createdAt = "2026-10-14T12:00:00Z",
): TimelineItem {
  return {
    __typename: "ReviewRequestedEvent",
    createdAt,
    requestedReviewer: login === undefined
      ? null
      : { __typename: "User", login },
  };
}

function review(
  id: string,
  login: string,
  submittedAt: string | null = "2026-10-14T12:00:00Z",
): TimelineItem {
  return {
    __typename: "PullRequestReview",
    id,
    submittedAt,
    author: { login },
  };
}

Deno.test("parsePostedReview reads the line post-review.ts prints", () => {
  const stdout =
    "Posted REQUEST_CHANGES review: https://github.com/acme/shop/pull/12#pullrequestreview-345\n";
  assert.deepEqual(parsePostedReview(stdout), {
    host: "github.com",
    owner: "acme",
    repo: "shop",
    number: 12,
    reviewId: 345,
    reviewUrl: "https://github.com/acme/shop/pull/12#pullrequestreview-345",
    pullRequestUrl: "https://github.com/acme/shop/pull/12",
  });
});

Deno.test("parsePostedReview supports Enterprise hosts and Comment reviews", () => {
  const posted = parsePostedReview(
    "Posted COMMENT review: https://git.acme.dev/acme/shop/pull/7#pullrequestreview-9",
  );
  assert.equal(posted?.host, "git.acme.dev");
  assert.equal(posted?.number, 7);
});

Deno.test("parsePostedReview ignores dry runs and other output", () => {
  assert.equal(parsePostedReview(""), undefined);
  assert.equal(
    parsePostedReview(
      "Review preview for https://github.com/acme/shop/pull/12",
    ),
    undefined,
  );
  assert.equal(
    parsePostedReview(
      "echo Posted COMMENT review: https://github.com/acme/shop/pull/12#pullrequestreview-345",
    ),
    undefined,
  );
});

Deno.test("decide waits while nothing happened", () => {
  assert.equal(decide(snapshot(), REVIEW), "wait");
});

Deno.test("decide re-reviews when the reviewer is re-requested", () => {
  assert.equal(decide(snapshot([reRequest("reviewer")]), REVIEW), "re-review");
});

Deno.test("decide ignores requests for others or from before the review", () => {
  const items = [
    reRequest("someone-else"),
    reRequest(undefined),
    reRequest("reviewer", "2026-10-14T09:00:00Z"),
    reRequest("reviewer", REVIEW.submittedAt),
  ];
  assert.equal(decide(snapshot(items), REVIEW), "wait");
});

Deno.test("decide stops on a closed, merged or draft pull request", () => {
  const items = [reRequest("reviewer")];
  assert.equal(decide(snapshot(items, { state: "CLOSED" }), REVIEW), "stop");
  assert.equal(decide(snapshot(items, { state: "MERGED" }), REVIEW), "stop");
  assert.equal(decide(snapshot(items, { isDraft: true }), REVIEW), "stop");
});

Deno.test("decide stops when the reviewer posted a newer review", () => {
  const items = [review("PRR_newer", "reviewer"), reRequest("reviewer")];
  assert.equal(decide(snapshot(items), REVIEW), "stop");
});

Deno.test("decide ignores the watched, pending and other reviews", () => {
  const items = [
    review(REVIEW.nodeId, "reviewer", REVIEW.submittedAt),
    review("PRR_pending", "reviewer", null),
    review("PRR_other", "someone-else"),
  ];
  assert.equal(decide(snapshot(items), REVIEW), "wait");
});
