# AI Providers

Agentflow supports multiple AI providers that can be mixed and matched across your agent pool. Agents interact with AI through CLI tools — never direct API calls.

## Supported Providers

| Provider | CLI Tool | Auth Method | Default Timeout |
|----------|----------|-------------|----------------|
| Claude | `claude` | OAuth token (~1 year) | 300s |
| Codex | `codex` | Device auth flow | 300s |
| Gemini | `gemini` | OAuth PKCE flow | 600s |

## Provider Configuration

Each provider is defined in the `providers` section of `agentflow.yaml`. Built-in defaults exist for all three — you only need to override what you want to change.

### Claude (Default)

```yaml
providers:
  claude:
    command: "claude"
    args: ["--print"]
    model_flag: "--model"
    blocked_env_vars: ["CLAUDECODE"]
    role_args:
      research: ["--dangerously-skip-permissions"]
      developer: ["--dangerously-skip-permissions"]
```

`--dangerously-skip-permissions` allows the research and developer agents to read/write files without interactive confirmation. Reviewer agents don't get this flag — they operate in read-only mode.

`blocked_env_vars: ["CLAUDECODE"]` strips the `CLAUDECODE` variable from agent invocations to prevent interference with the CLI.

### Codex

```yaml
providers:
  codex:
    command: "codex"
    args: ["exec"]
    model_flag: "--model"
    role_args:
      research: ["--full-auto"]
      developer: ["--full-auto"]
```

`--full-auto` enables autonomous execution without user confirmation prompts.

### Gemini

```yaml
providers:
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
```

`GEMINI_SANDBOX: "false"` prevents Docker-in-Docker sandbox hangs when running inside containers.

`timeout_seconds: 600` gives Gemini extra time — it's typically slower than Claude or Codex.

## Custom Provider Fields

| Field | Type | Description |
|-------|------|-------------|
| `command` | string | CLI command name |
| `args` | string[] | Base arguments passed to every invocation |
| `model_flag` | string | Flag for model selection (e.g., `--model`, `-m`) |
| `prompt_flag` | string | Flag for prompt input (only Gemini uses this) |
| `timeout_seconds` | number | Execution timeout per agent invocation |
| `env` | object | Extra environment variables for the CLI process |
| `blocked_env_vars` | string[] | Env vars to strip from agent invocations |
| `max_concurrent_agents` | number | Concurrency cap for this provider |
| `role_args` | object | Per-role argument overrides |
| `circuit_breaker` | object | Circuit breaker tuning (see below) |

### Circuit Breaker

Each provider has a built-in circuit breaker that pauses agent spawns when the provider is unavailable (e.g., usage cap hit, rate limit, overload). You can tune its sensitivity per provider.

| Field | Type | Default | Constraints | Description |
|-------|------|---------|-------------|-------------|
| `consecutive_failure_threshold` | integer | `3` | min 1 | Provider-level failures before the breaker opens |
| `probe_interval_seconds` | integer | `300` | min 10 | Seconds between recovery probes when open |

If the provider's error message includes a reset time (e.g., Claude's "resets 10pm (UTC)"), the breaker uses that instead of `probe_interval_seconds`. When a breaker is open, the orchestrator automatically wakes up at the probe time — even if rate-limit throttling would otherwise cause a longer sleep.

```yaml
providers:
  claude:
    command: "claude"
    args: ["--print"]
    circuit_breaker:
      consecutive_failure_threshold: 2    # open quickly — Claude's usage cap is predictable
      probe_interval_seconds: 1800        # probe every 30 min
  gemini:
    command: "gemini"
    args: []
    circuit_breaker:
      consecutive_failure_threshold: 5    # tolerate brief API hiccups
      probe_interval_seconds: 120         # recover quickly from real outages
```

Omitting `circuit_breaker` entirely uses the defaults (threshold 3, probe interval 300s). Providing an empty `circuit_breaker: {}` also applies the defaults.

### Role Arguments

`role_args` lets you pass different CLI flags depending on the agent's role:

```yaml
role_args:
  research: ["--dangerously-skip-permissions"]
  developer: ["--dangerously-skip-permissions"]
  reviewer: []    # read-only, no special flags
  planner: ["--dangerously-skip-permissions"]
```

## Mixing Providers

You can assign different providers to different agent roles and repos using the `agents` section:

```yaml
agents:
  researchers:
    - name: claude-researcher
      provider: claude
      repos: ["*"]
  developers:
    - name: codex-developer
      provider: codex
      repos: ["backend-*"]
    - name: claude-developer
      provider: claude
      repos: ["frontend-*"]
  reviewers:
    - name: claude-code-reviewer
      provider: claude
      repos: ["*"]
      dimension: code_quality
    - name: gemini-issue-reviewer
      provider: gemini
      repos: ["*"]
      dimension: issue_fulfillment
```

Repo patterns support `*` wildcards. Each agent entry specifies:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique agent instance name |
| `provider` | string | Provider from the `providers` section |
| `repos` | string[] | Repo patterns to match |
| `model` | string | Optional model override |
| `dimension` | string | Review dimension (reviewers only) |

## Per-Repo Provider Override

Override the provider or model for a specific repo:

```yaml
repos:
  backend:
    url: "github.com/org/backend"
    labels: ["agentflow"]
    provider: "codex"
    model: "o3-mini"
  frontend:
    url: "github.com/org/frontend"
    labels: ["agentflow"]
    provider: "claude"
```

## Per-Dimension Provider Override

Override the provider or model for specific review dimensions:

```yaml
repos:
  myproject:
    url: "github.com/org/repo"
    labels: ["agentflow"]
    reviewers:
      dimensions:
        - name: code_quality
          provider: "claude"
          model: "claude-haiku-4-5-20251001"
        - name: issue_fulfillment
          provider: "codex"
```

## Installing CLI Tools

All three CLI tools are available as npm packages:

```bash
# Claude
npm install -g @anthropic-ai/claude-code

# Codex
npm install -g @openai/codex

# Gemini
npm install -g @google/gemini-cli
```

The Agentflow Docker image includes all three pre-installed.
