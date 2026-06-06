# Kubernetes Setup

Deploy Agentflow on Kubernetes for scalable, production deployment. Each agent runs in its own pod (agent-per-pod model).

## Prerequisites

- **Kubernetes cluster** (1.25+)
- **Helm 3**
- **kubectl** configured for your cluster
- Container registry access for the Agentflow image

## 1. Build and Push the Image

```bash
docker build -t registry.example.com/agentflow:latest .
docker push registry.example.com/agentflow:latest
```

## 2. Configure Helm Values

Create a values override file:

```yaml
# values-prod.yaml
image:
  repository: registry.example.com/agentflow
  tag: "latest"

config:
  content: |
    repos:
      myproject:
        url: "https://github.com/your-org/your-repo"
        labels:
          - "agentflow"

    job_runner:
      type: kubernetes
      kubernetes:
        namespace: agentflow
        image: "registry.example.com/agentflow:latest"
        service_account_name: agentflow
        topology_spread_constraints:
          - max_skew: 1
            topology_key: "kubernetes.io/hostname"
            when_unsatisfiable: "ScheduleAnyway"

    providers:
      claude:
        command: "claude"
        args: ["--print"]
        role_args:
          research: ["--dangerously-skip-permissions"]
          developer: ["--dangerously-skip-permissions"]

secrets:
  githubToken: "ghp_your_token"
  claudeOauthToken: "your_oauth_token"
```

## 3. Install with Helm

```bash
helm install agentflow helm/agentflow \
  --namespace agentflow \
  --create-namespace \
  -f values-prod.yaml
```

Verify the deployment:

```bash
kubectl -n agentflow get pods
kubectl -n agentflow logs deployment/agentflow-orchestrator -f
```

## 4. Authenticate Providers (In-Cluster)

Generate credentials host-side and inject them as the Kubernetes Secret:

```bash
npx agentflow auth setup --config config/agentflow.yaml --target k8s
```

!!! note
    In-container authentication (`agentflow auth init`) is planned but not yet available — use the host-side `auth setup --target k8s` flow for now.

Or generate credentials on the host and create a Kubernetes Secret:

```bash
npx tsx apps/agentflow/src/cli.ts auth setup \
  --config config/agentflow.yaml \
  --target k8s
```

## Helm Values Reference

### Image

```yaml
image:
  repository: agentflow
  tag: latest
  pullPolicy: IfNotPresent
```

### Secrets

```yaml
secrets:
  githubToken: ""              # GitHub PAT (required)
  claudeOauthToken: ""         # Claude OAuth token (preferred)
  anthropicApiKey: ""          # Claude API key (fallback)
  openaiApiKey: ""             # Codex API key
  geminiApiKey: ""             # Gemini API key (if not using OAuth)
  geminiCredentials: ""        # Gemini OAuth credentials JSON (oauth_creds.json)
  geminiSettings: ""           # Gemini settings JSON
  geminiGoogleAccounts: ""     # Gemini Google accounts JSON
  googleCredentials: ""        # Google service account JSON
  codexAuthJson: ""            # Codex auth.json (OAuth)
  jiraEmail: ""                # Jira email
  jiraApiToken: ""             # Jira API token
  jiraBaseUrl: ""              # Jira Cloud URL
```

At least one AI provider credential must be configured.

### RBAC

```yaml
rbac:
  enabled: true
```

When enabled, creates a Role with permissions for:

- `batch/jobs` — create, get, list, watch, delete (agent pod management)
- `pods`, `pods/log` — get, list, watch (monitoring)
- `secrets`, `configmaps` — create, get, list, delete (Credential Broker)

### Resources

```yaml
resources:
  requests:
    cpu: 100m
    memory: 512Mi
  limits:
    cpu: "1"
    memory: 2Gi

agentResources:
  research:
    requests: { cpu: 100m, memory: 256Mi }
    limits: { cpu: 500m, memory: 1Gi }
  developer:
    requests: { cpu: 250m, memory: 512Mi }
    limits: { cpu: "1", memory: 2Gi }
  reviewer:
    requests: { cpu: 100m, memory: 256Mi }
    limits: { cpu: 500m, memory: 1Gi }
  planner:
    requests: { cpu: 100m, memory: 256Mi }
    limits: { cpu: 500m, memory: 1Gi }
```

### Application Secrets

```yaml
applicationSecrets:
  - name: myproject-test-secrets
    data:
      jira-api-token: "your-token"
      database-url: "postgres://user:pass@host/db"
  - name: other-project-secrets
    existingSecret: true  # managed externally
```

Each entry with `data` creates a K8s Secret. Entries with `existingSecret: true` skip creation. See [Application Secrets](#application-secrets) for the full setup guide.

### Repo Cache (PVC)

```yaml
repoCache:
  enabled: true
  size: 5Gi
  storageClassName: ""  # uses default storage class
```

Persistent storage for cloned repositories and credentials. Survives pod restarts.

### Network Policies

```yaml
networkPolicy:
  enabled: true
```

When enabled, creates two NetworkPolicies:

**Orchestrator:**

- Ingress: port 9090 only
- Egress: HTTPS (443), Kubernetes API (6443), DNS (53)

**Agent pods** (label `agentflow.io/type: agent-job`):

- Ingress: none
- Egress: orchestrator API (9090), HTTPS (443), DNS (53)

### Ingress

```yaml
ingress:
  enabled: false
  className: ""
  annotations: {}
  hosts:
    - host: agentflow.example.com
      paths:
        - path: /
          pathType: Prefix
  tls: []
```

### Probes

```yaml
probes:
  liveness:
    httpGet: { path: /health, port: http }
    initialDelaySeconds: 10
    periodSeconds: 30
    timeoutSeconds: 5
    failureThreshold: 3
  readiness:
    httpGet: { path: /health, port: http }
    initialDelaySeconds: 5
    periodSeconds: 10
    timeoutSeconds: 5
    failureThreshold: 3
```

### Security Context

The Helm chart enforces:

- Non-root user (UID 1001, GID 1001)
- Read-only root filesystem
- No privilege escalation
- All Linux capabilities dropped

## Agent-Per-Pod Model

In Kubernetes mode, each agent runs in its own pod:

```mermaid
graph LR
    Orch["Orchestrator Pod"] -->|creates K8s Job| R["Research Pod"]
    Orch -->|creates K8s Job| D["Developer Pod"]
    Orch -->|creates K8s Job| Rev1["Reviewer Pod 1"]
    Orch -->|creates K8s Job| Rev2["Reviewer Pod 2"]
```

The orchestrator creates Kubernetes Jobs for each agent. Each Job:

1. Gets an ephemeral Secret with provider credentials (via the Credential Broker)
2. Runs the agent in a container with the same image as the orchestrator (or a [custom agent image](custom-images.md) if configured)
3. Writes results to work item artifacts
4. Is cleaned up after completion

See [Authentication — Credential Broker](../authentication.md#credential-broker-kubernetes) for how per-pod credentials are managed.

## Application Secrets

If your project integrates with external services (Jira, databases, payment APIs, etc.) and the reviewer agent tests those integrations, you need to provide the target application with credentials. These are separate from the [provider credentials](#secrets) that authenticate the AI CLI tools.

### 1. Create the Secret

=== "Helm Values (recommended)"

    Declare the Secret in your Helm values file. Helm creates and manages the Secret lifecycle:

    ```yaml
    applicationSecrets:
      - name: myproject-test-secrets
        data:
          jira-api-token: "your-token"
          jira-email: "user@example.com"
          database-url: "postgres://user:pass@host/db"
    ```

    For externally managed Secrets (e.g., Sealed Secrets, External Secrets Operator), skip creation and just reference the name:

    ```yaml
    applicationSecrets:
      - name: myproject-test-secrets
        existingSecret: true
    ```

=== "kubectl"

    Create the Secret manually:

    ```bash
    kubectl -n agentflow create secret generic myproject-test-secrets \
      --from-literal=jira-api-token="your-token" \
      --from-literal=jira-email="user@example.com" \
      --from-literal=database-url="postgres://user:pass@host/db"
    ```

### 2. Reference It in Config

In your central `agentflow.yaml` (or in the target repo's `.agentflow.yaml` without the `repos:` wrapper):

```yaml
repos:
  myproject:
    url: "github.com/org/myproject"
    labels: ["agentflow"]
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

### 3. Tell the Agent

Use a [project-specific reviewer prompt](../customization/project-prompts.md) to tell the agent which env vars are available:

```markdown
## Test Credentials
The following env vars are pre-configured:
- `JIRA_API_TOKEN` and `JIRA_EMAIL` — Jira API access
- `DATABASE_URL` — PostgreSQL connection string
```

!!! note
    Application secrets are injected as environment variables into agent pods only. Secret values never appear in agent prompts, logs, PR comments, or review output. See [Application Secrets](../customization/application-secrets.md) for the full security model.

## Upgrading

```bash
helm upgrade agentflow helm/agentflow \
  --namespace agentflow \
  -f values-prod.yaml
```

## Configuration Reload

Modify the ConfigMap and trigger a reload without pod restart:

```bash
kubectl -n agentflow exec deployment/agentflow-orchestrator -- \
  curl -sf -X POST http://localhost:9090/reload
```

## Monitoring

Prometheus metrics are exposed at `/metrics`:

```bash
kubectl -n agentflow port-forward deployment/agentflow-orchestrator 9090:9090
curl http://localhost:9090/metrics
```
