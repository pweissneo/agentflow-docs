# Notifications

Agentflow notifies you about pipeline events — when a PR is ready for merge, when an issue is quarantined, or when owner attention is needed.

## Supported Channels

| Channel | Status | Trigger events |
|---------|--------|---------------|
| GitHub | Built-in | PR comments, issue comments, `@` mentions |
| Slack | Planned | All pipeline events |
| Telegram | Planned | All pipeline events |
| Email | Planned | All pipeline events |

## GitHub Notifications (Default)

GitHub notifications are always active. The orchestrator communicates through:

- **Issue comments** — research summaries, claim announcements, state transitions
- **PR comments** — reviewer verdicts, review feedback summaries
- **GitHub mentions** — `@owner` mentions when the PR is approved and ready for merge

These trigger standard GitHub notification emails and appear in the GitHub notification inbox.

## Notification Events

| Event | Default behavior |
|-------|-----------------|
| PR approved, ready for merge | GitHub mention on the PR + label `agent:waiting-owner` |
| Issue quarantined | Comment on issue with reason + label `agent:quarantine` |
| PR closed without merge | Comment on issue + label `agent:failed` |
| Max review iterations | Comment explaining the quarantine reason |
| Max CI failures | Comment with last CI failure output |
| Owner reminder | Follow-up comment after `waiting_owner_reminder_interval` (default: 48 hours) |

## Owner Reminder Interval

Configure how often the orchestrator reminds the owner about PRs waiting for merge:

```yaml
orchestrator:
  intervals:
    waiting_owner_reminder_interval: 172800  # 48 hours (in seconds)
```

Minimum value: 60 seconds.

## Labels as Signals

In addition to comments, the orchestrator uses labels to signal state:

| Label | Meaning |
|-------|---------|
| `needs-owner` | Owner attention required |
| `needs-review` | Human review suggested |
| `agent:waiting-owner` | PR approved, waiting for merge |
| `agent:quarantine` | Issue needs human triage |
