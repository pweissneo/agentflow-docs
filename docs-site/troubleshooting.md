# Troubleshooting

Common issues and how to resolve them.

## Authentication Issues

### Claude: "Not authenticated" or token expired

Claude OAuth tokens last approximately one year. If expired, re-run the auth flow:

```bash
# Host-side
npx tsx apps/agentflow/src/cli.ts auth setup --config config/agentflow.yaml --force

# Or in-container
docker exec -it agentflow-orchestrator agentflow auth init
```

If using an API key instead of OAuth, verify `ANTHROPIC_API_KEY` is set.

### Codex: "Invalid refresh token" or auth failures

Codex uses single-use refresh tokens — each refresh invalidates the previous token. Common causes:

- **Multiple processes sharing the same credentials** — in Kubernetes, each pod needs independent credentials. The Credential Broker handles this automatically.
- **Stale `auth.json`** — re-authenticate:

```bash
codex login --device-auth
```

### Gemini: "Token refresh failed"

Gemini access tokens expire after 1 hour. The CLI refreshes them automatically, but issues arise when:

- **Missing credential files** — Gemini needs three files: `oauth_creds.json`, `settings.json`, and `google_accounts.json`. All must be present.
- **Read-only mount** — writable credential directories are preferred. Ensure `/home/agentflow/.gemini/` is writable.

Re-authenticate:

```bash
npx tsx apps/agentflow/src/cli.ts auth setup --config config/agentflow.yaml --force
```

### Jira: "401 Unauthorized"

Verify your credentials:

```bash
curl -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "$JIRA_BASE_URL/rest/api/3/myself"
```

Common causes:

- API token expired — regenerate at [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens)
- Wrong email/token combination
- `JIRA_BASE_URL` missing the `https://` prefix

### GitHub: "Bad credentials" or 403 errors

- Verify token: `curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user`
- Check scopes: developer agents need `repo` scope (push + PR)
- Token may be expired or revoked
- **403 on Check Runs API:** Fine-grained PATs do not have a `checks:read` permission. If you see `"Resource not accessible by personal access token"` during CI polling, switch to a classic PAT with `repo` scope or set `ci_check_method: "status"` in your repo config

## Agent Failures

### Agent stuck in CLAIMED / RESEARCHING / IN_PROGRESS

The heartbeat TTL system detects orphaned claims. If the orchestrator restarted while an agent was running:

1. The orphaned agent continues running but the orchestrator lost its `run_id`
2. After the heartbeat TTL expires (default: 30 minutes), the orchestrator reclaims the issue
3. A new agent is spawned

**To force recovery:** Remove the `agent:claimed` (or `agent:researching`, `agent:in-progress`) label from the issue. The orchestrator will pick it up on the next scan.

### Agent produces empty or incorrect PR

This is typically a prompt/context issue:

- Check the research summary comment on the issue — if it's incomplete, the developer agent has poor context
- Add `context_docs` to the repo config to provide additional context files
- Increase the model capability (e.g., switch from Haiku to Sonnet)

### Reviewer approved but the PR was treated as REQUEST_CHANGES

Reviewers submit their verdict by calling the `agentflow verdict` client, which delivers it to the orchestrator as structured data. If the client is unavailable, the orchestrator falls back to parsing the first token of the agent's stdout — and a verdict buried in prose is read as malformed and defaults to `REQUEST_CHANGES`.

Check the orchestrator log for the run:

- `"Using API-submitted verdict"` — the client was used; the verdict is reliable.
- `"Malformed reviewer verdict — defaulting to REQUEST_CHANGES"` — the client was **not** used and stdout parsing failed.

If you see the malformed path, verify the agent environment can reach the orchestrator:

- `AGENTFLOW_API_URL` and `AGENTFLOW_RUN_ID` must be set in the agent process (the Job Runner injects these automatically)
- Custom `agent_image` builds must include **Node.js 22+** so the `agentflow` client can run
- In Kubernetes, agent pods need egress to the orchestrator on port 9090

See [Agents > Agent Client](how-it-works/agents.md#agent-client).

### Agent timeout

Default timeout is 300 seconds (5 minutes), or 600 seconds for Gemini. Increase per provider:

```yaml
providers:
  claude:
    timeout_seconds: 600
```

### Provider rate limiting

Rate limit and usage cap errors (e.g., `You've hit your limit · resets 10pm (UTC)`) are classified as transient — the orchestrator will automatically retry with exponential backoff. To reduce the frequency of these errors, lower concurrency:

```yaml
providers:
  claude:
    max_concurrent_agents: 2
```

!!! note "Error message diagnostics"
    When a CLI tool exits with a non-zero code and writes nothing to stderr, Agentflow includes the first 500 characters of stdout in the error message. This helps diagnose rate limits and usage caps where the CLI writes errors to stdout instead of stderr. Check the orchestrator logs for the full error output.

## PR Issues

### PR not being created

Check in order:

1. **Is the issue claimed?** Look for the `agent:claimed` or `agent:in-progress` label.
2. **Did research complete?** Look for a research summary comment on the issue.
3. **Check orchestrator logs** for errors during the developer agent phase.
4. **GitHub token scopes** — the developer token needs `repo` scope to push branches and create PRs.

### PR created but CI not detected

Check `ci_check_method` in your repo config:

```yaml
repos:
  myproject:
    ci_check_method: "checks"  # "status", "checks", or "none"
```

- `"checks"` (default) — uses GitHub Check Runs API (requires classic PAT with `repo` scope)
- `"status"` — uses GitHub Commit Status API (works with fine-grained PATs)
- `"none"` — skips CI, goes directly to review

If CI hasn't reported yet, `ci_zero_check_grace_period_s` controls how long to wait.

### Merge conflicts

If a PR has merge conflicts with the base branch:

- The orchestrator detects the conflict and spawns a developer agent with rebase context
- If the conflict can't be auto-resolved, the issue is QUARANTINED with a comment explaining the conflict

## State Issues

### QUARANTINED state — what to do

A work item enters QUARANTINED when it exceeds a retry limit. Check the quarantine comment for the reason:

| Reason | Fix |
|--------|-----|
| Max CI failures | Fix CI manually, remove the `agent:quarantine` label |
| Max review iterations | Review the feedback loop — the issue may be too ambiguous |
| Unresolvable merge conflict | Rebase manually, remove the label |

After removing the `agent:quarantine` label, the orchestrator reclaims the issue on the next scan.

### Issue processed but not closing

The orchestrator closes issues only after the PR is merged. Check:

- Is the PR still open? The owner needs to merge it.
- Is `agent:waiting-owner` label present? The PR is approved and waiting.
- If the PR was closed without merge, the issue transitions to FAILED.

## Configuration Issues

### Config changes not taking effect

Configuration supports hot-reload via:

1. File watcher (automatic — change the YAML file)
2. Signal: `kill -HUP <pid>`
3. HTTP: `curl -X POST http://localhost:9090/reload`

**Fields that require a restart:** `github.token_env`, `server.port`, `server.host`

### Jira state mapping errors

The `state_mapping` controls the Jira board status projection (not state tracking — that uses `agent:*` labels). There are two types of failures:

- **Missing mapping entry** — if a state is not present in `state_mapping`, the Jira provider will fail at startup. Ensure every Agentflow state has a corresponding entry. If `state_mapping` is omitted entirely, defaults are applied.
- **Runtime transition failure** — if the Jira status transition fails at runtime (e.g., the target status doesn't exist in the Jira workflow), the error is logged but does not block the workflow — the `agent:*` labels are the source of truth.

## Logs

Agentflow uses structured JSON logging (pino). Set the log level:

```bash
LOG_LEVEL=debug pnpm dev
```

Available levels: `trace`, `debug`, `info`, `warn`, `error`, `fatal`

Filter logs with `jq`:

```bash
# Show only errors
pnpm dev 2>&1 | jq 'select(.level >= 50)'

# Show logs for a specific issue
pnpm dev 2>&1 | jq 'select(.issueNumber == 42)'
```

## Health and Metrics

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Liveness check — returns 200 if the process is running |
| `GET /ready` | Readiness check — returns 200 if the orchestrator is ready |
| `GET /metrics` | Prometheus metrics |
| `POST /reload` | Trigger configuration reload |
| `POST /agent/verdict` | Agent API — reviewer verdict submission (used by the `agentflow` client) |
| `POST /agent/progress` | Agent API — agent progress reports |
| `POST /agent/artifact` | Agent API — evidence artifact upload |
| `POST /agent/abort` | Agent API — agent signals an unrecoverable failure |

The `/agent/*` endpoints are called by the [Agent Client](how-it-works/agents.md#agent-client), not by humans.
