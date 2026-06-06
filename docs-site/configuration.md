# Configuration

Agentflow is configured via a YAML file (`config/agentflow.yaml`). Copy the example and adjust for your project:

```bash
cp config/agentflow.example.yaml config/agentflow.yaml
```

Pass an alternative path with `--config`:

```bash
npx agentflow start --config path/to/agentflow.yaml
```

Configuration supports hot-reloading via file watcher, `SIGHUP` signal, or `POST /reload`. Changes to `github.token_env` and `server.port`/`host` require a restart.

## Repos

The `repos` section maps repository keys to their configuration. Each key is a short name you choose.

```yaml
repos:
  backend-api:
    url: "https://github.com/org/backend-api"
    labels:
      - "agentflow"
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | Repository URL — `owner/repo`, `github.com/owner/repo`, `https://github.com/owner/repo`, or any `https://<host>/owner/repo` (self-hosted GitLab) |
| `labels` | string[] | Labels that mark issues/tickets for Agentflow to process |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `scm` | enum | `"github"` | SCM provider for this repo: `"github"` or `"gitlab"`. When set to `"gitlab"`, a `gitlab:` block is required — see [GitLab repos](#gitlab-repos) below |
| `model` | string | provider default | AI model override (e.g., `claude-haiku-4-5-20251001`) |
| `provider` | string | `"claude"` | CLI provider name (`claude`, `codex`, `gemini`, `opencode-copilot`, `opencode-openrouter`) |
| `setup` | string | — | Shell command to run before tests (e.g., `pnpm install`) |
| `checks` | object | — | Named check commands: `{ lint: "pnpm lint", test: "pnpm test" }` |
| `ci_check_method` | enum | `"checks"` | How to detect CI status: `"checks"` (Check Runs API — requires classic PAT), `"status"` (Commit Status API — works with fine-grained PATs), or `"none"` (skip CI) |
| `ci_verdict_gate` | boolean | `true` | Model the CI result as a verdict and require it to pass before reviewers are spawned. See [CI and Fix Iterations](#ci-and-fix-iterations) |
| `max_fix_iterations` | number | `5` | Unified developer-fix limit (CI + review) before quarantine, used when `ci_verdict_gate` is enabled (minimum: 1) |
| `merge_strategy` | enum | `"squash"` | PR merge strategy: `"squash"`, `"merge"`, or `"rebase"` |
| `auto_merge` | object | disabled | Merge the PR automatically when all gates pass. See [Auto-Merge](#auto-merge) |
| `context_docs` | string[] | — | File paths or URLs for context documents passed to agents |
| `review_checklist` | string | — | Custom Markdown checklist for reviewers |
| `max_ci_failures` | number | `3` | Max CI retries before quarantine — only used when `ci_verdict_gate: false` (minimum: 1) |
| `max_concurrent_development` | number | `1` | Max concurrent new-development agents per repo (minimum: 1) — see [Development WIP Limit](how-it-works/agents.md#development-wip-limit) |
| `ci_zero_check_grace_period_s` | number | — | Grace period (seconds) when no CI status is set yet |
| `agent_image` | string | — | Custom container image for agent pods (Kubernetes only) — see [Custom Agent Images](setup/custom-images.md) |
| `work_item_provider` | enum | `"github"` | Work item source: `"github"` or `"jira"` |
| `prompts` | object | — | Per-role prompt file paths: `{ researcher: "path", developer: "path", reviewer: "path", planner: "path" }` — see [Project-Specific Prompts](customization/project-prompts.md) |
| `max_project_prompt_bytes` | number | `20480` | Max combined byte size of project-specific prompt files per agent run. Files exceeding the limit are truncated with a warning (minimum: 1) |
| `application_secrets` | object | — | External service credentials for the target application — see [Application Secrets](customization/application-secrets.md) |

### GitLab repos

To use a self-hosted GitLab project as a repo source, set `scm: gitlab` and add a `gitlab:` block:

```yaml
repos:
  platform:
    url: "https://git.example.com/namespace/platform"
    labels:
      - "agentflow"
    scm: gitlab
    gitlab:
      base_url: "https://git.example.com"
      project_id: 42
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `base_url` | string | yes | Root URL of the GitLab instance |
| `project_id` | number | yes | Numeric GitLab project ID (found in the project's Settings page) |
| `webhook_signature` | enum | no | Signature scheme for incoming webhooks: `"hmac"` (HMAC-SHA256 over the body, preferred) or `"token"` (shared `X-Gitlab-Token`) |
| `merge_method` | enum | no | MR merge strategy: `"squash"`, `"merge"`, or `"rebase"` (default: `"merge"`) |
| `remove_source_branch` | boolean | no | Delete the source branch after merging (default: `true`) |

**Label pre-creation:** At startup, Agentflow automatically creates the `agent:*` label family on every GitLab project that needs it. If label creation fails (for example, due to insufficient token permissions), the orchestrator refuses to start and logs a clear error identifying the affected repo.

**Token:** GitLab repos require a Group or Project Access Token with `api` and `write_repository` scopes. It is resolved from a **per-repo env var** named `<REPOKEY>_GITLAB_TOKEN` (e.g. repo key `platform` → `PLATFORM_GITLAB_TOKEN`), so repos in different groups can use distinct tokens. Inject it via `agentflow auth setup` — see [Authentication > GitLab](authentication.md#gitlab) for the naming rule and rotation behavior.

**`ci_check_method`:** GitLab does not split CI results into "check runs" and "commit statuses." Leave `ci_check_method` unset (or set it to `"none"`) for GitLab repos.

### CI and Fix Iterations

By default the **CI Verdict Gate** is enabled (`ci_verdict_gate: true`). The CI pipeline result is modeled as a verdict dimension (`ci_pipeline`): CI must produce a green result before AI reviewers are spawned (phased execution), and CI failures and review rejections share a single **unified fix counter**, `max_fix_iterations` (default 5). Each developer fix cycle — whether triggered by a CI failure or a review rejection — increments this one counter; quarantine happens when it is exhausted.

```yaml
repos:
  myproject:
    url: "github.com/org/repo"
    labels: ["agentflow"]
    ci_verdict_gate: true      # default
    max_fix_iterations: 5      # default — covers both CI and review fixes
```

When the gate is **disabled** (`ci_verdict_gate: false`), reviewers start immediately after the PR is opened without waiting for CI, and the two legacy counters apply independently instead: `max_ci_failures` (default 3) for CI retries and `max_review_iterations` (default 3, see [Reviewers](#reviewers)) for review rounds.

| | CI Verdict Gate **enabled** (default) | CI Verdict Gate **disabled** |
|--|--|--|
| Reviewers spawned | after CI passes (phased) | immediately, in parallel with CI |
| Fix counter | unified `max_fix_iterations` (5) | separate `max_ci_failures` (3) + `max_review_iterations` (3) |

When `ci_check_method: "none"`, the gate is implicitly disabled — there are no check runs to evaluate.

### Auto-Merge

By default Agentflow does **not** merge automatically: when all gates pass, the owner is notified and merges manually (`WAITING_OWNER` → owner merges → `DONE`). Auto-merge is opt-in per repo:

```yaml
repos:
  myproject:
    url: "github.com/org/repo"
    labels: ["agentflow"]
    auto_merge:
      enabled: true           # default: false
      strategy: squash        # squash | merge | rebase
      delete_branch: true
      max_merge_retries: 3
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Merge the PR automatically when the consensus verdict across all gates is `APPROVE` |
| `strategy` | enum | repo `merge_strategy` | Merge strategy: `"squash"`, `"merge"`, or `"rebase"` |
| `delete_branch` | boolean | — | Delete the source branch after merge |
| `max_merge_retries` | number | `3` | Retry attempts if the merge call fails (minimum: 1) |

When enabled, the owner receives an informational notification after the merge rather than an actionable one. If the merge fails (e.g., a conflict appeared), the orchestrator falls back to notifying the owner.

### Reviewers

Configure review behavior per repo:

```yaml
repos:
  myproject:
    url: "github.com/org/repo"
    labels: ["agentflow"]
    reviewers:
      consensus_policy: all_approve
      max_review_iterations: 3
      max_reviewer_retries: 1
      dimensions:
        - name: code_quality
          model: "claude-haiku-4-5-20251001"
          provider: "claude"
        - name: issue_fulfillment
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `consensus_policy` | enum | `"all_approve"` | `"all_approve"`, `"majority_approve"`, or `"any_approve"` |
| `max_review_iterations` | number | `3` | Max review rounds before quarantine — only used when `ci_verdict_gate: false`; otherwise the unified `max_fix_iterations` applies (minimum: 1) |
| `max_reviewer_retries` | number | `0` | Retry attempts on reviewer provider failures |
| `dimensions` | array | code_quality + issue_fulfillment | Review dimensions (see below) |

Each dimension:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Dimension name (e.g., `code_quality`, `issue_fulfillment`) |
| `focus` | string | no | Additional focus instructions for this dimension |
| `model` | string | no | Per-dimension model override |
| `provider` | string | no | Per-dimension provider override |

### Architecture Guardian

Enable static architecture checks on PRs:

```yaml
repos:
  myproject:
    url: "github.com/org/repo"
    labels: ["agentflow"]
    architecture_guardian:
      enabled: true
      adrs:
        - "https://example.com/adr-001"
      rules:
        - pattern: "packages/core/src/**/*.ts"
          forbidden_imports: ["@agentflow/github"]
          message: "Core must not import GitHub-specific code"
      model: "claude-haiku-4-5-20251001"
      provider: "claude"
```

### Planner Criteria

Configure when the Planner Agent runs:

```yaml
repos:
  myproject:
    url: "github.com/org/repo"
    labels: ["agentflow"]
    planner_criteria:
      label: "epic"
      body_length_threshold: 500
```

### Jira Work Item Provider

When using Jira instead of GitHub Issues:

```yaml
repos:
  myproject:
    url: "github.com/org/repo"
    labels: ["agentflow"]
    work_item_provider: jira
    jira:
      project_key: PROJ
      cloud_url: https://myorg.atlassian.net
      jql_filter: "component = backend"
      state_mapping:
        OPEN: "To Do"
        CLAIMED: "In Progress"
        PLANNING: "In Progress"
        PLANNED: "In Progress"
        RESEARCHING: "In Progress"
        IN_PROGRESS: "In Progress"
        PR_OPEN: "In Progress"
        IN_REVIEW: "In Review"
        CHANGES_REQUESTED: "In Progress"
        APPROVED: "In Review"
        WAITING_OWNER: "In Review"
        DONE: "Done"
        FAILED: "Done"
        QUARANTINED: "Done"
```

Jira configuration fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `project_key` | string | yes | Jira project key (e.g., `PROJ`) |
| `cloud_url` | string | yes | Jira Cloud instance URL (e.g., `https://myorg.atlassian.net`) |
| `state_mapping` | object | no | Maps Agentflow states to Jira board statuses for visual projection (defaults shown above) |
| `jql_filter` | string | no | Additional JQL clause appended to generated queries |

Workflow state is tracked via `agent:*` labels in the Jira `labels` field — the same mechanism as GitHub. The `state_mapping` controls an additional **best-effort Jira status projection** for human board visibility. Multiple Agentflow states can project to the same Jira status.

### Application Secrets

Inject external service credentials into agent pods for testing integrations:

```yaml
repos:
  cockpit:
    url: "github.com/org/cockpit"
    labels: ["agentflow"]
    application_secrets:
      secret_name: cockpit-test-secrets
      env:
        - name: JIRA_API_TOKEN
          key: jira-api-token
        - name: JIRA_EMAIL
          key: jira-email
        - name: DATABASE_URL
          key: database-url
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `secret_name` | string | K8s only | Kubernetes Secret name containing the values |
| `env` | array | yes | Environment variables to inject into agent processes |
| `env[].name` | string | yes | Env var name (e.g., `JIRA_API_TOKEN`) |
| `env[].key` | string | no | Key within the K8s Secret. Defaults to `name` lowercased with `_` → `-` |

In Kubernetes, the referenced Secret is mounted into agent pods. In Local and Docker modes, the orchestrator passes through host environment variables matching the `env[].name` values. See [Application Secrets](customization/application-secrets.md) for details.

## Providers

Define how Agentflow invokes each AI CLI tool. Built-in defaults exist for Claude, Codex, and Gemini — you only need this section to override them. opencode providers must be declared explicitly.

```yaml
providers:
  claude:
    command: "claude"
    args: ["--print"]
    model_flag: "--model"
    timeout_seconds: 300
    blocked_env_vars: ["CLAUDECODE"]
    max_concurrent_agents: 3
    role_args:
      research: ["--dangerously-skip-permissions"]
      developer: ["--dangerously-skip-permissions"]
  codex:
    command: "codex"
    args: ["exec"]
    model_flag: "--model"
    role_args:
      research: ["--full-auto"]
      developer: ["--full-auto"]
  gemini:
    command: "gemini"
    args: []
    model_flag: "-m"
    prompt_flag: "-p"
    timeout_seconds: 600
    env:
      GEMINI_SANDBOX: "false"
    role_args:
      research: ["--yolo"]
      developer: ["--yolo"]
  # opencode providers (GITHUB_COPILOT_TOKEN / OPENROUTER_API_KEY)
  # See: docs/setup/opencode.md
  opencode-copilot:
    command: "opencode"
    args: ["run", "--dangerously-skip-permissions"]
    model_flag: "--model"
    timeout_seconds: 600
  opencode-openrouter:
    command: "opencode"
    args: ["run", "--dangerously-skip-permissions"]
    model_flag: "--model"
    timeout_seconds: 600
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | string | yes | CLI command name |
| `args` | string[] | yes | Base CLI arguments |
| `model_flag` | string | no | Flag for model selection (`--model`, `-m`) |
| `prompt_flag` | string | no | Flag for prompt input (Gemini uses `-p`) |
| `timeout_seconds` | number | no | Execution timeout (default: 300, Gemini: 600) |
| `env` | object | no | Extra environment variables |
| `blocked_env_vars` | string[] | no | Env vars to strip from agent invocations |
| `max_concurrent_agents` | number | no | Concurrency cap for this provider |
| `role_args` | object | no | Per-role argument overrides (see below) |
| `circuit_breaker` | object | no | Circuit breaker tuning ([details](customization/providers.md#circuit-breaker)) |

Role args keys: `research`, `developer`, `reviewer`, `planner`. Each maps to an array of additional CLI arguments.

## Agents

Define the agent pool — which providers handle which roles for which repos:

```yaml
agents:
  researchers:
    - name: claude-researcher
      provider: claude
      repos: ["*"]
  developers:
    - name: claude-developer
      provider: claude
      repos: ["*"]
      model: "claude-sonnet-4-6"
  reviewers:
    - name: claude-code-reviewer
      provider: claude
      repos: ["*"]
      dimension: code_quality
    - name: codex-issue-reviewer
      provider: codex
      repos: ["backend-*"]
      dimension: issue_fulfillment
  planners:
    - name: claude-planner
      provider: claude
      repos: ["*"]
```

Each agent entry:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Unique agent instance name |
| `provider` | string | yes | Provider name from `providers` section |
| `repos` | string[] | yes | Repo patterns (`*` wildcard supported) |
| `model` | string | no | Model override |
| `dimension` | string | no | Review dimension (reviewers only) |
| `focus` | string[] | no | Additional focus areas (reviewers only) |

If `agents` is omitted, Agentflow creates one default researcher and one default developer.

## Orchestrator

Configure polling intervals (in seconds):

```yaml
orchestrator:
  intervals:
    issue_scan: 60
    agent_poll: 10
    merge_poll: 60
    heartbeat_interval: 60
    heartbeat_ttl: 1800
    waiting_owner_reminder_interval: 172800
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `issue_scan` | number | `60` | Seconds between issue scans |
| `agent_poll` | number | `10` | Seconds between agent status checks |
| `merge_poll` | number | `60` | Seconds between merge status checks |
| `heartbeat_interval` | number | `60` | Claim heartbeat renewal interval |
| `heartbeat_ttl` | number | `1800` | Claim expiration time (30 minutes) |
| `waiting_owner_reminder_interval` | number | `172800` | Remind owner to merge (48 hours, minimum: 60) |

When webhooks are enabled, the discovery intervals `issue_scan` and `merge_poll` are automatically multiplied by 5 (they serve as fallback). `agent_poll` is unaffected.

## GitHub

Configure GitHub API authentication:

```yaml
github:
  token_env: "GITHUB_TOKEN"
  tokens:
    developer_token_env: "GITHUB_TOKEN"
    reviewer_token_env: ""
    researcher_token_env: "GITHUB_TOKEN"
    planner_token_env: "GITHUB_TOKEN"
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `token_env` | string | `"GITHUB_TOKEN"` | Env var name containing the GitHub token |
| `tokens.orchestrator_token_env` | string | inherits | Token env for the orchestrator's own GitHub API calls |
| `tokens.developer_token_env` | string | inherits | Token env for developer agents (needs push + PR scopes) |
| `tokens.reviewer_token_env` | string | inherits | Token env for reviewer agents (needs clone access to run checks) |
| `tokens.researcher_token_env` | string | inherits | Token env for research agents |
| `tokens.planner_token_env` | string | inherits | Token env for planner agents |

All agent roles inherit `GITHUB_TOKEN` by default. Per-role overrides allow using separate tokens with different scopes.

## Webhooks

Enable GitHub webhooks for real-time event processing instead of polling:

```yaml
webhooks:
  enabled: true
  secret: "your-webhook-secret"
```

When enabled, the orchestrator exposes **one webhook URL per configured repo**, following the pattern `/webhooks/github/<repoId>` where `<repoId>` is the key of the entry in `repos:`. Point each repository's GitHub webhook at its own URL.

The legacy single-endpoint URL (`/webhooks/github`) is still accepted as a backwards-compatible alias and continues to dispatch events to the orchestrator, but every delivery on it produces a deprecation warning in the orchestrator log. Migrate to the per-repo URL pattern.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | required | Enable/disable webhooks |
| `secret` | string | required if enabled | GitHub webhook secret (shared by all configured repos) |
| `path` | string | `"/webhooks/github"` | Path of the **deprecated** legacy alias — only used when an operator wants to keep an existing GitHub webhook configuration working without re-pointing it to the per-repo URL |

!!! note
    When webhooks are enabled, the discovery [polling intervals](#orchestrator) `issue_scan` and `merge_poll` are automatically multiplied by 5x — they serve as a fallback mechanism rather than the primary event source. `agent_poll` is unaffected.

## Server

Configure the HTTP server:

```yaml
server:
  port: 9090
  host: "0.0.0.0"
```

Endpoints: `/health` (liveness), `/ready` (readiness), `/metrics` (Prometheus), `/reload` (config reload).

## Jira (Global)

Global Jira configuration (in addition to per-repo settings):

```yaml
jira:
  site: "https://myorg.atlassian.net"
  project: "PROJ"
```

## Job Runner

Configure how agents are executed:

```yaml
job_runner:
  type: local
```

For Kubernetes:

```yaml
job_runner:
  type: kubernetes
  kubernetes:
    namespace: agentflow
    image: "registry.example.com/agentflow:latest"
    image_pull_policy: IfNotPresent
    agent_runner_path: "packages/agents/src/runner.ts"
    active_deadline_seconds: 3600
    service_account_name: agentflow
    credential_secret_name: agentflow
    resources:
      requests:
        cpu: "100m"
        memory: "256Mi"
      limits:
        cpu: "1"
        memory: "2Gi"
    resources_by_role:
      research:
        requests: { cpu: "100m", memory: "256Mi" }
        limits: { cpu: "500m", memory: "1Gi" }
      developer:
        requests: { cpu: "250m", memory: "512Mi" }
        limits: { cpu: "1", memory: "2Gi" }
      reviewer:
        requests: { cpu: "100m", memory: "256Mi" }
        limits: { cpu: "500m", memory: "1Gi" }
    topology_spread_constraints:
      - max_skew: 1
        topology_key: "kubernetes.io/hostname"
        when_unsatisfiable: "ScheduleAnyway"
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | enum | `"local"` | `"local"` or `"kubernetes"` |
| `kubernetes.namespace` | string | required | K8s namespace for agent Jobs |
| `kubernetes.image` | string | required | Container image for agents |
| `kubernetes.image_pull_policy` | enum | `"IfNotPresent"` | `"Always"`, `"IfNotPresent"`, `"Never"` |
| `kubernetes.agent_runner_path` | string | `"packages/agents/src/runner.ts"` | Path to runner inside container |
| `kubernetes.active_deadline_seconds` | number | `3600` | Job timeout (1 hour) |
| `kubernetes.service_account_name` | string | — | K8s ServiceAccount for pods |
| `kubernetes.credential_secret_name` | string | `"agentflow"` | K8s Secret name for credentials |
| `kubernetes.resources` | object | — | Default resource requests/limits |
| `kubernetes.resources_by_role` | object | — | Per-role resource overrides (`research`, `developer`, `reviewer`, `planner`) |
| `kubernetes.topology_spread_constraints` | array | — | [Topology spread constraints](#topology-spread-constraints) for agent pods |

### Topology Spread Constraints

Spread agent pods across topology domains (nodes, zones) to improve cluster utilization and resilience. Each constraint is applied to all agent pods created by the job runner. The label selector is set automatically to `agentflow.io/type: agent-job`.

```yaml
topology_spread_constraints:
  - max_skew: 1
    topology_key: "kubernetes.io/hostname"
    when_unsatisfiable: "ScheduleAnyway"
```

| Field | Type | Description |
|-------|------|-------------|
| `max_skew` | integer (>= 1) | Maximum difference in pod count between any two topology domains |
| `topology_key` | string | Node label key for topology domain (e.g., `kubernetes.io/hostname` for per-node, `topology.kubernetes.io/zone` for per-zone) |
| `when_unsatisfiable` | enum | `"ScheduleAnyway"` (soft preference) or `"DoNotSchedule"` (hard requirement) |

Use `ScheduleAnyway` for best-effort spreading that won't block scheduling when nodes are full. Use `DoNotSchedule` to enforce strict distribution across domains.

## Full Example

See `config/agentflow.example.yaml` in the repository root for a complete annotated example.
