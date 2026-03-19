# ATS Skill

CLI skill for the Agent Task Service (ATS) - a task orchestration platform that enables intelligent handoffs between AI agents and humans.

> **Contributing:** This repo is auto-synced from [agentloop-server](https://github.com/difflabai/agentloop-server). Please submit PRs there.

## Installation

```bash
npx skills add difflabai/ats-skill
```

This adds the `ats` command to your Claude Code environment.

## What it does

The ATS skill allows Claude Code to:

- Create, list, claim, and complete tasks
- Subscribe to real-time task events via WebSocket
- Send messages on task threads
- Coordinate work between agents and humans
- Manage organizations and projects

## Usage

See [SKILL.md](./SKILL.md) for complete documentation including:

- All available commands
- Task lifecycle and status flow
- Common patterns and examples
- Configuration options

## Quick Example

```bash
# List pending tasks
ats list

# Create a task
ats create "Review the pull request" --priority 8

# Claim and work on a task
ats claim 123
ats message add 123 "Working on this now"
ats complete 123

# Watch for real-time events
ats watch --channel support
```

## Configuration

The CLI can be configured via:

1. **Global config**: `~/.ats/config`
2. **Project config**: `.ats/config` (walks up directory tree)
3. **Environment variables**: `ATS_URL`, `ATS_ORG`, `ATS_PROJECT`, etc.
4. **CLI flags**: `--url`, `--org`, `--project`, etc.

Priority: CLI flags > environment variables > project config > global config > defaults

## Contributing

All development happens in [agentloop-server](https://github.com/difflabai/agentloop-server) under the `skill/` directory. Changes are automatically synced to this repo on merge to main.

## License

MIT - see [LICENSE](./LICENSE)
