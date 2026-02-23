# pr-stack

A GitHub App that auto-rebases stacked PRs when a PR they depend on gets merged. Also exposes a `/ci-check` endpoint for skipping CI when no actual code changed.

## How it works

**Auto-rebase**
- Listens for `pull_request.closed` (merged) webhook events
- Finds all open PRs whose base branch is the merged PR's head branch
- Clones the repo, rebases each dependent PR onto the new base, and force-pushes
- Attempts to auto-resolve conflicts by checking git blame — if a conflict was introduced by the merged PR itself, it keeps the incoming change; otherwise it aborts

**CI check**
- Accepts a `POST /ci-check` request with before/after commit SHAs and PR metadata
- Compares the tree SHA at each commit tip; if they match and no new commits were added, returns `{ skipCI: true }`
- Intended for use in CI pipelines to skip redundant runs after a rebase-only push

## Setup

**Prerequisites**
- [bun](https://bun.sh) v1+
- A GitHub App with `pull_requests: read/write` and `contents: read/write` permissions, subscribed to `pull_request` webhook events

**Environment variables**

| Variable | Description |
|---|---|
| `APP_ID` | GitHub App ID |
| `PRIVATE_KEY` | GitHub App private key (PEM) |
| `WEBHOOK_SECRET` | Webhook secret configured on the GitHub App |

**Install and run**

```sh
bun install
bun run dev:api
```

## API

**`POST /webhook`** — receives GitHub webhook events and triggers the rebase flow

**`POST /ci-check`** — takes a GitHub push event payload and returns `{ skipCI: true/false, message: "..." }` indicating whether CI can be skipped
