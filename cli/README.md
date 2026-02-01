# ATS CLI

Command-line interface for the Agent Task Service.

## Installation

```bash
# From the project root
cd cli
bun link  # Creates a global 'ats' command
```

Or run directly:

```bash
bun run cli/index.js <command>
```

## Quick Start

```bash
# Check service health
ats health

# Create a task
ats task create "Review PR #123" --type review --priority 8

# List pending tasks
ats task list --status pending

# Get task details
ats task get 1

# Claim a task
ats task claim 1

# Add a message
ats message add 1 "Working on this now"

# Complete a task
ats task complete 1 --outputs '[{"name":"result","parts":[{"type":"text","content":"Approved"}]}]'

# Watch for real-time events
ats watch --channel support
```

## Commands

### Health

```bash
ats health
```

### Tasks

```bash
# Create
ats task create <title> [--type <type>] [--channel <channel>] [--priority <1-10>] [--description <text>]

# List
ats task list [--status <status>] [--type <type>] [--channel <channel>] [--limit <n>]

# Get
ats task get <id>

# Update
ats task update <id> [--title <title>] [--description <text>] [--priority <1-10>]

# Lifecycle
ats task claim <id> [--lease <ms>]
ats task complete <id> [--outputs <json>]
ats task cancel <id>
ats task fail <id> [--reason <text>]
ats task reject <id> [--reason <text>]
```

### Messages

```bash
# Add message to task
ats message add <task_id> <content> [--type <content_type>]

# List messages
ats message list <task_id>
```

### Watch (Real-time Events)

```bash
# Watch all events
ats watch

# Filter by channel
ats watch --channel support

# Filter by task type
ats watch --type review

# Filter specific event types
ats watch --events task.created,task.completed
```

## Global Options

| Option | Short | Description |
|--------|-------|-------------|
| `--url` | `-u` | Service URL (default: https://ats.difflab.ai) |
| `--format` | `-f` | Output format: `table` or `json` |
| `--actor-type` | | Actor type: human, agent, system |
| `--actor-id` | | Actor identifier |
| `--actor-name` | | Actor display name |
| `--verbose` | `-v` | Verbose output |
| `--help` | `-h` | Show help |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ATS_URL` | Default service URL |
| `ATS_ACTOR_TYPE` | Default actor type |
| `ATS_ACTOR_ID` | Default actor ID |
| `ATS_ACTOR_NAME` | Default actor name |

## Examples

### Create and complete a task

```bash
# Create
ats task create "Deploy v2.0" --type deployment --channel ops --priority 9

# Claim it
ats task claim 1 --lease 300000

# Add progress notes
ats message add 1 "Starting deployment..."
ats message add 1 "Database migrations complete"
ats message add 1 "Application deployed successfully"

# Complete with output
ats task complete 1 --outputs '[{"name":"deploy_log","parts":[{"type":"text","content":"Deployed to prod at 2024-01-15T10:30:00Z"}]}]'
```

### Monitor a channel

```bash
# In one terminal, watch for events
ats watch --channel support

# In another terminal, create tasks
ats task create "Customer issue #456" --channel support --priority 7
```

### JSON output for scripting

```bash
# Get task as JSON
ats task get 1 -f json

# List tasks as JSON for processing
ats task list --status pending -f json | jq '.[] | .id'
```
