# Custom Agent Images

!!! note
    Custom agent images apply to **Kubernetes deployments only** (`job_runner.type: kubernetes`). In Local and Docker Compose mode, agents run on the host or in the orchestrator container directly — the `agent_image` field is ignored.

By default, agent pods use the same image as the orchestrator. This works when agents only need Node.js, git, and the AI CLI tools. For projects with additional runtime dependencies — compilers, system libraries, language runtimes, large test fixtures — you can provide a custom agent image per repo.

## When You Need a Custom Image

Use `agent_image` when your project needs tools that aren't in the default image (`node:22-slim` + git + curl + AI CLIs). Common cases:

- **Non-JS runtimes** — Python, Go, Rust, Java, .NET
- **System libraries** — native database drivers, image processing, FFI bindings
- **Heavy dependency trees** — `pnpm install` takes minutes and you want it pre-baked
- **Monorepos with tooling** — Bazel, Nx, Turborepo, or custom build scripts
- **Test infrastructure** — browsers (Playwright/Puppeteer), Docker-in-Docker, database clients

If your project only needs `pnpm install` and it completes in under 30 seconds, the default image with `setup: "pnpm install"` is usually fine.

## How It Works

Set `agent_image` in your repo config:

```yaml
repos:
  cockpit:
    url: "https://github.com/your-org/cockpit"
    labels: ["agentflow"]
    agent_image: "registry.example.com/cockpit-agent:latest"
```

Or in the repo's own `.agentflow.yaml`:

```yaml
version: 1
agent_image: "registry.example.com/cockpit-agent:latest"
```

The orchestrator uses this image for the main agent container in **all** pods spawned for that repo (research, developer, reviewer, planner). The credential init container (if present) uses the default orchestrator image, not the custom one — it only runs simple `cp` commands and has no project-specific dependencies.

### What Happens Inside the Pod

1. **Init containers** — copy provider credentials from a Secret mount to writable paths, and stage the `agentflow` agent client onto the pod's `PATH` (`/tmp/.agentflow/bin`). Both run from the default orchestrator image, not your custom one.
2. **Repo clone** — the agent runner clones your repo via `git clone` into `/tmp/agentflow-runs/{runId}/repo/`
3. **Setup command** — if `setup` is configured, it is injected into the AI agent's prompt as an instruction to run before making changes
4. **Agent work** — the AI CLI tool runs in the cloned repo directory
5. **Results** — written to stdout and `/tmp/agentflow-runs/{runId}/.agentflow/result.json`

The repo is **not** pre-cloned into the image or mounted as a volume. The agent runner clones it fresh every time using the `GITHUB_TOKEN` injected by the orchestrator. Your custom image only needs to provide the runtime environment.

## Building a Custom Image

### Requirements

Your image **must** have:

| Requirement | Why |
|-------------|-----|
| `node` (22+) + `corepack` | Runs the agent runner and the `agentflow` agent client; corepack enables pnpm for the Agentflow workspace |
| `git` | Clones the repo at runtime |
| At least one AI CLI (`claude`, `codex`, `gemini`) | The agent invokes it to do the actual work |
| Non-root user with **UID 1001, GID 1001** | K8s security context enforces this |
| `/tmp` writable | Used as `HOME`; CLI tools write configs, caches, and credentials here |
| `/tmp/agentflow-runs` writable, owned by 1001 | Workspace directory for cloned repos and results |

### Recommended Dockerfile Pattern

Start from the Agentflow base image and add your project's dependencies. The custom image needs the Agentflow agent runner at `/app`, so include the Agentflow build as a stage:

```dockerfile
# Stage 1: Build the Agentflow agent runner
FROM node:22-slim AS agentflow-builder
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/agentflow/package.json apps/agentflow/
COPY packages/*/package.json packages/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Stage 2: Custom agent image
ARG DOCKER_REGISTRY=registry.example.com
ARG BASE_TAG=0.1.0
FROM ${DOCKER_REGISTRY}/agentflow-base:${BASE_TAG}

# Switch to root to install system packages
USER root

# -- Add your project's system dependencies --
# Example: Python project
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/*

# Example: Go project
# RUN apt-get update && \
#     apt-get install -y --no-install-recommends golang-go && \
#     rm -rf /var/lib/apt/lists/*

# AI CLI tools (install the ones your provider config uses)
RUN npm install -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli

# Copy the Agentflow agent runner from Stage 1
COPY --from=agentflow-builder /app /app

USER 1001
```

Run the build from the Agentflow repo root (so the `COPY` instructions in Stage 1 find the source):

```bash
docker build -t registry.example.com/cockpit-agent:latest -f Dockerfile.agent .
```

!!! tip "Use `agentflow-base` as your base"
    The Agentflow base image already has Node.js 22, git, the non-root user (1001:1001), writable `/tmp/agentflow-runs`, and git config. Starting from it avoids duplicating this boilerplate. Build it from `Dockerfile.base` and push to your own registry: `docker build -t registry.example.com/agentflow-base:0.1.0 -f Dockerfile.base .`

### If You Can't Use the Agentflow Base

When starting from a different base image (e.g., a company-standard image), ensure you replicate the essential setup. Use the same multi-stage pattern — Stage 1 builds Agentflow, Stage 2 is your custom base:

```dockerfile
# Stage 1: Build the Agentflow agent runner (same as recommended pattern)
FROM node:22-slim AS agentflow-builder
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/agentflow/package.json apps/agentflow/
COPY packages/*/package.json packages/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Stage 2: Your custom base
FROM your-company-base:latest

USER root

# Node.js 22 (if not already present)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs git && \
    corepack enable

# Non-root user matching K8s securityContext
RUN groupadd -g 1001 agentflow && \
    useradd -u 1001 -g agentflow -m -s /bin/bash agentflow && \
    mkdir -p /tmp/agentflow-runs && \
    chown -R 1001:1001 /tmp/agentflow-runs && \
    git config --system user.email "agentflow@bot.local" && \
    git config --system user.name "Agentflow Bot"

# AI CLI tools
RUN npm install -g @anthropic-ai/claude-code

# Your project dependencies
RUN apt-get update && apt-get install -y --no-install-recommends python3 && \
    rm -rf /var/lib/apt/lists/*

# Agentflow agent runner
COPY --from=agentflow-builder /app /app

USER 1001
```

!!! warning "Use Debian, not Alpine"
    Codex and Gemini CLI tools are incompatible with Alpine's musl libc. Use `node:22-slim` (Debian) or any Debian/Ubuntu-based image.

## Pre-Baking Dependencies for Speed

The biggest win from a custom image is eliminating `setup` time. Instead of running `pnpm install` on every agent invocation, bake the `node_modules` into the image.

Add a dependency-install step to the recommended Dockerfile pattern (between the system packages and the final `USER 1001`):

```dockerfile
# ... (Stage 1: agentflow-builder — same as recommended pattern above)

# Stage 2: Custom agent image
ARG DOCKER_REGISTRY=registry.example.com
ARG BASE_TAG=0.1.0
FROM ${DOCKER_REGISTRY}/agentflow-base:${BASE_TAG}

USER root
RUN npm install -g @anthropic-ai/claude-code

# Pre-install your project's dependencies into a read-only location.
# At runtime, the setup command copies them to the writable workspace.
WORKDIR /opt/cockpit-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/agentflow/package.json apps/agentflow/
COPY packages/*/package.json packages/
RUN corepack enable && pnpm install --frozen-lockfile

# Agentflow runner
COPY --from=agentflow-builder /app /app

USER 1001
```

Then use `setup` to symlink or copy the pre-installed deps:

```yaml
repos:
  cockpit:
    url: "https://github.com/your-org/cockpit"
    labels: ["agentflow"]
    agent_image: "registry.example.com/cockpit-agent:latest"
    setup: "cp -r /opt/cockpit-deps/node_modules . && pnpm install --frozen-lockfile --offline"
```

The `pnpm install --offline` resolves workspace links using the pre-cached modules. This turns a multi-minute install into seconds.

!!! tip "Lock file alignment"
    Rebuild the image when your lock file changes. Use the lock file hash as an image tag (`cockpit-agent:lockfile-abc123`) to ensure pods always match.

## Pod Environment

Understanding the pod environment helps you build images that work correctly:

| Aspect | Value |
|--------|-------|
| `HOME` | `/tmp` (not `/home/agentflow`) |
| Working directory | `/tmp/agentflow-runs/{runId}/repo/` (after clone) |
| Root filesystem | **Read-only** — all writes go to `/tmp` (emptyDir) |
| User | 1001:1001 (non-root, enforced) |
| Capabilities | All dropped, no privilege escalation |
| Network | Egress to HTTPS (443) and DNS (53) only (if NetworkPolicy enabled) |

Since `HOME=/tmp`, CLI tools write their configs and caches to `/tmp/.claude`, `/tmp/.codex`, `/tmp/.gemini`. The credential init container copies provider credentials into these paths before the agent starts.

## Resource Limits

Developer agents doing `pnpm install` + compilation typically need more resources than reviewers that clone and read the repository. Use `resources_by_role`:

```yaml
job_runner:
  type: kubernetes
  kubernetes:
    namespace: agentflow
    image: "registry.example.com/agentflow:latest"
    resources_by_role:
      developer:
        requests: { cpu: "500m", memory: "1Gi" }
        limits: { cpu: "2", memory: "4Gi" }
      research:
        requests: { cpu: "100m", memory: "256Mi" }
        limits: { cpu: "500m", memory: "1Gi" }
      reviewer:
        requests: { cpu: "100m", memory: "256Mi" }
        limits: { cpu: "500m", memory: "1Gi" }
```

If your project has a heavy build step, the developer pod is where you'll feel it. Size limits accordingly and watch for OOMKills.

## Registry and Image Pull

The orchestrator creates agent Jobs referencing your `agent_image` directly. Standard K8s image pull rules apply:

```yaml
# Job runner config
job_runner:
  kubernetes:
    image_pull_policy: Always  # use for :latest tags
```

If your registry requires authentication, attach the pull secret to the agent **ServiceAccount** — the job runner does not inject `imagePullSecrets` into agent Jobs directly:

```bash
# Create the pull secret
kubectl -n agentflow create secret docker-registry my-registry-creds \
  --docker-server=registry.example.com \
  --docker-username=user \
  --docker-password=token

# Attach it to the ServiceAccount used by agent pods
kubectl -n agentflow patch serviceaccount agentflow \
  -p '{"imagePullSecrets": [{"name": "my-registry-creds"}]}'
```

This way every pod using the `agentflow` ServiceAccount can pull from your private registry.

## Tips for Agent Success

**Keep the image close to what the agent expects.** AI CLI tools (Claude, Codex, Gemini) work best when the environment looks like a normal developer machine. If `pnpm test` works in the image, the agent will figure out the rest.

**Include project-specific CLI tools.** If your test suite needs `playwright`, `pytest`, `cargo`, or `dotnet`, install them in the image. The AI agent can't install system packages at runtime (read-only root filesystem).

**Match your CI environment.** If your CI runs on `ubuntu-22.04` with specific tool versions, mirror that in the agent image. This avoids false positives where the agent's changes work in its pod but fail in CI.

**Test locally first.** Verify your image works before deploying:

```bash
# Build
docker build -t cockpit-agent:test -f Dockerfile.agent .

# Smoke test — can the AI CLI start?
docker run --rm -u 1001 -e HOME=/tmp cockpit-agent:test claude --version

# Smoke test — can git clone and setup work?
docker run --rm -u 1001 -e HOME=/tmp -e GITHUB_TOKEN=$GITHUB_TOKEN cockpit-agent:test \
  bash -c "cd /tmp && git clone https://github.com/your-org/cockpit && cd cockpit && pnpm install"
```

**Use `.agentflow.yaml` in the repo for iteration.** During development, setting `agent_image` in the repo itself (`.agentflow.yaml`) lets you update the image reference without redeploying the orchestrator.

## Example: Full Setup for a Python Project

```dockerfile
# Dockerfile.agent — run: docker build -t cockpit-agent:latest -f Dockerfile.agent .
# (from the Agentflow repo root)

# Stage 1: Build the Agentflow agent runner
FROM node:22-slim AS agentflow-builder
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/agentflow/package.json apps/agentflow/
COPY packages/*/package.json packages/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Stage 2: Python agent image
FROM registry.example.com/agentflow-base:0.1.0

USER root

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv \
      libpq-dev gcc && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

# Pre-install Python dependencies
COPY requirements.txt /opt/deps/
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install -r /opt/deps/requirements.txt

COPY --from=agentflow-builder /app /app

USER 1001
```

```yaml
# agentflow.yaml
repos:
  cockpit:
    url: "https://github.com/your-org/cockpit"
    labels: ["agentflow"]
    agent_image: "registry.example.com/cockpit-agent:latest"
    setup: "cp -r /opt/venv .venv"
    checks:
      lint: ".venv/bin/ruff check ."
      test: ".venv/bin/pytest"
```
