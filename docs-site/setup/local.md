# Local (Development) Setup

Run Agentflow directly on your machine. This is the simplest deployment — agents run as OS processes.

## Prerequisites

- **Node.js 22 LTS** — [nodejs.org](https://nodejs.org/)
- **pnpm** — `corepack enable` (bundled with Node.js 22)
- **At least one AI CLI tool installed:**
    - Claude: `npm install -g @anthropic-ai/claude-code`
    - Codex: `npm install -g @openai/codex`
    - Gemini: `npm install -g @google/gemini-cli`
- **GitHub PAT** with `repo` scope (or a GitHub App token)
- Optional: **Jira API token** if using Jira as work item provider

## 1. Clone and Build

```bash
git clone https://github.com/your-org/agentflow.git
cd agentflow
pnpm install
pnpm build
```

## 2. Configure

```bash
cp config/agentflow.example.yaml config/agentflow.yaml
```

Edit `config/agentflow.yaml` — at minimum, set your repository URL and labels:

```yaml
repos:
  myproject:
    url: "https://github.com/your-org/your-repo"
    labels:
      - "agentflow"
```

See [Configuration](../configuration.md) for all options.

## 3. Set Environment Variables

Export the required credentials:

```bash
export GITHUB_TOKEN=ghp_your_token_here
```

For Claude (pick one):

```bash
# OAuth token (preferred — long-lived)
export CLAUDE_CODE_OAUTH_TOKEN=your_oauth_token

# Or API key
export ANTHROPIC_API_KEY=sk-ant-your_key
```

For Codex:

```bash
export OPENAI_API_KEY=sk-your_key
```

For Gemini:

```bash
export GEMINI_API_KEY=your_key
```

If using Jira:

```bash
export JIRA_EMAIL=you@example.com
export JIRA_API_TOKEN=your_api_token
export JIRA_BASE_URL=https://myorg.atlassian.net
```

!!! tip
    Instead of exporting variables manually, run `agentflow auth setup` to automate provider authentication. See [Authentication](../authentication.md).

## 4. Authenticate AI Providers

Run the auth setup command to configure provider credentials interactively:

```bash
npx tsx apps/agentflow/src/cli.ts auth setup --config config/agentflow.yaml
```

This detects providers from your config and walks you through each OAuth flow. Requires a browser.

## 5. Start

Development mode (with hot-reloading via tsx):

```bash
pnpm dev
```

Or after building:

```bash
npx agentflow start --config config/agentflow.yaml
```

Agentflow starts polling for issues. You can verify it's running:

```bash
curl http://localhost:9090/health
curl http://localhost:9090/metrics
```

## How It Works Locally

In local mode, the Job Runner spawns agents as child OS processes. Each agent gets its own Node.js process with a fresh context.

- **Isolation:** OS process boundaries
- **Credentials:** Inherited from the orchestrator's environment (env vars, dotfiles)
- **Resource limits:** OS-level only
- **Scaling:** Single machine

This is ideal for development and testing. For production, use [Docker Compose](docker.md) or [Kubernetes](kubernetes.md).

If your project needs external service credentials for testing (e.g., API tokens for third-party integrations), see [Application Secrets](../customization/application-secrets.md). In local mode, set the required env vars in your shell before starting the orchestrator.
