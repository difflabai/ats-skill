---
name: ats
description: Connect to ATS backend for task orchestration. Use when creating, listing, claiming, or completing tasks, watching real-time events, or coordinating work between agents and humans.
---

# ATS Backend Skill

Connect to and interact with the Agent Task Service (ATS) backend for task orchestration between AI agents and humans.

## Overview

The Agent Task Service is a PostgreSQL-backed task orchestration platform that enables intelligent handoffs between agents and humans. Use this skill when you need to:

- Create, list, claim, or complete tasks
- Subscribe to real-time task events
- Send messages on task threads
- Coordinate work between agents and humans

## Prerequisites

**FIRST: Verify ATS CLI Installation**

```bash
ats --version  # Requires v1.x+
```

If not installed:

```bash
npm install -g @difflabai/ats-cli
```

**Default Server:** `https://ats.difflab.ai`

**Environment Variables:**
- `ATS_URL` - Override server URL
- `ATS_ORG` - Default organization
- `ATS_PROJECT` - Default project
- `ATS_ACTOR_TYPE` - Default actor type (human, agent, system)
- `ATS_ACTOR_ID` - Default actor ID
- `ATS_ACTOR_NAME` - Default actor display name

---

## Configuration

ATS CLI stores defaults in `~/.ats/config`:

```json
{
  "organization": "default",
  "project": "main",
  "url": "https://ats.difflab.ai",
  "actor": {
    "type": "agent",
    "id": "claude-code",
    "name": "Claude Code"
  }
}
```

**Priority:** CLI flags > environment variables > config file > defaults

---

## Statistics

```bash
# Aggregate task statistics (totals, by status, by channel)
ats stats

# JSON output
ats stats -f json
```

---

## Project Commands

### Initialize a Project in Current Directory

Bind the current directory to an org/project so all `ats` commands automatically scope to it:

```bash
# Bind to existing project
ats project init myorg/myproject

# With explicit flags
ats project init --org myorg --project myproject

# Overwrite existing config
ats project init myorg/myproject --force

# Skip server existence check (for projects that will be created later, or offline use)
ats project init myorg/myproject --skip-existence-check
```

Creates a `.ats/project.json` file in the current directory. By default, `project init` verifies that the org/project exists on the server before creating the local binding. Use `--skip-existence-check` when initializing a binding for a project that hasn't been created yet or when working offline.

### List Projects

```bash
# List all projects across all organizations (with task counts)
ats project list

# JSON output
ats project list -f json
```

Shows project path (`org/project`), display name, pending/active/total task counts. Current project is marked with `*`.

### Create a Project

```bash
# Create project (auto-creates org if it doesn't exist)
ats project create myorg/myproject

# With display name and description
ats project create myorg/myproject --name "My Project" --description "Project description"
```

### Switch Default Project

Set the global default project (used when no local `.ats/project.json` exists):

```bash
ats project switch myorg/myproject
```

### Show Current Project

```bash
# Show which project is active and where the config comes from
ats project current
```

### Show Full Project Configuration

Displays global config, local config, and effective settings:

```bash
ats project show

# JSON output
ats project show -f json
```

### Rename a Project or Organization

```bash
# Rename project slug
ats project rename myorg/oldslug myorg/newslug

# Rename just the project slug
ats project rename myorg/myproject --slug new-slug

# Rename display name
ats project rename myorg/myproject --name "New Display Name"

# Rename org and project together
ats project rename oldorg/oldproject neworg/newproject
```

Automatically updates local and global configs if the renamed project was the current project.

---

## Task Operations

### List Tasks

```bash
# List pending tasks (default - what needs attention)
ats list

# List all tasks
ats list --all

# Filter by status, channel, type
ats list --status in_progress
ats list --channel reviews
ats list --type approval

# Combine filters
ats list --status pending --channel support --limit 10

# JSON output for scripting
ats list -f json | jq '.[] | .title'
```

### Create a Task

```bash
# Simple task
ats create "Review the pull request"

# With options
ats create "Deploy to production" \
  --type deployment \
  --channel ops \
  --priority 8 \
  --description "Deploy v2.1.0 to production cluster"

# With JSON payload
ats create "Process data import" \
  --payload '{"source": "s3://bucket/data.csv", "rows": 50000}'
```

**Priority levels:** 1-10, higher is more urgent (default: 5)

### Get Task Details

```bash
# Human-readable output
ats get 123

# JSON for scripting
ats get 123 -f json | jq '.status'
```

### Update a Task

```bash
ats update 123 --priority 9
ats update 123 --title "Updated title" --description "New description"
```

### Claim a Task (Start Working)

Claiming moves the task to `in_progress` and starts a lease timer:

```bash
ats claim 123

# Custom lease duration (ms)
ats claim 123 --lease 120000
```

**Important:** The lease expires after 60 seconds by default. If the worker crashes, the task returns to `pending` automatically.

### Complete a Task

```bash
# Simple completion
ats complete 123

# With output data
ats complete 123 --outputs '{"result": "Approved", "notes": "LGTM"}'
```

### Cancel a Task

```bash
ats cancel 123
```

### Fail a Task

```bash
ats fail 123 --reason "Unable to connect to external service"
```

### Reject a Task

```bash
ats reject 123 --reason "This task is outside my capabilities"
```

### Reopen a Task

Reopen a task from a terminal state (`completed`, `cancelled`, `failed`, `rejected`) back to `pending`:

```bash
ats reopen 123

# With reason
ats reopen 123 --reason "Need to revisit this task"
```

### Delete a Task

```bash
ats delete 123
```

---

## Message Operations

### Add a Message to a Task

```bash
# Simple text message
ats message add 123 "I've started working on this"

# With content type
ats message add 123 '{"status": "analyzing", "progress": 50}' --type data
```

### List Messages for a Task

```bash
ats message list 123

# JSON output
ats message list 123 -f json
```

---

## Real-Time Events

### Watch for Events

```bash
# Watch all events
ats watch

# Filter by channel
ats watch --channel support

# Filter by task type
ats watch --type approval

# Filter by specific events
ats watch --events task.created,task.completed
```

**Event Types:**
- `task.created` - New task created
- `task.claimed` - Task claimed by worker
- `task.updated` - Task fields modified
- `task.completed` - Task finished successfully
- `task.cancelled` - Task cancelled
- `task.failed` - Task failed with error
- `task.rejected` - Task rejected by worker
- `task.reopened` - Task reopened from terminal state
- `task.message` - New message added
- `task.lease_expired` - Worker lease expired, task returned to pending

---

## Task Status Flow

```
pending ──claim──→ in_progress ──complete──→ completed ──┐
   ↑                    │                                │
   │                    ├──cancel───→ cancelled ─────────┤
   │                    │                                │
   │                    ├──fail─────→ failed ────────────┼──reopen──→ pending
   │                    │                                │
   │                    └─(lease expires)─→ pending      │
   │                                                     │
   └──reject──→ rejected ────────────────────────────────┘
```

**Terminal states:** `completed`, `cancelled`, `failed`, `rejected` (all can be reopened)

---

## Common Patterns

### Pattern 1: Create Task and Wait for Human Response

```bash
# Create task for human review
TASK_ID=$(ats create "Approve deployment" --type approval --channel ops -f json | jq -r '.id')
echo "Created task: $TASK_ID"

# Poll for completion
while true; do
  STATUS=$(ats get $TASK_ID -f json | jq -r '.status')
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "rejected" ]; then
    echo "Task finished with status: $STATUS"
    break
  fi
  sleep 5
done
```

### Pattern 2: Claim and Process Tasks

```bash
# Get first pending task of a specific type
TASK_ID=$(ats list --type code-review -f json | jq -r '.[0].id')

# Claim it
ats claim $TASK_ID

# Do the work...

# Complete with results
ats complete $TASK_ID --outputs '{"review": "LGTM, approved"}'
```

### Pattern 3: Escalate to Human

When Claude Code encounters something requiring human decision:

```bash
ats create "Human decision required: Delete production database?" \
  --type escalation \
  --channel urgent \
  --priority 10 \
  --description "The user requested to delete the production database. This requires human approval." \
  --payload '{
    "context": "User command: DROP DATABASE production",
    "risk_level": "critical",
    "suggested_action": "confirm_with_user"
  }'
```

### Pattern 4: Pipeline with jq

```bash
# Get high-priority pending tasks
ats list -f json | jq '.[] | select(.priority >= 8)'

# Count tasks by status
ats list --all -f json | jq 'group_by(.status) | map({status: .[0].status, count: length})'

# Get task IDs for a channel
ats list --channel support -f json | jq -r '.[].id'
```

---

## Actor Identity

Configure how you appear in ATS:

```bash
# As an agent (default for Claude Code)
ats list --actor-type agent --actor-id claude-code --actor-name "Claude Code Agent"

# As a human
ats list --actor-type human --actor-id user-123 --actor-name "John Doe"

# Or set via environment
export ATS_ACTOR_TYPE=agent
export ATS_ACTOR_ID=claude-code
export ATS_ACTOR_NAME="Claude Code Agent"
```

---

## Health Check

```bash
ats health
```

---

## Global Options

| Option | Short | Description |
|--------|-------|-------------|
| `--url` | `-u` | Service URL (default: https://ats.difflab.ai) |
| `--org` | | Override default organization |
| `--project` | | Override default project |
| `--format` | `-f` | Output format: table, json |
| `--actor-type` | | Actor type: human, agent, system |
| `--actor-id` | | Actor identifier |
| `--actor-name` | | Actor display name |
| `--verbose` | `-v` | Verbose output (shows HTTP requests) |
| `--help` | `-h` | Show help |

---

## Quick Reference

| Operation | Command |
|-----------|---------|
| **Tasks** | |
| List pending | `ats list` |
| List all | `ats list --all` |
| Create task | `ats create "title"` |
| Get task | `ats get ID` |
| Update task | `ats update ID --priority 8` |
| Claim task | `ats claim ID` |
| Complete task | `ats complete ID` |
| Cancel task | `ats cancel ID` |
| Fail task | `ats fail ID --reason "..."` |
| Reject task | `ats reject ID --reason "..."` |
| Reopen task | `ats reopen ID --reason "..."` |
| Add message | `ats message add ID "text"` |
| List messages | `ats message list ID` |
| Watch events | `ats watch` |
| Task stats | `ats stats` |
| Health check | `ats health` |
| **Projects** | |
| Init project | `ats project init org/project` |
| List projects | `ats project list` |
| Create project | `ats project create org/project` |
| Switch project | `ats project switch org/project` |
| Current project | `ats project current` |
| Show config | `ats project show` |
| Rename project | `ats project rename org/old org/new` |

---

## Server API Endpoints Not Covered by CLI

The ATS server exposes 61 endpoints across 14 resource groups. The CLI covers tasks, messages, projects, basic org operations, stats, health, and WebSocket events. The following server endpoints have **no CLI equivalent** and must be accessed via direct HTTP calls or the WebSocket API.

### Authentication & Identity (4 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/register` | Register a new identity |
| `GET` | `/auth/me` | Get current authenticated identity |
| `PATCH` | `/auth/me` | Update identity (display_name, email, profile) |
| `GET` | `/auth/identities/:actor_id` | Public identity lookup |

### API Key Management (3 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/api-keys` | Create a new API key |
| `GET` | `/auth/api-keys` | List your API keys (prefix only) |
| `DELETE` | `/auth/api-keys/:id` | Revoke an API key |

### Guardian System (5 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/me/guardian-link` | Agent generates a guardianship link token |
| `POST` | `/auth/guardian-confirm/:token` | Human confirms guardianship |
| `GET` | `/auth/me/guardians` | List guardians / guarded agents |
| `DELETE` | `/auth/me/guardians/:id` | Remove a guardian relationship |
| `POST` | `/auth/guardians/:agent_id/api-keys` | Issue API key for guarded agent |

### Organization Members (4 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/orgs/:org/members` | List members with roles |
| `POST` | `/orgs/:org/members` | Add a member |
| `PATCH` | `/orgs/:org/members/:actorType/:actorId` | Change a member's role |
| `DELETE` | `/orgs/:org/members/:actorType/:actorId` | Remove a member |

### Invitations (5 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/orgs/:org/invitations` | Create an invitation |
| `GET` | `/orgs/:org/invitations` | List org invitations |
| `GET` | `/auth/invitations` | List my pending invitations |
| `POST` | `/auth/invitations/:token/accept` | Accept an invitation |
| `POST` | `/auth/invitations/:token/decline` | Decline an invitation |

### Namespace Permissions (3 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/orgs/:org/permissions` | Grant access (r or rw) |
| `GET` | `/orgs/:org/permissions` | List permissions |
| `DELETE` | `/orgs/:org/permissions/:id` | Revoke a permission |

### Other Missing Operations (3 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `DELETE` | `/orgs/:org` | Delete organization (owner only) |
| `DELETE` | `/orgs/:org/projects/:project` | Delete project (admin+) |
| `POST` | `/_test/reset` | Wipe all data (non-production only) |

**Total: 27 server endpoints with no CLI command** (out of 61 total).
