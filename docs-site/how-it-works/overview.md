# How It Works

Agentflow is an autonomous software development pipeline. It connects your issue tracker to AI-powered agents that research, implement, and review code changes.

## Architecture

```mermaid
graph TD
    subgraph External["External Systems"]
        Issues["Issue Tracker<br/>(GitHub Issues / Jira)"]
        GitHub["GitHub<br/>(PRs, CI, Code)"]
        Owner["Human Owner"]
    end

    subgraph Agentflow["Agentflow"]
        Orch["Orchestrator<br/>(deterministic, no LLM)"]
        WIP["Work Item Provider"]
        JR["Job Runner"]

        subgraph Agents["Agent Pool"]
            RA["Research Agent"]
            DA["Developer Agent"]
            RevA["Code Quality Reviewer"]
            RevB["Issue Fulfillment Reviewer"]
        end

        subgraph CLI["CLI Providers"]
            Claude["claude"]
            Codex["codex"]
            Gemini["gemini"]
        end
    end

    Owner -->|creates issues| Issues
    Orch -->|reads/writes via| WIP
    WIP --> Issues
    Orch -->|spawns via| JR
    JR --> Agents
    Agents -->|invoke| CLI
    DA -->|creates PRs| GitHub
    RA -->|posts summaries| Issues
    RevA -->|posts verdicts| GitHub
    RevB -->|posts verdicts| GitHub
    Owner -->|merges PRs| GitHub
```

The system consists of:

- **Orchestrator** — a deterministic controller (no LLM) that manages workflow state and spawns agents. It never calls AI providers directly.
- **Work Item Provider** — abstraction over GitHub Issues or Jira. The orchestrator reads and writes work items through this interface.
- **Job Runner** — abstraction for agent execution. Supports local OS processes, Docker containers, and Kubernetes Jobs.
- **CLI Providers** — agents interact with AI through CLI tools (`claude`, `codex`, `gemini`), never direct API calls.

## Pipeline

Each work item flows through six stages (Plan is optional):

```mermaid
graph LR
    Scan["1. Scan & Claim"] --> Plan["2. Plan (optional)"]
    Plan --> Research["3. Research"]
    Research --> Implement["4. Implement"]
    Implement --> Review["5. Review"]
    Review -->|Approved| Merge["6. Merge"]
    Review -->|Changes Requested| Implement
```

### 1. Scan and Claim

The orchestrator polls the issue tracker for actionable work items (matching labels/filters, no unresolved dependencies). When found, it atomically claims the item — setting an `agent:*` label and assignee with a heartbeat TTL to prevent duplicate work. The same labels are used for both GitHub and Jira (stored as GitHub labels or Jira `labels` field respectively).

### 2. Plan (Optional)

If the issue matches planner criteria (configured label or body length threshold), a **Planner Agent** is spawned before research. It breaks the issue into sub-issues with dependency ordering. The orchestrator then processes each sub-issue independently through the remaining pipeline stages.

See [Configuration > Planner Criteria](../configuration.md#planner-criteria).

### 3. Research

A **Research Agent** is spawned with a fresh context window. It:

- Reads the issue description and any linked context documents
- Explores the codebase to understand relevant code
- Produces a structured research summary, posted as a comment on the work item

The research summary becomes the input for the next stage.

### 4. Implement

A **Developer Agent** is spawned with a fresh context (no memory of the research agent's session). It receives the research summary and:

1. Clones the repository
2. Creates a branch (`agent/<issue-number>-<slug>`)
3. Implements the changes
4. Runs local checks (setup commands, lint, test)
5. Commits and pushes
6. Creates or updates a pull request

If CI fails, the orchestrator re-spawns the developer agent with CI failure context (up to the configured `max_ci_failures` before quarantine).

When multiple agents are waiting for a pool slot, the orchestrator prioritizes agents closest to pipeline completion — merge agents before CI fixes, CI fixes before review fixes, and so on. To prevent cascading merge conflicts, new development is limited to one ticket at a time per repo by default (`max_concurrent_development`). See [Agents > Spawn Priority](agents.md#spawn-priority) and [Development WIP Limit](agents.md#development-wip-limit) for details.

### 5. Review

**Reviewer Agents** are spawned in parallel, each with a fresh context. By default, two dimensions are evaluated:

- **Code Quality** — style, security, tests, best practices
- **Issue Fulfillment** — does the PR fully resolve the original issue?

Each reviewer produces a binary verdict: `APPROVE` or `REQUEST_CHANGES`. Malformed verdicts default to `REQUEST_CHANGES` (fail-safe).

The orchestrator applies the configured consensus policy:

| Policy | Rule |
|--------|------|
| `all_approve` (default) | Every reviewer must approve |
| `majority_approve` | More than 50% must approve (tie = reject) |
| `any_approve` | At least one approval is sufficient |

On rejection, the developer agent is re-spawned with review feedback. Previous approvals are invalidated — all reviewers re-evaluate. This repeats up to `max_review_iterations` (default: 3) before quarantine.

The optional **Architecture Guardian** can veto a PR independently of the reviewer consensus — it checks import rules and ADR compliance. See [Review Policies > Architecture Guardian](../customization/policies.md#architecture-guardian).

### 6. Merge

After all reviewers approve, the orchestrator notifies the human owner. The PR is ready for merge — Agentflow **never merges automatically**. The owner reviews and merges at their discretion.

After merge, the orchestrator closes the work item and marks it done.

## Fresh Context Per Step

Each pipeline step spawns a **new agent instance** with a fresh context window. Agents don't share memory. All inter-step communication happens through work item artifacts:

- Research summary → issue comment
- Review feedback → PR comment
- CI failure output → agent context

This ensures reproducibility and prevents context window bloat across long-running pipelines.

## Recovery After Restart

If the orchestrator restarts, it reconstructs in-flight state by scanning work items with active labels/statuses:

- Items in `CLAIMED` / `RESEARCHING` / `IN_PROGRESS` — checks heartbeat TTL and reclaims if orphaned
- Items in `PR_OPEN` — resumes CI polling
- Items in `IN_REVIEW` — resumes review polling
- Items in `WAITING_OWNER` — resumes merge polling

Orphaned agent processes (from the crash) finish independently. The orchestrator re-evaluates state from artifacts rather than re-spawning agents unnecessarily.
