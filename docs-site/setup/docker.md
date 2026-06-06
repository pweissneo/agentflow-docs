# Docker Compose Setup

Deploy Agentflow using Docker Compose for a production-like environment with container isolation.

## Prerequisites

- **Docker** and **Docker Compose** (or Podman with `docker-compose` compatibility)
- An AI provider account with valid credentials
- A GitHub PAT with `repo` scope

!!! tip "Using Podman"
    All `docker` and `docker compose` commands in this guide work with Podman. Replace `docker` with `podman` and `docker compose` with `podman-compose` (or use Podman's built-in Docker compatibility mode).

## 1. Configure

```bash
cp config/agentflow.example.yaml config/agentflow.yaml
```

Edit `config/agentflow.yaml` with your repository URL and labels:

```yaml
repos:
  myproject:
    url: "https://github.com/your-org/your-repo"
    labels:
      - "agentflow"
```

## 2. Set Credentials

Copy the example environment file and fill in your credentials:

```bash
cp .env.docker.example .env.docker
```

Edit `.env.docker`:

```bash
# Required
GITHUB_TOKEN=ghp_your_token_here

# Claude (pick one)
CLAUDE_CODE_OAUTH_TOKEN=your_oauth_token
# ANTHROPIC_API_KEY=sk-ant-your_key

# Codex (if configured)
# OPENAI_API_KEY=sk-your_key

# Gemini (if configured)
# GEMINI_API_KEY=your_key

# Jira (if using Jira work item provider)
# JIRA_EMAIL=you@example.com
# JIRA_API_TOKEN=your_api_token
# JIRA_BASE_URL=https://myorg.atlassian.net

LOG_LEVEL=info
```

Alternatively, run `agentflow auth setup` to populate `.env.docker` automatically:

```bash
npx tsx apps/agentflow/src/cli.ts auth setup --config config/agentflow.yaml
```

## 3. Build and Run

```bash
docker compose up -d --build
```

Check the logs:

```bash
docker compose logs -f orchestrator
```

Verify health:

```bash
curl http://localhost:9090/health
```

## 4. In-Container Authentication (Alternative)

Generate credentials host-side and write them to `.env.docker`:

```bash
npx agentflow auth setup --config config/agentflow.yaml --target env-docker
```

!!! note
    In-container authentication (`agentflow auth init`) is planned but not yet available — use the host-side `auth setup` flow for now.

This runs interactive OAuth flows for each configured provider and stores credentials on the container's persistent volume. Credentials survive container restarts.

## Container Details

The `docker-compose.yml` creates a single service:

```yaml
services:
  orchestrator:
    build: .
    container_name: agentflow-orchestrator
    env_file: .env.docker
    volumes:
      - ./config:/app/config:ro
    ports:
      - "${AGENTFLOW_PORT:-9090}:9090"
    restart: unless-stopped
```

### Volumes

| Mount | Purpose | Default |
|-------|---------|---------|
| `./config:/app/config:ro` | Configuration (read-only) | active |
| `~/.codex:/home/agentflow/.codex` | Codex subscription auth | commented out |
| `~/.gemini:/home/agentflow/.gemini` | Gemini subscription auth | commented out |

Only the config mount is active by default. Uncomment the credential volume mounts in `docker-compose.yml` if you prefer mounting host credentials directly.

### Image Details

The Dockerfile uses a multi-stage build with a pre-built base image:

1. **Builder stage** — `node:22-slim`, installs pnpm dependencies, builds TypeScript
2. **Runtime stage** — `agentflow-base` (pre-built from `Dockerfile.base`) with AI CLI tools installed fresh each build

The **base image** (`Dockerfile.base`) contains system packages (`git`, `curl`, `ca-certificates`), `corepack`, and the non-root user setup. It changes rarely and is built separately to speed up CI.

The **AI CLI tools** (`@anthropic-ai/claude-code`, `@openai/codex`, `@google/gemini-cli`) are installed fresh in every build to pick up the latest versions.

The image runs as non-root user `agentflow` (UID 1001). Debian slim is required (not Alpine) because Codex and Gemini CLI tools are incompatible with Alpine's musl libc.

!!! note "Building the base image"
    The base image only needs to be rebuilt when system dependencies or the Node version change:
    ```bash
    ./run/docker_build_and_push_base.sh
    ```

### Health Check

The container has a built-in health check:

```
GET http://localhost:9090/health — 30s interval, 5s timeout, 3 retries
```

### Hot Reload

Modify `config/agentflow.yaml` on the host — the file watcher inside the container picks up changes automatically. No restart needed.

You can also trigger a reload manually:

```bash
curl -X POST http://localhost:9090/reload
```

## Application Secrets

If your project needs external service credentials for testing (e.g., API tokens for third-party integrations), add the required env vars to `.env.docker`. The orchestrator passes them through to agent processes. See [Application Secrets](../customization/application-secrets.md) for details.

## Stopping

```bash
docker compose down
```
