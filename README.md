# Agentflow Docs

User-facing documentation for [agentflow](https://github.com/pweissneo/agentflow-docs) — autonomous software-development agents powered by AI CLI tools.

Hosted at: **<https://pweissneo.github.io/agentflow-docs/>** (live site once GitHub Pages is enabled — see "Enabling Pages" below).

## What lives here

This repository contains **only the docs source** — the MkDocs Material project that builds the public documentation site.

The agentflow source code (orchestrator, agents, providers, etc.) lives in a separate private repository. This split is intentional: the public docs are hostable, indexable, and contributable without exposing internal source.

```
agentflow-docs/
├── docs-site/                 # Markdown source (mirrors the upstream layout)
│   ├── index.md
│   ├── quickstart.md
│   ├── setup/
│   ├── how-it-works/
│   ├── customization/
│   └── …
├── mkdocs.yml                 # MkDocs configuration
├── requirements.txt           # Python build dependencies
└── .github/workflows/deploy.yml
```

## Enabling GitHub Pages (one-time setup)

The repository is preconfigured to deploy on every push to `main` via GitHub Actions. To turn on Pages:

1. Go to **Settings → Pages** in this repository.
2. Under **Source**, select **GitHub Actions**.
3. Push any commit to `main` (or run the *Deploy MkDocs to GitHub Pages* workflow manually). The workflow will build the site and publish it.
4. The site URL appears in the deployment summary; for this repo it will be `https://pweissneo.github.io/agentflow-docs/`.

That's it — subsequent pushes auto-deploy.

## Custom domain (optional)

To serve the docs from a custom domain (e.g. `docs.agentflow.dev`):

1. Add a `CNAME` file at the repo root containing the bare domain.
2. In **Settings → Pages**, set the custom domain.
3. Configure your DNS provider with a `CNAME` record pointing the subdomain to `pweissneo.github.io`.

## Local preview

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
mkdocs serve
```

Then open <http://127.0.0.1:8000/>. Live reload is enabled.

## Updating from upstream

This repo mirrors `docs-site/` and `mkdocs.yml` from the upstream agentflow source tree. To pull the latest:

```bash
# from the upstream agentflow checkout
rsync -av --delete docs-site/ /path/to/agentflow-docs/docs-site/
cp mkdocs.yml /path/to/agentflow-docs/mkdocs.yml
cd /path/to/agentflow-docs && git add -A && git commit -m "docs: sync from upstream" && git push
```

A future CI sync job in the upstream repo can automate this.

## License

See the upstream agentflow project for licensing terms.
