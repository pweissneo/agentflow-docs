# opencode Setup

How to drive Agentflow agents through [opencode](https://opencode.ai), a headless AI coding CLI. Two backends are supported: **GitHub Copilot** and **OpenRouter**. Both can be active at the same time using the two-provider pattern.

## How opencode fits in

opencode is an AI coding CLI that routes requests to model providers. Agentflow spawns it headlessly (`opencode run --format json`) the same way it spawns Claude, Codex, and Gemini. No extra infrastructure is needed: credentials are passed as environment variables, and no auth file is written to disk.

Both opencode backends use stateless, env-var-only authentication. Tokens are read fresh on every invocation and never cached to disk by opencode.

---

## Using GitHub Copilot via opencode

### Prerequisites

- A GitHub account with an active [GitHub Copilot](https://github.com/features/copilot) subscription (Individual, Business, or Enterprise).
- A GitHub OAuth token (`gho_...`) obtained via `gh auth login`.

!!! warning "PATs are not supported"
    Classic PATs (`ghp_...`) and fine-grained PATs (`github_pat_...`) are rejected by the GitHub Copilot API with "Personal Access Tokens are not supported for this endpoint." You must use an OAuth token from `gh auth login`.

    To get one: run `gh auth login` in a terminal (one-time browser flow), then `gh auth token` to print the token.

!!! note "Token separation"
    Agentflow stores the Copilot credential as `GITHUB_COPILOT_TOKEN`, separate from `GITHUB_TOKEN` (used for SCM access). This lets you use a different GitHub account for Copilot than for pushing code. If you use the same account for both, you can reuse the same token value for both variables.

### 1. Authenticate

```bash
npx agentflow auth setup --config config/agentflow.yaml
```

When prompted for `opencode-copilot`, enter your OAuth token (`gho_...` from `gh auth token`). Agentflow verifies it against the Copilot API and writes `GITHUB_COPILOT_TOKEN` to `.env.docker`.

For Kubernetes:

```bash
npx agentflow auth setup --config config/agentflow.yaml --target k8s
```

### 2. Configure

Add an `opencode-copilot` provider block and reference it in `agents`:

```yaml
providers:
  opencode-copilot:
    command: "opencode"
    args: ["run", "--dangerously-skip-permissions"]
    model_flag: "--model"
    timeout_seconds: 600

agents:
  developers:
    - name: copilot-developer
      provider: opencode-copilot
      model: "github-copilot/gpt-4o"
      repos: ["*"]
  researchers:
    - name: copilot-researcher
      provider: opencode-copilot
      model: "github-copilot/gpt-4o"
      repos: ["*"]
```

Available Copilot models (depends on your subscription tier):

| Model ID | Notes |
|----------|-------|
| `github-copilot/gpt-4o` | Recommended for developer and researcher roles |
| `github-copilot/gpt-4.1` | Latest GPT-4 generation |
| `github-copilot/claude-sonnet-4-5` | Anthropic Claude via Copilot |

### 3. Verify

```bash
npx agentflow auth verify
```

Look for `opencode-copilot: ok` in the output, along with the number of models available on your subscription.

### Credential reference

| Variable | Secret key | Description |
|----------|------------|-------------|
| `GITHUB_COPILOT_TOKEN` | `github-copilot-token` | OAuth token (`gho_...` from `gh auth token`) from the GitHub account with Copilot access |

At runtime, `OpencodeCliProvider` remaps `GITHUB_COPILOT_TOKEN` to `GITHUB_TOKEN` inside the opencode subprocess. Your SCM `GITHUB_TOKEN` is unaffected.

---

## Using OpenRouter via opencode

### Prerequisites

- An [OpenRouter](https://openrouter.ai) account with an API key (`sk-or-v1-...`).
- If you want to run paid models, add credits at [openrouter.ai/settings/credits](https://openrouter.ai/settings/credits). Many models (including `openai/gpt-4o-mini`) are available free.

### 1. Authenticate

```bash
npx agentflow auth setup --config config/agentflow.yaml
```

When prompted for `opencode-openrouter`, enter your OpenRouter API key. Agentflow verifies it by fetching the models list and writes `OPENROUTER_API_KEY` to `.env.docker`.

### 2. Configure

```yaml
providers:
  opencode-openrouter:
    command: "opencode"
    args: ["run", "--dangerously-skip-permissions"]
    model_flag: "--model"
    timeout_seconds: 600

agents:
  developers:
    - name: openrouter-developer
      provider: opencode-openrouter
      model: "openrouter/openai/gpt-4o"
      repos: ["*"]
  researchers:
    - name: openrouter-researcher
      provider: opencode-openrouter
      model: "openrouter/openai/gpt-4o-mini"
      repos: ["*"]
```

Model IDs follow the `openrouter/<provider>/<model>` pattern. Browse the full catalog at [openrouter.ai/models](https://openrouter.ai/models).

Popular choices:

| Model ID | Notes |
|----------|-------|
| `openrouter/openai/gpt-4o` | Strong general-purpose model |
| `openrouter/openai/gpt-4o-mini` | Fast and cheap; good for research |
| `openrouter/google/gemini-2.0-flash-001` | Google Gemini via OpenRouter |

### 3. Verify

```bash
npx agentflow auth verify
```

Look for `opencode-openrouter: ok` in the output.

### Credential reference

| Variable | Secret key | Description |
|----------|------------|-------------|
| `OPENROUTER_API_KEY` | `openrouter-api-key` | API key from openrouter.ai |

---

## Two-provider pattern (recommended)

Run both backends simultaneously and assign them to different roles or repos for cost and quality control:

```yaml
providers:
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

agents:
  researchers:
    # Use a cheap OpenRouter model for research
    - name: openrouter-researcher
      provider: opencode-openrouter
      model: "openrouter/openai/gpt-4o-mini"
      repos: ["*"]
  developers:
    # Use Copilot for implementation
    - name: copilot-developer
      provider: opencode-copilot
      model: "github-copilot/gpt-4o"
      repos: ["*"]
  reviewers:
    - name: copilot-reviewer
      provider: opencode-copilot
      model: "github-copilot/gpt-4o"
      repos: ["*"]
      dimension: code_quality
```

Both providers can coexist with the native `claude`, `codex`, and `gemini` providers in the same config.

---

## Kubernetes deployment

Both opencode providers use env-var-only auth. No init container or `auth.json` mount is needed.

Helm values:

```yaml
secrets:
  githubCopilotToken: "gho_your_copilot_token"
  openrouterApiKey: "sk-or-v1-your_key"
```

Agent pods automatically receive `GITHUB_COPILOT_TOKEN` and `OPENROUTER_API_KEY` from the credentials Secret (both are optional; only the ones you set are injected).

---

!!! warning "Anthropic models via opencode"
    Routing Claude requests through opencode (via Copilot or OpenRouter) is not supported for Anthropic Pro or Max subscribers. Use the native `claude` provider instead. See [AI Providers](../customization/providers.md) for details.

## See also

- [Authentication](../authentication.md)
- [Configuration > Providers](../configuration.md#providers)
- [AI Providers customization](../customization/providers.md)
- [Kubernetes setup](kubernetes.md)
