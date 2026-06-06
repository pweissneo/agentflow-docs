# Quick Start

Get Agentflow running and processing its first issue.

## Prerequisites

- An AI provider account (Claude, Codex, or Gemini)
- A GitHub repository with Issues enabled (or a Jira project)

=== "Local"

    - Node.js 22 LTS
    - pnpm (`corepack enable`)
    - At least one AI CLI tool: `npm install -g @anthropic-ai/claude-code`

=== "Docker Compose"

    - Docker and Docker Compose (or Podman)

=== "Kubernetes"

    - Kubernetes cluster (1.25+)
    - Helm 3
    - Container registry access

## 1. Clone and Build

=== "Local"

    ```bash
    git clone https://github.com/your-org/agentflow.git
    cd agentflow
    pnpm install
    pnpm build
    ```

=== "Docker Compose"

    ```bash
    git clone https://github.com/your-org/agentflow.git
    cd agentflow
    ```

=== "Kubernetes"

    ```bash
    git clone https://github.com/your-org/agentflow.git
    cd agentflow
    docker build -t registry.example.com/agentflow:latest .
    docker push registry.example.com/agentflow:latest
    ```

## 2. Configure

=== "Local"

    ```bash
    cp config/agentflow.example.yaml config/agentflow.yaml
    ```

    Edit `config/agentflow.yaml`:

    ```yaml
    repos:
      myproject:
        url: "https://github.com/your-org/your-repo"
        labels:
          - "agentflow"
    ```

=== "Docker Compose"

    ```bash
    cp config/agentflow.example.yaml config/agentflow.yaml
    cp .env.docker.example .env.docker
    ```

    Edit `config/agentflow.yaml` with your repo URL and labels. Edit `.env.docker` with your credentials:

    ```bash
    GITHUB_TOKEN=ghp_your_token_here
    CLAUDE_CODE_OAUTH_TOKEN=your_oauth_token
    ```

=== "Kubernetes"

    Create a `values-prod.yaml`:

    ```yaml
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

    secrets:
      githubToken: "ghp_your_token"
      claudeOauthToken: "your_oauth_token"
    ```

## 3. Authenticate

=== "Local"

    ```bash
    npx tsx apps/agentflow/src/cli.ts auth setup --config config/agentflow.yaml
    ```

    This detects your configured providers and walks you through each OAuth flow.

=== "Docker Compose"

    If you already filled in `.env.docker`, skip this step. Otherwise, generate credentials:

    ```bash
    npx tsx apps/agentflow/src/cli.ts auth setup --config config/agentflow.yaml
    ```

=== "Kubernetes"

    Credentials are provided via Helm `secrets` values. To generate them, run host-side auth with the Kubernetes target and apply the resulting Secret:

    ```bash
    npx agentflow auth setup --config config/agentflow.yaml --target k8s
    ```

See [Authentication](authentication.md) for details on each provider's flow.

## 4. Run

=== "Local"

    ```bash
    pnpm dev
    ```

=== "Docker Compose"

    ```bash
    docker compose up -d --build
    docker compose logs -f orchestrator
    ```

=== "Kubernetes"

    ```bash
    helm install agentflow helm/agentflow \
      --namespace agentflow \
      --create-namespace \
      -f values-prod.yaml
    kubectl -n agentflow logs deployment/agentflow-orchestrator -f
    ```

## 5. Create a Test Issue

Create an issue in your repository (or Jira project) with the `agentflow` label. Agentflow will:

1. Detect the issue on its next poll cycle
2. Claim it and spawn a Research Agent
3. Post a research summary as a comment
4. Spawn a Developer Agent to implement changes
5. Create a PR for your review

Check the orchestrator health:

```bash
curl http://localhost:9090/health
```

## Next Steps

- **Detailed setup:** [Local](setup/local.md) | [Docker Compose](setup/docker.md) | [Kubernetes](setup/kubernetes.md)
- **Configuration reference:** [Configuration](configuration.md)
- **Understand the pipeline:** [How It Works](how-it-works/overview.md)
