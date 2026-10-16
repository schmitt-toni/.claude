---
name: re-review
description: Re Review a Pull Request with blocking changes. Use this to continue after an author responded.
---

The author responded to the findings. Re-Read the comments and verify them.
Re-Review the PR, use the `/ultra-pr-review` skill if there were a substantial amount of blocking issues, otherwise decide yourselve on how to Re-Review.
When nothing more notable surfaces automatically approve the PR, otherwise report back to the user.

Whichever way you re-review, publish exactly one review with `/post-pr-review`. When you approve, tell `/post-pr-review` to approve the PR and to post without asking the user. The remaining non-blocking findings go into that approving review.
