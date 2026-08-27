---
name: generate-docs
description: Generate or update project documentation — PROJECT_MAP.md, ARCHITECTURE_OVERVIEW.md, ENTRYPOINTS.md, CONVENTIONS.md, DEPENDENCY_GRAPH.md. Scans the codebase and writes accurate docs.
license: MIT
compatibility: NestJS + Angular monorepo
metadata:
  author: project
  version: "1.0"
---

Generate or update documentation for this NestJS + Angular monorepo. Scan the codebase and produce accurate, navigable docs.

**Input**: Optionally specify which document(s) to generate. Default: all documents.

---

## Documents to Generate/Update

| Document | Purpose | When to Update |
|----------|---------|---------------|
| `PROJECT_MAP.md` | Directory + file inventory | New app, new package, major restructure |
| `ARCHITECTURE_OVERVIEW.md` | Service topology, module structure, flows | New service, new event/queue, auth changes |
| `ENTRYPOINTS.md` | All HTTP, event, and job entry points | New route, new event pattern, new job |
| `CONVENTIONS.md` | Coding standards and patterns | New pattern adopted, convention change |
| `DEPENDENCY_GRAPH.md` | Package and module dependency map | New dependency, new inter-service comm |

---

## Generation Process

### Step 1: Analyze Current State

Run relevant discovery commands (use `find`, `grep`, `cat`):

```bash
# Project structure
find . -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' | sort

# All controllers
grep -r "@Controller\|@Get\|@Post\|@Put\|@Delete\|@Patch" apps --include="*.ts" -n

# All event/message patterns
grep -r "@EventPattern\|@MessagePattern\|EVENT_PATTERNS\|MESSAGE_PATTERNS" apps --include="*.ts" -n

# All queue jobs
grep -r "@Processor\|@Process\|JOB_PATTERNS" apps --include="*.ts" -n

# Internal package usage
grep -r "@repo/" apps --include="package.json"
```

### Step 2: Read Existing Documents

Before updating, read the existing doc to understand what's already accurate:

```bash
cat PROJECT_MAP.md
cat ARCHITECTURE_OVERVIEW.md
cat ENTRYPOINTS.md
```

### Step 3: Identify What Changed

Compare codebase state against existing docs:
- New apps or packages?
- New routes or procedures?
- New event/queue patterns?
- New dependencies?
- Removed or renamed items?

### Step 4: Generate/Update

Only update sections that are stale. Keep accurate sections as-is.

When writing:
- Use tables for inventories (more scannable than prose)
- Use ASCII diagrams for topology and flow
- Include file paths for navigation
- Cross-reference between documents

---

## Quality Standards

Each document must be:
- **Accurate**: reflects the actual codebase, not aspirational state
- **Navigable**: file paths + line references where useful
- **Current**: no stale entries from deleted code
- **Concise**: tables over paragraphs where possible

---

## Output

After updating:
1. List which documents were updated
2. Summarize what changed (new routes, new events, etc.)
3. Flag anything that couldn't be determined from static analysis

---

## Guardrails

- Only write documentation files — never application code
- Do not add `.md` files outside the project root or `docs/`
- If uncertain about a fact, mark it with `<!-- verify -->` inline
- Do not invent endpoints or modules — only document what exists
