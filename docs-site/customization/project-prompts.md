# Project-Specific Prompts

By default, Agentflow agents use built-in prompt templates for each role (researcher, developer, reviewer). Project-specific prompts let you add custom instructions that reflect your project's architecture, conventions, and testing requirements.

## How It Works

Project prompts are **additive** — they augment the built-in instructions, they don't replace them. When an agent is spawned, the orchestrator loads your prompt file from the repository and injects it as a `## Project-Specific Instructions` section in the agent's prompt.

The built-in safety preamble, output format, and verdict structure are always preserved. Your project instructions appear after the role-specific instructions and before the issue/PR data.

## Configuration

Add a `prompts` section to your `.agentflow.yaml` (in the target repository root):

```yaml
version: 1
prompts:
  researcher: ".agentflow/prompts/researcher.md"
  developer: ".agentflow/prompts/developer.md"
  reviewer: ".agentflow/prompts/reviewer.md"
```

Or configure centrally in `agentflow.yaml`:

```yaml
repos:
  my-backend:
    url: "https://github.com/org/my-backend"
    labels: ["agentflow"]
    prompts:
      researcher: ".agentflow/prompts/researcher.md"
      developer: ".agentflow/prompts/developer.md"
      reviewer: ".agentflow/prompts/reviewer.md"
```

In-repo `.agentflow.yaml` values override central config values.

### Supported Roles

| Role | When it runs | Typical instructions |
|------|-------------|---------------------|
| `researcher` | RESEARCHING state | Domain context, where to look, what to focus on |
| `developer` | IN_PROGRESS state | Coding conventions, API patterns, required tests |
| `reviewer` | IN_REVIEW state | What to verify, which commands to run, acceptance standards |
| `planner` | PLANNING state | Decomposition strategy, sub-task granularity |

## Writing Effective Prompts

### Reviewer Prompt Example

```markdown
## Testing Requirements

Before submitting your verdict, run the following:

1. `cargo test` — all Rust tests must pass
2. `npx vitest run` — all TypeScript tests must pass
3. `npx eslint . --max-warnings 0` — no lint warnings

Include the test output in your findings.

## Architecture Rules

- Tauri IPC commands live in `src-tauri/src/commands.rs`
- Frontend services go in `src/services/`, never in components
- All database operations go through the `db` module, never direct SQL in commands
```

### Developer Prompt Example

```markdown
## Conventions

- Use Tauri v2 IPC patterns (`invoke` from `@tauri-apps/api/core`)
- Run `cargo fmt` and `cargo clippy` before committing
- Every new Rust command needs a unit test in the same file
- Every new TypeScript service needs a `.test.ts` file

## Project Structure

- `src-tauri/src/commands.rs` — Tauri IPC command handlers
- `src-tauri/src/db.rs` — SQLite database layer
- `src/services/` — TypeScript business logic (no UI)
- `src/components/` — React components (no business logic)
```

### Researcher Prompt Example

```markdown
This is a Tauri v2 desktop application with:
- Rust backend (`src-tauri/`) for system operations and SQLite
- React + TypeScript frontend with TanStack Router and TanStack Query
- Plugin architecture: all integrations implement port interfaces in `src/ports/`

When analyzing an issue, check both the Rust and TypeScript sides.
Always note which port interfaces are affected.
```

## Directory Convention

We recommend this layout in your repository:

```
repo-root/
├── .agentflow.yaml          # In-repo config (prompts section)
└── .agentflow/
    └── prompts/
        ├── researcher.md
        ├── developer.md
        └── reviewer.md
```

## Behavior

- **Missing files are skipped** — if a configured prompt file doesn't exist, the agent uses built-in instructions only. A warning is logged.
- **Default branch only** — prompt files are always read from the default branch (e.g., `main`), never from feature branches. This prevents agents from modifying their own instructions.
- **Size limit** — combined prompt file size is capped at 20 KB by default. Files exceeding the limit are truncated in declaration order. Override with `max_project_prompt_bytes`:

    ```yaml
    # Central config (agentflow.yaml)
    repos:
      my-backend:
        max_project_prompt_bytes: 40960  # 40 KB

    # Or in-repo (.agentflow.yaml)
    version: 1
    max_project_prompt_bytes: 40960
    ```
- **Security** — project instructions are wrapped in untrusted input boundaries, the same defense used for context documents.

## Interaction with Other Config

Project prompts work alongside existing customization options:

| Feature | Purpose | Overlap? |
|---------|---------|----------|
| `context_docs` | Inject reference documents (architecture, contributing guides) | No — context docs provide background; prompts provide instructions |
| `review_checklist` | Inline review checklist | Partially — both are included when both are configured. Use `review_checklist` for a simple list, `prompts.reviewer` for detailed instructions |
| `checks` | Verification commands (lint, test) | No — checks are run by the developer/reviewer; prompts tell them *how* to interpret results |
| `reviewers.dimensions[].focus` | Per-dimension reviewer focus | No — `focus` is dimension-specific; `prompts.reviewer` applies to all dimensions |

## See Also

- [Configuration](../configuration.md) — full config reference
- [Review Policies](policies.md) — review dimensions and consensus
- [Agents](../how-it-works/agents.md) — agent types and lifecycle
