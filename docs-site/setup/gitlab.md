# GitLab SCM Setup

How to point Agentflow at a self-hosted or `gitlab.com` GitLab project. Covers authentication, repo configuration, token rotation, and webhook delivery.

GitLab support is opt-in per repo via `scm: gitlab` in the repo config. The SCM provider and the work-item provider are independent — a GitLab-hosted repo can use GitHub Issues, Jira, or GitLab Issues as its backlog.

## Prerequisites

- A GitLab project you can administer.
- A **Group Access Token** (preferred) or **Project Access Token** with the `api` and `write_repository` scopes. Generate one under Group Settings > Access Tokens or Project Settings > Access Tokens in the GitLab UI.
- GitLab 17.0+ (SaaS or self-hosted). Older self-hosted versions are rejected at startup with an actionable error.

!!! note "No device-grant flow for GitLab access tokens"
    GitLab does not expose a programmatic device-grant flow for Group/Project Access Tokens. The `agentflow auth setup` CLI prompts you to paste the token once. Automatic rotation is opt-in (see [Token rotation](#token-rotation) below).

## 1. Authenticate

Run the auth CLI in a separate terminal:

```bash
npx agentflow auth setup --config config/agentflow.yaml
```

For each GitLab repo in your config, the CLI:

1. Prints the repo id, base URL, and project id.
2. Prompts you to paste a Group/Project Access Token with `api` and `write_repository` scopes.
3. Verifies the token by calling `GET /api/v4/version` and `GET /api/v4/projects/<projectId>`.
4. Persists the token under the env var `<REPO_ID>_GITLAB_TOKEN` (uppercased, with non-alphanumerics replaced by underscores).

Output targets:

| `--target` | Where the token is persisted |
|------------|------------------------------|
| `env-docker` (default) | `.env.docker` in the project root |
| `k8s` | Printed as a `kubectl create secret` command |
| `stdout` | Printed as plain `KEY=value` lines |

The same `auth setup` invocation handles AI provider auth (Claude, Codex, Gemini) and GitLab token persistence in a single pass.

See [Authentication](../authentication.md) for the auth pipeline overview.

## 2. Configure the repo

Add a `repos` entry in `config/agentflow.yaml` with `scm: gitlab` and a `gitlab:` block:

```yaml
repos:
  platform:
    url: "https://gitlab.example.com/namespace/platform"
    labels:
      - "agentflow"
    scm: gitlab
    gitlab:
      base_url: "https://gitlab.example.com"
      project_id: 42
      webhook_signature: hmac          # or "token" (default if omitted)
      merge_method: squash             # "merge" | "squash" | "rebase"
      remove_source_branch: true
      auto_rotate_token: false         # default; set true on K8s mutable-Secret deployments
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `base_url` | string | yes | Root URL of the GitLab instance (e.g. `https://gitlab.com` or your self-hosted host) |
| `project_id` | number | yes | Numeric GitLab project id (Project Settings > General) |
| `webhook_signature` | enum | no | `"hmac"` or `"token"` — see [Webhooks](#webhooks-optional) below |
| `merge_method` | enum | no | `"merge"` (default), `"squash"`, or `"rebase"` |
| `remove_source_branch` | boolean | no | Delete the source branch after merging (default: `true`) |
| `webhook_dedup_window_seconds` | number | no | Terminal-pipeline webhook dedup window (default: 60) |
| `auto_rotate_token` | boolean | no | Self-rotate the access token at 80% of its lifetime (default: `false`; opt-in — see [Token rotation](#token-rotation)) |

Agentflow rejects the config at startup if you set `ci_check_method: "checks"` or `"status"` on a GitLab repo — those CI methods are GitHub-only. Leave `ci_check_method` unset (it's inferred from GitLab pipeline status) or set it to `"none"`.

## 3. Choose a work-item provider

The work-item provider is independent of the SCM. For a GitLab repo backed by Jira tickets:

```yaml
repos:
  platform:
    url: "https://gitlab.example.com/namespace/platform"
    labels: ["agentflow"]
    scm: gitlab
    gitlab:
      base_url: "https://gitlab.example.com"
      project_id: 42
    work_item_provider: jira
    jira:
      project_key: PLATFORM
      cloud_url: "https://example.atlassian.net"
```

For a GitLab repo backed by GitHub Issues (the exotic cross-provider corner), omit `work_item_provider` and the host of the issues repo is read from `url` — see [Configuration > Jira Work Item Provider](../configuration.md#jira-work-item-provider).

## 4. Labels

The GitLab capability descriptor reports `labelAutoCreate: false` in this release, so Agentflow does not create labels on GitLab projects at startup. Before starting the orchestrator, create the `agent:*` label family (the set used by your workflow state machine — see [Workflow States](../how-it-works/workflow-states.md)) on the GitLab project manually, together with whatever trigger label your `repos[].labels` config references.

## Token rotation

Group/Project Access Tokens have a configurable lifetime (max 365 days). Auto-rotation is **opt-in** via `gitlab.auto_rotate_token: true`. When enabled, Agentflow rotates the token once 80% of its initial lifetime has elapsed by calling `POST /api/v4/personal_access_tokens/self/rotate`.

The rotated token is persisted by patching the orchestrator's Kubernetes Secret in place. This requires:

- Job runner type `kubernetes`.
- `secrets/get,update` RBAC on the orchestrator's ServiceAccount for the Secret it reads its own token from.
- A mutable Secret source (not SealedSecrets — Flux/SOPS-style reconciliation would overwrite the rotation).

For deployments that don't satisfy these conditions (Local, Docker, SealedSecrets/GitOps), leave `auto_rotate_token: false` and rotate manually: regenerate the token in the GitLab UI, then re-run `agentflow auth setup` (Local/Docker) or update the secret source (GitOps) and let Flux reconcile.

The metric `agentflow_scm_token_expiry_seconds{provider="gitlab", repo="<repoId>"}` reports the remaining lifetime so you can alert on imminent expiry regardless of which path you're on.

## Webhooks

GitLab repos run on the [orchestrator's polling intervals](../configuration.md#orchestrator) in this release. The `webhook_signature` and `webhook_dedup_window_seconds` config fields are accepted by the schema but the orchestrator does not yet register `/webhooks/gitlab/<repoId>` routes — the `GitLabWebhookReceiver` library exists in `packages/scm-gitlab` but is not wired into the HTTP layer. Real-time event delivery for GitLab is tracked separately; for now, GitLab repos use the polling fallback exclusively.

## Verifying

Start the orchestrator. The startup log should show, for each GitLab repo:

```
SCM probe: gitlab → OK (bot: <bot-username>, version <X.Y.Z>)
```

If the token is invalid or the project is unreachable, the orchestrator refuses to start and names the affected repo. The token-expiry metric is visible on `/metrics`:

```
agentflow_scm_token_expiry_seconds{provider="gitlab", repo="platform"} <seconds>
```

Then create a Jira ticket (or GitHub Issue, depending on your work-item provider) with the trigger label. Within one poll cycle, Agentflow should claim it, post a research summary, and open a Draft MR on GitLab.

## See also

- [GitHub setup guide](github.md)
- [Authentication](../authentication.md)
- [Configuration](../configuration.md)
- [Workflow States](../how-it-works/workflow-states.md)
