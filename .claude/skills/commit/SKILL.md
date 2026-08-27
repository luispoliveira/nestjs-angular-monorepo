---
name: commit
description: Gate-checked git commits for this monorepo — runs build, lint, check-types and unit tests before drafting a Conventional Commits message, then waits for explicit user approval before committing. Supports splitting one verified diff into several commits without re-running checks.
license: MIT
compatibility: NestJS + Angular monorepo
metadata:
  author: project
  version: "1.0"
---

Prepare and create git commits in this monorepo. Never push, never open PRs, never use `--no-verify` or `--amend` unless explicitly asked.

**Input**: Optional hint after `/commit`, e.g. `/commit auth: fix session cookie`. Free text — used to steer scope/type, not required.

---

## Step 0 — Read the repo state

```bash
git status --porcelain
git diff
git diff --staged
git branch --show-current
```

- If there is nothing to commit, say so and stop.
- If the current branch is `main` or `develop`, this violates the project's Gitflow rule (`.github/git-commit-instructions.md` — "never commit directly to main or develop"). Warn the user and ask them to confirm before proceeding or to create a `feature/*`/`bugfix/*` branch first.

---

## Step 1 — Gate checks (once per session, only when new code changed)

Run before the **first** commit of a session, and again any time the working tree changes after checks last passed. Skip only for follow-up commits that split an already-verified diff (Step 4).

```bash
pnpm build
pnpm lint
pnpm check-types
```

Then run unit tests **only if a test script/spec files exist** for the touched packages (check `package.json` `scripts.test` and for `*.spec.ts` near the diff):

```bash
pnpm --filter <affected-package> test
```

If any check fails:
- Stop. Show the failing command and its output.
- Do **not** draft a commit message or commit anything.
- Wait for the user to fix the issue (or fix it yourself if asked), then re-run the gate.

---

## Step 2 — Stage deliberately

Never `git add -A` or `git add .`. Stage specific files/paths relevant to the logical change being committed. If the user wants multiple commits from one diff, split by path or by hunk (`git add -p`) per logical unit.

---

## Step 3 — Draft the commit message

Follow [.github/git-commit-instructions.md](../../../.github/git-commit-instructions.md) exactly:

```
<type>(<scope>): <imperative summary>

[optional body explaining why, wrapped at 72 chars]

[optional footer]
```

- Types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `build`, `ci`, `style`, `revert`.
- Scope = touched app/package name (`auth`, `web`, `api`, `database`, `shared`, `shared-types`, `mail`, `worker`, `notifications`, `ci`, `docker`) — omit if the change spans several.
- Subject ≤50 chars (hard cap 72), imperative mood, lowercase after the colon, no trailing period.
- Body only when the subject doesn't explain the *why*.
- Breaking change → `type(scope)!:` + `BREAKING CHANGE:` footer.
- **Never** add AI attribution ("Generated with...", "Co-authored by Claude"), first-person pronouns, or restate the filename.

Present the exact message you intend to run, then **stop and wait for explicit approval** ("ok", "yes", "commit it", or an edited message). Do not call `git commit` before that approval.

---

## Step 4 — Commit on approval

```bash
git commit -m "$(cat <<'EOF'
<approved message>
EOF
)"
git status
```

## Step 5 — Repeat for more commits (optional)

If the user wants several commits out of the same verified working tree:
- Skip Step 1 (checks already passed for this diff) — **unless** they add or change code after the checks ran, in which case re-run Step 1 first.
- Repeat Steps 2–4 for each additional logical chunk, staging only that chunk and asking approval for each message individually.

---

## Guardrails

- Never push, merge, or open a PR — this skill only prepares and creates local commits.
- Never skip hooks (`--no-verify`) or bypass signing.
- Never amend an existing commit unless explicitly asked.
- Never commit `.env`, credentials, or other secret-looking files — flag them instead.
- Always create new commits, never reuse/rewrite history.
