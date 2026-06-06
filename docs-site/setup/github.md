# GitHub SCM Setup

How to point Agentflow at a GitHub repository. Covers authentication, repo configuration, and webhook delivery.

GitHub is the default SCM provider — when a repo entry has no `scm` field, Agentflow treats it as GitHub.

## Prerequisites

- A GitHub repository you can administer (to create labels and configure webhooks).
- A [classic Personal Access Token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-personal-access-token-classic) with the `repo` scope, or a GitHub App token with equivalent permissions.

!!! warning "Classic PAT vs fine-grained PAT"
    [Fine-grained PATs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens) do not grant the `checks:read` permission that the default CI check method (`ci_check_method: "checks"`) requires. Use a **classic PAT** with the `repo` scope. If you must use a fine-grained PAT, set `ci_check_method: "status"` in your repo config and grant the "Commit statuses: Read" permission.

## 1. Authenticate

Set the GitHub token in your environment (or `.env.docker`, or a Kubernetes Secret depending on your deployment tier):

```bash
export GITHUB_TOKEN=ghp_your_token_here
```

Required scopes by agent role:

| Role | Scopes needed |
|------|---------------|
| Orchestrator | `repo` (CI status reads, label management, PR operations) |
| Developer | `repo` (push, PR creation) |
| Researcher | `repo` (read-only ideally) |
| Reviewer | None (token stripped by default) |

You can assign separate tokens per role under `github.tokens` — see [Configuration > GitHub](../configuration.md#github).

The `agentflow auth setup` CLI does not generate GitHub tokens itself (GitHub has no programmatic PAT-creation flow). Generate the token in the GitHub UI, then drop it into your `.env.docker` or Kubernetes Secret manually. See [Authentication](../authentication.md) for the auth pipeline overview.

## 2. Configure the repo

Add a `repos` entry in `config/agentflow.yaml`:

```yaml
repos:
  myproject:
    url: "https://github.com/your-org/your-repo"
    labels:
      - "agentflow"
```

The `url` field is the only mandatory identifier. Agentflow accepts any of these shapes:

- `owner/repo`
- `github.com/owner/repo`
- `https://github.com/owner/repo`

If you omit `scm`, Agentflow assumes `scm: github`. To be explicit:

```yaml
repos:
  myproject:
    scm: github
    url: "https://github.com/your-org/your-repo"
    labels: ["agentflow"]
```

Common GitHub-specific options:

| Field | Default | Description |
|-------|---------|-------------|
| `ci_check_method` | `"checks"` | `"checks"` (classic PAT, Check Runs API), `"status"` (fine-grained PAT, Commit Status API), or `"none"` (skip CI) |
| `merge_strategy` | `"squash"` | `"squash"`, `"merge"`, or `"rebase"` |

See [Configuration > Repos](../configuration.md#repos) for the full set.

## 3. Add the work-item provider

GitHub repos can use either GitHub Issues or Jira as the backlog source. The default is GitHub Issues; no extra config needed.

For Jira, add a `work_item_provider: jira` + `jira:` block — see [Configuration > Jira Work Item Provider](../configuration.md#jira-work-item-provider).

## 4. Webhooks (optional)

Webhooks deliver pull-request, issue, and CI events directly to Agentflow, replacing the polling fallback. Enable them in `config/agentflow.yaml`:

```yaml
webhooks:
  enabled: true
  secret: "your-webhook-secret"
```

Agentflow then registers one webhook URL per configured GitHub repo:

```
POST /webhooks/github/<repoId>
```

Point each repository's GitHub webhook at its own URL (Repository settings > Webhooks > Add webhook). Use the same shared secret in both the GitHub UI and the `webhooks.secret` field.

Content type: `application/json`. Subscribe to the events Agentflow consumes: `Pull requests`, `Issues`, `Issue comments`, `Pull request reviews`, `Check runs` (or `Statuses`, depending on `ci_check_method`).

!!! note "Legacy URL"
    `/webhooks/github` (or `webhooks.path` if you set it) continues to accept deliveries as a backwards-compatible alias, but every delivery logs a deprecation warning. Migrate to the per-repo URL.

When webhooks are enabled, [polling intervals](../configuration.md#orchestrator) are automatically multiplied by 5x — they serve as a fallback.

## 5. Labels

Agentflow uses `agent:*` labels to track workflow state. The orchestrator auto-creates them in each GitHub repo on first use; no manual setup is needed.

If you mark issues for processing with a different label (e.g. `agentflow`), make sure it exists in the repo before starting — Agentflow does not auto-create the trigger label.

## Verifying

After starting the orchestrator (`pnpm dev` locally, or whichever deployment tier you're on):

```bash
curl http://localhost:9090/health
```

Create a test issue with your trigger label. Within one poll cycle (default 60s, or near-instantaneously if webhooks are enabled), the issue should be claimed and a research agent should post a summary as a comment.

## See also

- [GitLab setup guide](gitlab.md)
- [Authentication](../authentication.md)
- [Configuration](../configuration.md)
- [Workflow States](../how-it-works/workflow-states.md)
