# Application Secrets

Some projects need external service credentials to run properly during testing — API tokens for third-party services, database connection strings, or webhook signing secrets. These are different from the [provider credentials](../authentication.md) that AI CLI tools need. Application secrets are injected into agent pods so the **target application** can authenticate with its dependencies during reviewer testing.

## When You Need This

Use `application_secrets` when your project:

- Integrates with external APIs (Jira, Stripe, Twilio, AWS, etc.) and the reviewer agent tests those integrations via Playwright or other tools
- Requires database credentials for integration tests
- Needs service-to-service auth tokens (mTLS certs, JWT signing keys)
- Uses feature flags or configuration that contains sensitive values

If your project's tests are self-contained (mocked dependencies, no external calls), you don't need application secrets.

## Configuration

Add an `application_secrets` section to your `.agentflow.yaml` (in the target repository):

```yaml
version: 1
application_secrets:
  secret_name: myproject-test-secrets
  env:
    - name: JIRA_API_TOKEN
      key: jira-api-token
    - name: JIRA_EMAIL
      key: jira-email
    - name: DATABASE_URL
      key: database-url
```

Or configure centrally in `agentflow.yaml`:

```yaml
repos:
  my-backend:
    url: "https://github.com/org/my-backend"
    labels: ["agentflow"]
    application_secrets:
      secret_name: backend-test-secrets
      env:
        - name: DATABASE_URL
          key: database-url
        - name: STRIPE_TEST_KEY
          key: stripe-test-key
```

In-repo `.agentflow.yaml` values override central config values.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `secret_name` | string | K8s only | Name of the Kubernetes Secret containing the values |
| `env` | array | yes | List of environment variables to inject |
| `env[].name` | string | yes | Environment variable name (e.g., `JIRA_API_TOKEN`) |
| `env[].key` | string | no | Key within the K8s Secret. Defaults to `name` lowercased with `_` replaced by `-` |

## Behavior by Deployment Tier

=== "Kubernetes"

    The orchestrator mounts the K8s Secret referenced by `secret_name` and injects the declared env vars into the agent pod. The init container copies secret values alongside provider credentials.

    **Create the Secret first:**

    ```bash
    kubectl -n agentflow create secret generic myproject-test-secrets \
      --from-literal=jira-api-token="your-token" \
      --from-literal=jira-email="user@example.com" \
      --from-literal=database-url="postgres://user:pass@host/db"
    ```

    !!! note
        The Secret must exist in the same namespace as the agent pods. The orchestrator's RBAC role already includes `secrets` permissions.

=== "Docker Compose"

    The `secret_name` field is ignored. The orchestrator passes through environment variables listed in `env[].name` from the host environment to the agent container. Set them in `.env.docker` or export them before starting:

    ```bash
    # .env.docker
    JIRA_API_TOKEN=your-token
    JIRA_EMAIL=user@example.com
    ```

=== "Local"

    The `secret_name` and `key` fields are ignored. The orchestrator passes through environment variables listed in `env[].name` from the host environment to the agent process. Export them before starting:

    ```bash
    export JIRA_API_TOKEN="your-token"
    export JIRA_EMAIL="user@example.com"
    agentflow start
    ```

## Kubernetes: Creating the Secret

The K8s Secret referenced by `secret_name` must exist in the same namespace as the agent pods. You can provision it via Helm values or create it manually.

### Helm Values (recommended)

Declare secrets in your Helm values file. Helm creates the Secret and manages its lifecycle (updates on `helm upgrade`, deletes on `helm uninstall`):

```yaml
applicationSecrets:
  - name: myproject-test-secrets
    data:
      jira-api-token: "your-token"
      jira-email: "user@example.com"
      database-url: "postgres://user:pass@host/db"
```

For externally managed Secrets (Sealed Secrets, External Secrets Operator, etc.), reference the name without providing data — Helm skips creation:

```yaml
applicationSecrets:
  - name: myproject-test-secrets
    existingSecret: true
```

### Manual (kubectl)

```bash
kubectl -n agentflow create secret generic myproject-test-secrets \
  --from-literal=jira-api-token="your-token" \
  --from-literal=jira-email="user@example.com" \
  --from-literal=database-url="postgres://user:pass@host/db"
```

See [Kubernetes Setup — Application Secrets](../setup/kubernetes.md#application-secrets) for the full setup guide.

## Telling Agents About Secrets

Agents know env var **names** but never see the **values**. Use your [project-specific reviewer prompt](project-prompts.md) to tell the agent which env vars are available and how the application uses them:

```markdown
## External Service Credentials

The following env vars are pre-configured in the agent pod:
- `JIRA_API_TOKEN` — Jira Cloud API token
- `JIRA_EMAIL` — email for Jira Basic auth
- `DATABASE_URL` — PostgreSQL connection string

The app reads these from the environment at startup.
No manual configuration is needed.
```

!!! warning "Never put secret values in prompts"
    Project-specific prompts are loaded from the repository and included in the agent's context. Never put actual secret values in prompt files — only reference env var names.

## Security

Application secrets follow the same security rules as provider credentials:

- **Redaction** — secret values are automatically excluded from agent logs, PR comments, and reviewer output
- **Pod isolation** — each agent pod gets its own copy of secrets via the init container; no shared mutable state between pods
- **Default branch only** — the `application_secrets` config is read from the default branch, preventing feature branches from requesting arbitrary secrets
- **Ephemeral storage** — the writable `/tmp` (emptyDir) used during agent execution is ephemeral and discarded on pod termination
- **Least privilege** — only the env vars explicitly listed in `application_secrets.env` are injected; the agent pod does not receive the full Secret

## See Also

- [Configuration](../configuration.md) — full config reference
- [Project-Specific Prompts](project-prompts.md) — telling agents how to use the env vars
- [Authentication](../authentication.md) — provider credentials (different from application secrets)
- [Kubernetes Setup](../setup/kubernetes.md#application-secrets) — K8s Secret setup and agent pod injection
- [Custom Agent Images](../setup/custom-images.md) — building images with project dependencies
