# Authentication

Agentflow needs credentials for AI providers and your work item provider (GitHub or Jira). Credentials are generated host-side with `agentflow auth setup` and injected via `.env.docker`, a Kubernetes Secret, or stdout.

```mermaid
graph TD
    S1["agentflow auth setup<br/>(on your machine)"] --> S2["Browser OAuth flows"]
    S2 --> S3{"--target<br/>(prompts if omitted)"}
    S3 -->|env-docker| S4[".env.docker"]
    S3 -->|k8s| S5["kubectl create secret"]
    S3 -->|stdout| S6["print to stdout"]

    S4 --> ORCH["Orchestrator"]
    S5 --> ORCH
    S6 --> ORCH
    ORCH -->|local / docker| AGENT["Agent process<br/>(env vars)"]
    ORCH -->|kubernetes| BROKER["Credential Broker<br/>(per-pod secrets)"]
    BROKER --> POD["Agent pod"]

    style S1 fill:#e3f2fd
```

## `agentflow auth setup`

Runs on your machine. Detects providers from your config, runs OAuth flows, and writes credentials to `.env.docker` (Docker Compose), outputs a `kubectl create secret` command (Kubernetes), or prints to stdout.

```bash
# Prompts for the output target (env-docker, k8s, or stdout) when --target is omitted
npx agentflow auth setup --config config/agentflow.yaml

# Docker Compose target (writes .env.docker)
npx agentflow auth setup --config config/agentflow.yaml --target env-docker

# Kubernetes target
npx agentflow auth setup --config config/agentflow.yaml --target k8s

# Re-authenticate all providers
npx agentflow auth setup --config config/agentflow.yaml --force
```

!!! note "In-container `auth init` is planned, not yet available"
    A future `agentflow auth init` command will run the OAuth flows *inside* the container and store credentials on the persistent volume — convenient for interactive deployments where you don't want host-side credential handling. It is not implemented yet; use `auth setup` for now.

!!! warning
    `auth setup` requires an interactive terminal with browser access. It cannot run inside automated pipelines.

## Verifying Credentials

Check the status and expiry of existing credentials:

```bash
npx agentflow auth verify
```

This validates all configured providers and reports token expiry dates.

## Provider Authentication

### Claude

Claude uses OAuth tokens with approximately one year validity.

**Flow:** `claude setup-token` launches a browser-based OAuth flow and returns a long-lived token.

**Credential output:**

- `CLAUDE_CODE_OAUTH_TOKEN` — written to `.env.docker`, the K8s Secret (`claudeOauthToken`), or stdout depending on `--target`
- Fallback: set `ANTHROPIC_API_KEY` environment variable (API key, not OAuth)

```bash
# Manual auth (outside Agentflow)
claude setup-token
```

### Codex

Codex uses a device authorization flow.

**Flow:** `codex login --device-auth` prints a URL and device code. Open the URL in a browser, enter the code, and authorize.

**Credential output:**

- Subscription (device-auth): produces `~/.codex/auth.json`, mounted into the container (Docker Compose) or stored as the `codexAuthJson` K8s Secret key
- Fallback: set `OPENAI_API_KEY` environment variable (API key)

!!! note "Codex token rotation"
    Codex uses single-use refresh tokens — each token refresh invalidates the previous one. In Kubernetes, each agent pod needs independent credentials. The Credential Broker handles this by vending access-token-only credentials to agent pods, preventing refresh token conflicts.

### Gemini

Gemini uses a custom OAuth PKCE flow with the Gemini CLI's public client credentials.

**Flow:** A browser URL is displayed. After authorizing in the browser, paste the authorization code back into the terminal.

**Credential output:**

- Subscription (OAuth): produces the three Gemini credential files, mounted into the container (Docker Compose) or stored as the `geminiCredentials`, `geminiSettings`, and `geminiGoogleAccounts` K8s Secret keys
- Fallback: set `GEMINI_API_KEY` environment variable

Gemini requires three credential files:

| File | Purpose |
|------|---------|
| `oauth_creds.json` | OAuth client credentials |
| `settings.json` | Gemini CLI settings |
| `google_accounts.json` | Google account tokens |

!!! tip
    Gemini access tokens expire after 1 hour but use a reusable refresh token. Read-only mounts work (in-memory refresh), but writable mounts are preferred.

### opencode (Copilot and OpenRouter)

opencode uses stateless, env-var-only authentication. No auth file is written to disk on invocation.

**opencode-copilot** reads `GITHUB_TOKEN` from the environment. Agentflow stores the credential as `GITHUB_COPILOT_TOKEN` so SCM access and Copilot can use different GitHub accounts. At runtime, `OpencodeCliProvider` remaps `GITHUB_COPILOT_TOKEN` to `GITHUB_TOKEN` inside the opencode subprocess.

- Credential: `GITHUB_COPILOT_TOKEN` (OAuth token from `gh auth token`; PATs of any type are rejected by the Copilot API)
- Fallback: if `GITHUB_COPILOT_TOKEN` is absent, opencode inherits `GITHUB_TOKEN` (the SCM token)

**opencode-openrouter** reads `OPENROUTER_API_KEY` from the environment.

- Credential: `OPENROUTER_API_KEY` (`sk-or-v1-...` from openrouter.ai)

Both providers are authenticated via `agentflow auth setup`. See the [opencode setup guide](setup/opencode.md) for full instructions.

## GitHub

GitHub authentication uses a [classic Personal Access Token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-personal-access-token-classic) with the [`repo` scope](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps#available-scopes).

```bash
# Set in .env.docker or environment
GITHUB_TOKEN=ghp_your_token_here
```

!!! warning "Classic PAT required"
    [Fine-grained PATs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens) do not support the `checks:read` permission needed for the default CI check method (`ci_check_method: "checks"`). Use a **classic PAT** with the `repo` scope. If you must use a fine-grained PAT, set `ci_check_method: "status"` in your repo config and grant the "Commit statuses: Read" permission.

Required scopes depend on the agent role:

| Role | Scopes needed |
|------|---------------|
| Orchestrator | `repo` (CI status reads, label management, PR operations) |
| Developer | `repo` (push, PR creation) |
| Researcher | `repo` (read-only ideally) |
| Reviewer | None (token stripped by default) |

You can assign different tokens per role in the [configuration](configuration.md#github).

## GitLab

For repos with `scm: gitlab`, Agentflow authenticates with a **Group or Project Access Token** carrying the `api` and `write_repository` scopes.

**Per-repo token env var.** Because two GitLab repos may live in different groups with distinct tokens, the credential is resolved per repo: the repo key is uppercased, non-alphanumeric characters become `_`, and `_GITLAB_TOKEN` is appended.

| Repo key (in `repos:`) | Token env var |
|------------------------|---------------|
| `platform` | `PLATFORM_GITLAB_TOKEN` |
| `acme.platform` | `ACME_PLATFORM_GITLAB_TOKEN` |

Set it like any other credential:

```bash
# .env.docker or environment
PLATFORM_GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx
```

`agentflow auth setup` detects every `scm: gitlab` repo and prompts for its token, writing the correctly-named env var to `.env.docker` (or the K8s Secret with `--target k8s`).

!!! note "Token expiry and rotation"
    GitLab Group/Project Access Tokens have a mandatory expiry (default 365 days since GitLab 16.0). Agentflow can auto-rotate the token via the self-rotation endpoint once ~80% of its lifetime has elapsed. **Auto-rotation must be disabled for GitOps/SealedSecret-managed deployments** (the running orchestrator cannot mutate a Git-tracked sealed secret) — there, the `agentflow_scm_token_expiry_seconds` metric warns ahead of expiry and you rotate manually.

**Label pre-creation:** unlike GitHub, GitLab does not auto-create labels on first use. At startup the orchestrator pre-creates the `agent:*` label family on each GitLab project. If creation fails (insufficient token scope), the orchestrator refuses to start with a clear error.

## Jira

Jira uses email + API token authentication.

1. Generate an API token at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Set the credentials:

```bash
# In .env.docker or environment
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=your_api_token
JIRA_BASE_URL=https://myorg.atlassian.net
```

## Credential Broker (Kubernetes)

In Kubernetes, the orchestrator runs a Credential Broker to manage per-pod credentials for agent Jobs. This is automatic — no additional configuration needed beyond the main `credential_secret_name` in [job runner config](configuration.md#job-runner).

```mermaid
sequenceDiagram
    participant O as Orchestrator
    participant PVC as Master creds (PVC)
    participant K as Kubernetes API
    participant Pod as Agent pod

    O->>PVC: read master credentials
    Note over O: refresh Codex token if older than 7 days
    O->>K: create ephemeral Secret<br/>(provider-specific, scoped to this run)
    O->>K: create agent Job (mounts the Secret)
    K->>Pod: init container copies creds → /tmp
    Pod->>Pod: agent runs with credentials
    Pod-->>K: pod completes
    O->>K: delete ephemeral Secret
```

The broker:

1. Holds master credentials on the orchestrator's PVC
2. Before spawning each agent pod, creates an ephemeral Kubernetes Secret with provider-specific credentials
3. Mounts the Secret into the agent pod
4. Deletes the ephemeral Secret after the pod completes

Per-provider behavior:

| Provider | Broker strategy | Reason |
|----------|----------------|--------|
| Claude | Env var only | Simple token, no file-based credentials |
| Codex | Access-token-only Secret | Prevents single-use refresh token conflicts across pods |
| Gemini | Full credentials Secret | Reusable refresh token, safe for multi-pod |
| opencode-copilot | Env var only | Stateless env-var auth (`GITHUB_COPILOT_TOKEN`); no auth.json written |
| opencode-openrouter | Env var only | Stateless env-var auth (`OPENROUTER_API_KEY`); no auth.json written |

The broker proactively refreshes Codex tokens when the token age exceeds 7 days.
