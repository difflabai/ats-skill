#!/usr/bin/env node
/**
 * ATS CLI - Agent Task Service Command Line Interface
 *
 * A comprehensive CLI for managing tasks, events, and messages
 * in the Agent Task Service.
 */

const VERSION = '1.0.1';
const DEFAULT_BASE_URL = process.env.ATS_URL || 'https://ats.difflab.ai';

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(args) {
  const result = {
    command: null,
    subcommand: null,
    positional: [],
    flags: {},
    options: {}
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key.includes('=')) {
        const [k, v] = key.split('=');
        result.options[k] = v;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        result.options[key] = args[i + 1];
        i++;
      } else {
        result.flags[key] = true;
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1);
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        result.options[key] = args[i + 1];
        i++;
      } else {
        result.flags[key] = true;
      }
    } else if (!result.command) {
      result.command = arg;
    } else if (!result.subcommand) {
      result.subcommand = arg;
    } else {
      result.positional.push(arg);
    }
    i++;
  }

  return result;
}

// ============================================================================
// Configuration
// ============================================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

const GLOBAL_CONFIG_PATH = join(homedir(), '.ats', 'config');
const PROJECT_CONFIG_NAME = '.ats/config';

/**
 * Find project-level config by walking up directory tree.
 * Looks for .ats/config in current directory and ancestors.
 * @returns {{ path: string, config: object } | null}
 */
function findProjectConfig() {
  let dir = process.cwd();
  const root = dirname(dir);

  while (dir !== root) {
    const configPath = join(dir, PROJECT_CONFIG_NAME);
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'));
        return { path: configPath, config };
      } catch {
        // Invalid JSON, skip this config
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break; // Reached filesystem root
    dir = parent;
  }

  return null;
}

/**
 * Load global config from ~/.ats/config
 */
function loadGlobalConfig() {
  if (!existsSync(GLOBAL_CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(GLOBAL_CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Load merged config: global config + project config (project takes precedence)
 * @returns {{ global: object, project: object | null, merged: object, projectPath: string | null }}
 */
function loadConfig() {
  const globalConfig = loadGlobalConfig();
  const projectResult = findProjectConfig();

  if (!projectResult) {
    return {
      global: globalConfig,
      project: null,
      merged: globalConfig,
      projectPath: null
    };
  }

  // Merge: project config overrides global config
  // Deep merge for nested 'actor' object
  const merged = {
    ...globalConfig,
    ...projectResult.config,
    actor: {
      ...globalConfig.actor,
      ...projectResult.config.actor
    }
  };

  return {
    global: globalConfig,
    project: projectResult.config,
    merged,
    projectPath: projectResult.path
  };
}

/**
 * Save global config to ~/.ats/config
 */
function saveGlobalConfig(config) {
  const dir = dirname(GLOBAL_CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2));
}

/**
 * Save project config to .ats/config in specified directory (defaults to cwd)
 */
function saveProjectConfig(config, targetDir = process.cwd()) {
  const configPath = join(targetDir, PROJECT_CONFIG_NAME);
  const dir = dirname(configPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

/**
 * Get merged configuration.
 * Priority: CLI flags > environment variables > project config > global config > defaults
 */
function getConfig(options) {
  const { merged: fileConfig, projectPath } = loadConfig();

  // Determine if we should use project-scoped routes
  // Use project scope if org/project are explicitly set via flags, env, or config
  const hasOrgConfig = options.org || process.env.ATS_ORG || fileConfig.organization;
  const hasProjectConfig = options.project || process.env.ATS_PROJECT || fileConfig.project;

  return {
    baseUrl: options.url || options.u || process.env.ATS_URL || fileConfig.url || DEFAULT_BASE_URL,
    organization: options.org || process.env.ATS_ORG || fileConfig.organization || 'default',
    project: options.project || process.env.ATS_PROJECT || fileConfig.project || 'main',
    useProjectScope: !!(hasOrgConfig || hasProjectConfig),
    actor: {
      type: options['actor-type'] || process.env.ATS_ACTOR_TYPE || fileConfig.actor?.type || 'human',
      id: options['actor-id'] || process.env.ATS_ACTOR_ID || fileConfig.actor?.id || `cli-${process.env.USER || 'user'}`,
      name: options['actor-name'] || process.env.ATS_ACTOR_NAME || fileConfig.actor?.name || process.env.USER || 'CLI User'
    },
    format: options.format || options.f || 'table',
    verbose: options.verbose || options.v,
    // Track which project config is being used (for diagnostics)
    _projectConfigPath: projectPath
  };
}

// ============================================================================
// HTTP Client
// ============================================================================

async function request(config, method, path, body = null) {
  const url = `${config.baseUrl}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Actor-Type': config.actor.type,
    'X-Actor-ID': config.actor.id,
    'X-Actor-Name': config.actor.name
  };

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  if (config.verbose) {
    console.error(`→ ${method} ${url}`);
    if (body) console.error(`  Body: ${JSON.stringify(body, null, 2)}`);
  }

  try {
    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || data.message || `HTTP ${response.status}`);
    }

    return data;
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      throw new Error(`Cannot connect to ATS at ${config.baseUrl}. Is the server running?`);
    }
    throw err;
  }
}

/**
 * Build task path - uses project-scoped routes when org/project are set.
 * @param {object} config - Configuration with organization and project
 * @param {string} subpath - Path after /tasks (e.g., '', '/123', '/123/claim')
 * @returns {string} Full API path
 */
function taskPath(config, subpath = '') {
  if (config.useProjectScope && config.organization && config.project) {
    return `/orgs/${config.organization}/projects/${config.project}/tasks${subpath}`;
  }
  return `/tasks${subpath}`;
}

// ============================================================================
// Output Formatting
// ============================================================================

function formatTable(data, columns) {
  if (!Array.isArray(data)) data = [data];
  if (data.length === 0) {
    console.log('No results found.');
    return;
  }

  // Calculate column widths
  const widths = {};
  for (const col of columns) {
    widths[col.key] = col.label.length;
    for (const row of data) {
      const val = String(col.format ? col.format(row[col.key], row) : row[col.key] ?? '');
      widths[col.key] = Math.max(widths[col.key], val.length);
    }
  }

  // Print header
  const header = columns.map(col => col.label.padEnd(widths[col.key])).join('  ');
  console.log(header);
  console.log(columns.map(col => '─'.repeat(widths[col.key])).join('──'));

  // Print rows
  for (const row of data) {
    const line = columns.map(col => {
      const val = String(col.format ? col.format(row[col.key], row) : row[col.key] ?? '');
      return val.padEnd(widths[col.key]);
    }).join('  ');
    console.log(line);
  }
}

function formatOutput(data, format, columns = null) {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else if (columns) {
    formatTable(data, columns);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString();
}

function formatStatus(status) {
  const colors = {
    pending: '\x1b[33m',     // yellow
    in_progress: '\x1b[36m', // cyan
    completed: '\x1b[32m',   // green
    cancelled: '\x1b[90m',   // gray
    failed: '\x1b[31m',      // red
    rejected: '\x1b[35m'     // magenta
  };
  const reset = '\x1b[0m';
  return `${colors[status] || ''}${status}${reset}`;
}

function formatPriority(p) {
  if (p >= 8) return `\x1b[31m${p}\x1b[0m`;  // red for high
  if (p >= 5) return `\x1b[33m${p}\x1b[0m`;  // yellow for medium
  return `\x1b[32m${p}\x1b[0m`;               // green for low
}

// ============================================================================
// Task Columns
// ============================================================================

const TASK_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'title', label: 'Title', format: (v) => v?.substring(0, 40) || '' },
  { key: 'status', label: 'Status', format: formatStatus },
  { key: 'priority', label: 'Pri', format: formatPriority },
  { key: 'type', label: 'Type' },
  { key: 'channel', label: 'Channel' },
  { key: 'assignee_name', label: 'Assignee' },
  { key: 'created_at', label: 'Created', format: formatTimestamp }
];

const TASK_DETAIL_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status', format: formatStatus },
  { key: 'priority', label: 'Priority', format: formatPriority },
  { key: 'type', label: 'Type' },
  { key: 'channel', label: 'Channel' },
  { key: 'source_name', label: 'Source' },
  { key: 'assignee_name', label: 'Assignee' },
  { key: 'created_at', label: 'Created', format: formatTimestamp },
  { key: 'updated_at', label: 'Updated', format: formatTimestamp }
];

const EVENT_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'type', label: 'Event Type' },
  { key: 'task_id', label: 'Task' },
  { key: 'actor_name', label: 'Actor' },
  { key: 'channel', label: 'Channel' },
  { key: 'created_at', label: 'Time', format: formatTimestamp }
];

const MESSAGE_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'actor_name', label: 'From' },
  { key: 'parts', label: 'Content', format: (parts) => {
    if (!parts || !parts.length) return '';
    const first = parts[0];
    if (first.type === 'text') return first.content?.substring(0, 50) || '';
    return `[${first.type}]`;
  }},
  { key: 'created_at', label: 'Time', format: formatTimestamp }
];

// ============================================================================
// Commands
// ============================================================================

const commands = {};

// --- Health ---
commands.health = async function(args, config) {
  const data = await request(config, 'GET', '/health');
  console.log(`✓ Service is ${data.status}`);
  console.log(`  Timestamp: ${data.timestamp}`);
};

// --- Stats ---
commands.stats = async function(args, config) {
  const data = await request(config, 'GET', '/tasks/stats');
  const stats = data.stats || data;

  if (config.format === 'json') {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  // Pretty print stats
  console.log('\n┌─ Task Statistics ──────────────────────────────────');
  console.log(`│ Total Tasks:          ${stats.total}`);
  console.log('├─ By Status ────────────────────────────────────────');

  const statusOrder = ['pending', 'in_progress', 'completed', 'cancelled', 'failed', 'rejected'];
  for (const status of statusOrder) {
    const count = stats.by_status[status] || 0;
    if (count > 0 || status === 'pending' || status === 'in_progress' || status === 'completed') {
      console.log(`│   ${formatStatus(status).padEnd(20)} ${count}`);
    }
  }

  console.log('├─ By Channel ───────────────────────────────────────');
  const channels = Object.entries(stats.by_channel || {}).slice(0, 5);
  if (channels.length === 0) {
    console.log('│   (none)');
  } else {
    for (const [channel, count] of channels) {
      console.log(`│   ${channel.padEnd(20)} ${count}`);
    }
  }

  console.log('├─ Performance ──────────────────────────────────────');
  const avgMinutes = stats.avg_completion_seconds ? (stats.avg_completion_seconds / 60).toFixed(1) : 0;
  console.log(`│   Avg Completion:     ${avgMinutes} minutes`);
  console.log(`│   Completed Tasks:    ${stats.completed_count}`);

  console.log('├─ Recent Activity ──────────────────────────────────');
  console.log(`│   Created (24h):      ${stats.recent?.created_24h || 0}`);
  console.log(`│   Completed (24h):    ${stats.recent?.completed_24h || 0}`);
  console.log(`│   Created (7d):       ${stats.recent?.created_7d || 0}`);
  console.log(`│   Completed (7d):     ${stats.recent?.completed_7d || 0}`);
  console.log('└────────────────────────────────────────────────────\n');
};

// --- Task Commands ---
commands.create = async function(args, config) {
  const { positional, options } = args;
  const title = positional[0] || options.title;

  if (!title) {
    console.error('Error: Title is required');
    console.error('Usage: ats create <title> [options]');
    console.error('  --type <type>        Task type');
    console.error('  --channel <channel>  Task channel');
    console.error('  --priority <1-10>    Priority (default: 5)');
    console.error('  --description <text> Task description');
    console.error('  --payload <json>     Task payload as JSON');
    process.exit(1);
  }

  const body = {
    title,
    type: options.type || 'task',
    channel: options.channel || 'default',
    priority: parseInt(options.priority, 10) || 5,
    description: options.description,
    payload: options.payload ? JSON.parse(options.payload) : undefined
  };

  const result = await request(config, 'POST', taskPath(config), body);
  const task = result.task || result;
  console.log(`✓ Task created with ID: ${task.id}`);
  formatOutput(task, config.format, TASK_DETAIL_COLUMNS);
};

commands.get = async function(args, config) {
  const id = args.positional[0] || args.options.id;
  if (!id) {
    console.error('Error: Task ID is required');
    console.error('Usage: ats get <id>');
    process.exit(1);
  }

  const result = await request(config, 'GET', taskPath(config, `/${id}`));
  const task = result.task || result;

  if (config.format === 'json') {
    formatOutput(task, config.format);
  } else {
    // Pretty print task details
    console.log('\n┌─ Task Details ─────────────────────────────────────');
    console.log(`│ ID:          ${task.id}`);
    console.log(`│ Title:       ${task.title}`);
    console.log(`│ Status:      ${formatStatus(task.status)}`);
    console.log(`│ Priority:    ${formatPriority(task.priority)}`);
    console.log(`│ Type:        ${task.type || '-'}`);
    console.log(`│ Channel:     ${task.channel || '-'}`);
    console.log(`│ Source:      ${task.source_name || '-'} (${task.source_type || '-'})`);
    console.log(`│ Assignee:    ${task.assignee_name || '-'} (${task.assignee_type || '-'})`);
    console.log(`│ Created:     ${formatTimestamp(task.created_at)}`);
    console.log(`│ Updated:     ${formatTimestamp(task.updated_at)}`);
    if (task.lease_expires) {
      console.log(`│ Lease:       ${formatTimestamp(task.lease_expires)}`);
    }
    console.log('├─ Description ──────────────────────────────────────');
    console.log(`│ ${task.description || '(no description)'}`);
    if (task.payload && Object.keys(task.payload).length > 0) {
      console.log('├─ Payload ─────────────────────────────────────────');
      console.log(`│ ${JSON.stringify(task.payload, null, 2).split('\n').join('\n│ ')}`);
    }
    if (task.outputs && task.outputs.length > 0) {
      console.log('├─ Outputs ─────────────────────────────────────────');
      console.log(`│ ${JSON.stringify(task.outputs, null, 2).split('\n').join('\n│ ')}`);
    }
    if (task.messages && task.messages.length > 0) {
      console.log('├─ Messages ────────────────────────────────────────');
      for (const msg of task.messages) {
        const content = msg.parts?.[0]?.content || '[non-text]';
        console.log(`│ [${msg.actor_name}] ${content}`);
      }
    }
    console.log('└────────────────────────────────────────────────────\n');
  }
};

commands.list = async function(args, config) {
  const { options, flags } = args;
  const params = new URLSearchParams();

  // Default to pending unless --all or explicit --status is provided
  const showAll = flags.all || options.all;
  if (options.status) {
    params.append('status', options.status);
  } else if (!showAll) {
    params.append('status', 'pending');
  }

  if (options.type) params.append('type', options.type);
  if (options.channel) params.append('channel', options.channel);
  if (options.assignee) params.append('assignee_id', options.assignee);
  if (options.limit) params.append('limit', options.limit);
  if (options.offset) params.append('offset', options.offset);

  const query = params.toString();
  const basePath = taskPath(config);
  const path = `${basePath}${query ? '?' + query : ''}`;
  const result = await request(config, 'GET', path);
  const tasks = result.tasks || result;
  const count = result.count || tasks.length;

  if (tasks.length === 0) {
    if (!showAll && !options.status) {
      console.log('No pending tasks. Use --all to see all tasks.');
    } else {
      console.log('No tasks found.');
    }
    return;
  }

  formatOutput(tasks, config.format, TASK_COLUMNS);
  const statusNote = !showAll && !options.status ? ' (pending only, use --all for all)' : '';
  console.log(`\n${count} task(s) found${statusNote}`);
};

commands.update = async function(args, config) {
  const id = args.positional[0] || args.options.id;
  if (!id) {
    console.error('Error: Task ID is required');
    console.error('Usage: ats update <id> [options]');
    process.exit(1);
  }

  const { options } = args;
  const body = {};

  if (options.title) body.title = options.title;
  if (options.description) body.description = options.description;
  if (options.priority) body.priority = parseInt(options.priority, 10);
  if (options.status) body.status = options.status;
  if (options.type) body.type = options.type;
  if (options.channel) body.channel = options.channel;
  if (options.payload) body.payload = JSON.parse(options.payload);

  if (Object.keys(body).length === 0) {
    console.error('Error: No updates specified');
    process.exit(1);
  }

  const result = await request(config, 'PATCH', taskPath(config, `/${id}`), body);
  const task = result.task || result;
  console.log(`✓ Task ${id} updated`);
  formatOutput(task, config.format, TASK_DETAIL_COLUMNS);
};

commands.claim = async function(args, config) {
  const id = args.positional[0] || args.options.id;
  if (!id) {
    console.error('Error: Task ID is required');
    console.error('Usage: ats claim <id> [--lease <duration_ms>]');
    process.exit(1);
  }

  const body = {};
  if (args.options.lease) {
    body.lease_duration = parseInt(args.options.lease, 10);
  }

  const result = await request(config, 'POST', taskPath(config, `/${id}/claim`), body);
  const task = result.task || result;
  console.log(`✓ Task ${id} claimed`);
  console.log(`  Assignee: ${task.assignee_name}`);
  console.log(`  Lease expires: ${formatTimestamp(task.lease_expires)}`);
};

commands.complete = async function(args, config) {
  const id = args.positional[0] || args.options.id;
  if (!id) {
    console.error('Error: Task ID is required');
    console.error('Usage: ats complete <id> [--outputs <json>]');
    process.exit(1);
  }

  const body = {};
  if (args.options.outputs) {
    const parsed = JSON.parse(args.options.outputs);
    body.outputs = Array.isArray(parsed) ? parsed : [parsed];
  }

  await request(config, 'POST', taskPath(config, `/${id}/complete`), body);
  console.log(`✓ Task ${id} completed`);
};

commands.cancel = async function(args, config) {
  const id = args.positional[0] || args.options.id;
  if (!id) {
    console.error('Error: Task ID is required');
    console.error('Usage: ats cancel <id>');
    process.exit(1);
  }

  await request(config, 'POST', taskPath(config, `/${id}/cancel`));
  console.log(`✓ Task ${id} cancelled`);
};

commands.fail = async function(args, config) {
  const id = args.positional[0] || args.options.id;
  if (!id) {
    console.error('Error: Task ID is required');
    console.error('Usage: ats fail <id> [--reason <text>]');
    process.exit(1);
  }

  const body = {};
  if (args.options.reason) {
    body.reason = args.options.reason;
  }

  await request(config, 'POST', taskPath(config, `/${id}/fail`), body);
  console.log(`✓ Task ${id} marked as failed`);
};

commands.reject = async function(args, config) {
  const id = args.positional[0] || args.options.id;
  if (!id) {
    console.error('Error: Task ID is required');
    console.error('Usage: ats reject <id> [--reason <text>]');
    process.exit(1);
  }

  const body = {};
  if (args.options.reason) {
    body.reason = args.options.reason;
  }

  await request(config, 'POST', taskPath(config, `/${id}/reject`), body);
  console.log(`✓ Task ${id} rejected`);
};

// --- Message Commands ---
commands.message = {
  async add(args, config) {
    const taskId = args.positional[0] || args.options.task;
    const content = args.positional[1] || args.options.content;

    if (!taskId || !content) {
      console.error('Error: Task ID and content are required');
      console.error('Usage: ats message add <task_id> <content>');
      console.error('  --type <type>  Content type (default: text)');
      process.exit(1);
    }

    const body = {
      parts: [{
        type: args.options.type || 'text',
        content
      }]
    };

    const result = await request(config, 'POST', taskPath(config, `/${taskId}/messages`), body);
    const message = result.message || result;
    console.log(`✓ Message added to task ${taskId}`);
    formatOutput(message, config.format, MESSAGE_COLUMNS);
  },

  async list(args, config) {
    const taskId = args.positional[0] || args.options.task;

    if (!taskId) {
      console.error('Error: Task ID is required');
      console.error('Usage: ats message list <task_id>');
      process.exit(1);
    }

    const result = await request(config, 'GET', taskPath(config, `/${taskId}/messages`));
    const messages = result.messages || result;

    if (messages.length === 0) {
      console.log('No messages found.');
      return;
    }

    if (config.format === 'json') {
      formatOutput(messages, config.format);
    } else {
      console.log(`\n─── Messages for Task ${taskId} ───\n`);
      for (const msg of messages) {
        const time = formatTimestamp(msg.created_at);
        const actor = `${msg.actor_name || 'Unknown'} (${msg.actor_type})`;
        console.log(`[${time}] ${actor}:`);
        for (const part of msg.parts || []) {
          if (part.type === 'text') {
            console.log(`  ${part.content}`);
          } else {
            console.log(`  [${part.type}]: ${part.url || part.data || '(binary)'}`);
          }
        }
        console.log();
      }
      console.log(`${messages.length} message(s)`);
    }
  }
};

// --- Repo Commands ---
/**
 * Parse org/project notation (e.g., "myorg/myproject")
 * @param {string} repoString - Repository string in org/project format
 * @returns {{ org: string, project: string } | null}
 */
function parseRepoString(repoString) {
  if (!repoString || !repoString.includes('/')) return null;
  const [org, project] = repoString.split('/', 2);
  if (!org || !project) return null;
  return { org, project };
}

const REPO_COLUMNS = [
  { key: 'repo', label: 'Repository' },
  { key: 'name', label: 'Name' },
  { key: 'pending_count', label: 'Pending' },
  { key: 'in_progress_count', label: 'Active' },
  { key: 'total_count', label: 'Total' }
];

commands.repo = {
  async init(args, config) {
    const { positional, options, flags } = args;

    // Parse org/project from positional argument or options
    let org, project;
    const repoArg = positional[0];

    if (repoArg && repoArg.includes('/')) {
      const parsed = parseRepoString(repoArg);
      if (parsed) {
        org = parsed.org;
        project = parsed.project;
      }
    } else {
      org = options.org || config.organization;
      project = options.project || config.project;
    }

    if (!org || !project) {
      console.error('Error: Repository required in org/project format');
      console.error('Usage: ats repo init <org/project>');
      console.error('       ats repo init --org <org> --project <project>');
      process.exit(1);
    }

    // Check if project config already exists in current directory
    const existingPath = join(process.cwd(), PROJECT_CONFIG_NAME);
    if (existsSync(existingPath) && !flags.force) {
      console.error(`Error: Repository config already exists at ${existingPath}`);
      console.error('Use --force to overwrite.');
      process.exit(1);
    }

    // Verify org/project exist if not using --no-verify
    if (!flags['no-verify']) {
      try {
        await request(config, 'GET', `/orgs/${org}/projects/${project}`);
      } catch (err) {
        console.error(`Error: Could not verify repository ${org}/${project}: ${err.message}`);
        console.error('Use --no-verify to skip verification.');
        process.exit(1);
      }
    }

    const projectConfig = {
      organization: org,
      project: project
    };

    // Optionally include URL if different from default
    if (options.url && options.url !== DEFAULT_BASE_URL) {
      projectConfig.url = options.url;
    }

    const savedPath = saveProjectConfig(projectConfig);
    console.log(`✓ Directory bound to repository: ${org}/${project}`);
    console.log(`  Config: ${savedPath}`);
    console.log('\nAll ats commands in this directory will now use this repository.');
  },

  async list(args, config) {
    // Get all orgs, then all projects for each org, flatten into repo list
    const orgsResult = await request(config, 'GET', '/orgs');
    const orgs = orgsResult.organizations || [];

    if (orgs.length === 0) {
      console.log('No organizations found. Create one with: ats repo create <org/project>');
      return;
    }

    const repos = [];
    for (const org of orgs) {
      const projectsResult = await request(config, 'GET', `/orgs/${org.slug}/projects?counts=true`);
      const projects = projectsResult.projects || [];

      for (const proj of projects) {
        repos.push({
          repo: `${org.slug}/${proj.slug}`,
          name: proj.name || proj.slug,
          pending_count: proj.pending_count || 0,
          in_progress_count: proj.in_progress_count || 0,
          total_count: proj.total_count || 0,
          org_slug: org.slug,
          project_slug: proj.slug
        });
      }
    }

    if (repos.length === 0) {
      console.log('No repositories found. Create one with: ats repo create <org/project>');
      return;
    }

    // Mark current repo
    const currentRepo = `${config.organization}/${config.project}`;
    for (const repo of repos) {
      if (repo.repo === currentRepo) {
        repo.repo = `${repo.repo} *`;
      }
    }

    formatOutput(repos, config.format, REPO_COLUMNS);
    console.log(`\n${repos.length} repository(s) (* = current)`);
  },

  async create(args, config) {
    const { positional, options } = args;
    const repoArg = positional[0];

    if (!repoArg || !repoArg.includes('/')) {
      console.error('Error: Repository required in org/project format');
      console.error('Usage: ats repo create <org/project> [--name "Project Name"] [--description "..."]');
      process.exit(1);
    }

    const parsed = parseRepoString(repoArg);
    if (!parsed) {
      console.error('Error: Invalid repository format. Use org/project');
      process.exit(1);
    }

    const { org, project } = parsed;

    // Check if org exists, create if not
    try {
      await request(config, 'GET', `/orgs/${org}`);
    } catch {
      // Org doesn't exist, create it
      console.log(`Creating organization: ${org}`);
      await request(config, 'POST', '/orgs', { slug: org, name: org });
    }

    // Create the project
    const body = {
      slug: project,
      name: options.name || project,
      description: options.description
    };

    const result = await request(config, 'POST', `/orgs/${org}/projects`, body);
    const proj = result.project || result;
    console.log(`✓ Repository created: ${org}/${proj.slug}`);
  },

  async switch(args, config) {
    const { positional } = args;
    const repoArg = positional[0];

    if (!repoArg || !repoArg.includes('/')) {
      console.error('Error: Repository required in org/project format');
      console.error('Usage: ats repo switch <org/project>');
      process.exit(1);
    }

    const parsed = parseRepoString(repoArg);
    if (!parsed) {
      console.error('Error: Invalid repository format. Use org/project');
      process.exit(1);
    }

    const { org, project } = parsed;

    // Verify repo exists
    await request(config, 'GET', `/orgs/${org}/projects/${project}`);

    // Save to global config file
    const globalConfig = loadGlobalConfig();
    globalConfig.organization = org;
    globalConfig.project = project;
    saveGlobalConfig(globalConfig);

    console.log(`✓ Switched to repository: ${org}/${project}`);
  },

  async current(args, config) {
    const { projectPath } = loadConfig();
    const repo = `${config.organization}/${config.project}`;

    console.log(`Current repository: ${repo}`);
    if (projectPath) {
      console.log(`  Source: ${projectPath}`);
    } else {
      console.log(`  Source: global config`);
    }
  },

  async show(args, config) {
    const { global: globalConfig, project: projectConfig, projectPath } = loadConfig();

    if (config.format === 'json') {
      console.log(JSON.stringify({
        current: `${config.organization}/${config.project}`,
        global: {
          path: GLOBAL_CONFIG_PATH,
          repo: globalConfig.organization && globalConfig.project
            ? `${globalConfig.organization}/${globalConfig.project}`
            : null,
          url: globalConfig.url || DEFAULT_BASE_URL
        },
        local: projectPath ? {
          path: projectPath,
          repo: projectConfig.organization && projectConfig.project
            ? `${projectConfig.organization}/${projectConfig.project}`
            : null,
          url: projectConfig.url || null
        } : null,
        effective: {
          repo: `${config.organization}/${config.project}`,
          url: config.baseUrl,
          actor: config.actor
        }
      }, null, 2));
      return;
    }

    console.log('\n┌─ Repository Configuration ─────────────────────────');
    console.log(`│ Current:       ${config.organization}/${config.project}`);
    console.log('├─ Global Config ────────────────────────────────────');
    console.log(`│ Path:          ${GLOBAL_CONFIG_PATH}`);
    const globalRepo = globalConfig.organization && globalConfig.project
      ? `${globalConfig.organization}/${globalConfig.project}`
      : '(not set)';
    console.log(`│ Repository:    ${globalRepo}`);
    console.log(`│ URL:           ${globalConfig.url || '(default)'}`);

    console.log('├─ Local Config ─────────────────────────────────────');
    if (projectPath) {
      console.log(`│ Path:          ${projectPath}`);
      const localRepo = projectConfig.organization && projectConfig.project
        ? `${projectConfig.organization}/${projectConfig.project}`
        : '(not set)';
      console.log(`│ Repository:    ${localRepo}`);
      console.log(`│ URL:           ${projectConfig.url || '(inherited)'}`);
    } else {
      console.log('│ (no local config found)');
    }

    console.log('├─ Effective Settings ───────────────────────────────');
    console.log(`│ Repository:    ${config.organization}/${config.project}`);
    console.log(`│ URL:           ${config.baseUrl}`);
    console.log(`│ Actor:         ${config.actor.name} (${config.actor.type})`);
    console.log('└────────────────────────────────────────────────────\n');
  },

  async rename(args, config) {
    const { positional, options } = args;
    const repoArg = positional[0];
    const targetArg = positional[1];

    if (!repoArg || !repoArg.includes('/')) {
      console.error('Error: Repository required in org/project format');
      console.error('Usage: ats repo rename <org/project> <new-org/new-project>');
      console.error('       ats repo rename <org/project> --slug <new-project-slug>');
      console.error('       ats repo rename <org/project> --name <display-name>');
      process.exit(1);
    }

    const parsed = parseRepoString(repoArg);
    if (!parsed) {
      console.error('Error: Invalid repository format. Use org/project');
      process.exit(1);
    }

    const { org, project } = parsed;

    // Parse target - can be org/project format or just project slug
    let newOrg = null;
    let newProject = options.slug || null;
    const newName = options.name;

    if (targetArg) {
      if (targetArg.includes('/')) {
        const targetParsed = parseRepoString(targetArg);
        if (targetParsed) {
          if (targetParsed.org !== org) {
            newOrg = targetParsed.org;
          }
          if (targetParsed.project !== project) {
            newProject = targetParsed.project;
          }
        }
      } else {
        // Just a project slug
        newProject = targetArg;
      }
    }

    if (!newOrg && !newProject && !newName) {
      console.error('Error: Must specify target org/project, --slug, or --name');
      console.error('Usage: ats repo rename <org/project> <new-org/new-project>');
      console.error('       ats repo rename <org/project> --slug <new-project-slug>');
      console.error('       ats repo rename <org/project> --name <display-name>');
      process.exit(1);
    }

    let finalOrg = org;
    let finalProject = project;

    // Rename org if needed
    if (newOrg) {
      const orgBody = { slug: newOrg };
      const orgResult = await request(config, 'PATCH', `/orgs/${org}`, orgBody);
      const updatedOrg = orgResult.organization || orgResult;
      finalOrg = updatedOrg.slug || newOrg;
      console.log(`✓ Organization renamed: ${org} → ${finalOrg}`);
    }

    // Rename project if needed
    if (newProject || newName) {
      const projBody = {};
      if (newProject) projBody.slug = newProject;
      if (newName) projBody.name = newName;

      const projResult = await request(config, 'PATCH', `/orgs/${finalOrg}/projects/${project}`, projBody);
      const updatedProj = projResult.project || projResult;
      finalProject = updatedProj.slug || newProject || project;
      console.log(`✓ Project renamed: ${project} → ${finalProject}`);
      if (newName) {
        console.log(`  Name: ${updatedProj.name || newName}`);
      }
    }

    console.log(`✓ Repository: ${finalOrg}/${finalProject}`);

    // Update local config if this was the current repo
    const { project: projectConfig, projectPath } = loadConfig();
    if (projectPath && projectConfig.organization === org && projectConfig.project === project) {
      if (newOrg || newProject) {
        projectConfig.organization = finalOrg;
        projectConfig.project = finalProject;
        saveProjectConfig(projectConfig, dirname(projectPath).replace(/\/.ats$/, ''));
        console.log(`  Updated local config: ${projectPath}`);
      }
    }

    // Update global config if this was the current repo
    const globalConfig = loadGlobalConfig();
    if (globalConfig.organization === org && globalConfig.project === project) {
      if (newOrg || newProject) {
        globalConfig.organization = finalOrg;
        globalConfig.project = finalProject;
        saveGlobalConfig(globalConfig);
        console.log(`  Updated global config: ${GLOBAL_CONFIG_PATH}`);
      }
    }
  }
};

// --- Watch Command (WebSocket) ---
commands.watch = async function(args, config) {
  const { options } = args;

  const wsUrl = config.baseUrl.replace('http', 'ws') + '/ws';
  const params = new URLSearchParams({
    actor_type: config.actor.type,
    actor_id: config.actor.id,
    actor_name: config.actor.name
  });

  console.log(`Connecting to ${wsUrl}...`);

  const ws = new WebSocket(`${wsUrl}?${params}`);

  ws.onopen = () => {
    console.log('✓ Connected');

    // Subscribe to events
    const subscription = {
      type: 'subscribe',
      id: 'cli-sub-1'
    };

    if (options.channel) {
      subscription.channels = [options.channel];
    }
    if (options.type) {
      subscription.task_types = [options.type];
    }
    if (options.events) {
      subscription.event_types = options.events.split(',');
    }

    ws.send(JSON.stringify(subscription));
    console.log('Watching for events... (Ctrl+C to stop)\n');
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'pong' || msg.type === 'connected' || msg.type === 'subscribed') {
      return;
    }

    const time = new Date().toLocaleTimeString();

    if (msg.type?.startsWith('task.')) {
      const task = msg.data?.task || msg.task || {};
      console.log(`[${time}] ${msg.type}`);
      console.log(`  Task #${task.id}: ${task.title || '(no title)'}`);
      console.log(`  Status: ${formatStatus(task.status)}, Channel: ${task.channel || '-'}`);
      if (msg.actor_name) {
        console.log(`  By: ${msg.actor_name}`);
      }
      console.log();
    } else {
      console.log(`[${time}] ${msg.type}: ${JSON.stringify(msg)}`);
    }
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err.message);
  };

  ws.onclose = () => {
    console.log('\nConnection closed');
    process.exit(0);
  };

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log('\nClosing connection...');
    ws.close();
  });

  // Keep alive
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000);

  // Keep the process running
  await new Promise(() => {});
};

// ============================================================================
// Help
// ============================================================================

function showHelp() {
  console.log(`
ATS CLI - Agent Task Service Command Line Interface v${VERSION}

USAGE:
  ats <command> [options]

TASK COMMANDS:
  create <title>             Create a new task
    --type <type>            Task type (default: task)
    --channel <channel>      Task channel (default: default)
    --priority <1-10>        Priority level (default: 5)
    --description <text>     Task description
    --payload <json>         Task payload as JSON

  get <id>                   Get task details
  list                       List pending tasks (default)
    --all                    Show all tasks (not just pending)
    --status <status>        Filter by status
    --type <type>            Filter by type
    --channel <channel>      Filter by channel
    --assignee <id>          Filter by assignee
    --limit <n>              Limit results
    --offset <n>             Skip results

  update <id>                Update a task
    --title <title>          New title
    --description <text>     New description
    --priority <1-10>        New priority
    --status <status>        New status

  claim <id>                 Claim a task
    --lease <ms>             Lease duration in milliseconds
  complete <id>              Mark task as complete
    --outputs <json>         Task outputs as JSON
  cancel <id>                Cancel a task
  fail <id>                  Mark task as failed
    --reason <text>          Failure reason
  reject <id>                Reject a task
    --reason <text>          Rejection reason

REPOSITORY COMMANDS:
  repo init [org/project]    Bind current directory to a repository
    --force                  Overwrite existing config
    --no-verify              Skip verification
  repo list                  List all repositories (flattened org/project view)
  repo create <org/project>  Create a new repository
    --name <name>            Project name
    --description <text>     Project description
  repo rename <org/project> [new-org/new-project]
                             Rename org and/or project
    --slug <slug>            New project slug only
    --name <name>            New display name
  repo switch <org/project>  Switch default repository
  repo current               Show current repository binding
  repo show                  Show full config with sources

OTHER COMMANDS:
  health                     Check service health
  stats                      Show task statistics overview
  watch                      Watch for real-time events
    --channel <channel>      Filter by channel
    --type <type>            Filter by task type
    --events <types>         Comma-separated event types

  message add <task_id> <content>   Add a message to a task
    --type <type>            Content type (default: text)
  message list <task_id>     List messages for a task

GLOBAL OPTIONS:
  --url, -u <url>            Service URL (default: https://ats.difflab.ai)
  --org <slug>               Override default organization
  --project <slug>           Override default project
  --format, -f <format>      Output format: table, json (default: table)
  --actor-type <type>        Actor type: human, agent, system
  --actor-id <id>            Actor ID
  --actor-name <name>        Actor display name
  --verbose, -v              Verbose output
  --help, -h                 Show this help

CONFIGURATION:
  Global config: ~/.ats/config
  Project config: .ats/config (walks up directory tree)

  Example config:
  {
    "organization": "default",
    "project": "main",
    "url": "https://ats.difflab.ai"
  }

  Priority: CLI flags > environment variables > project config > global config > defaults

  Project-level config binds a directory to an ATS repository, similar to
  how .git binds a directory to a git repository. Use "ats repo init" to
  bind the current directory to a repository.

ENVIRONMENT VARIABLES:
  ATS_URL                    Service URL
  ATS_ORG                    Default organization
  ATS_PROJECT                Default project
  ATS_ACTOR_TYPE             Default actor type
  ATS_ACTOR_ID               Default actor ID
  ATS_ACTOR_NAME             Default actor name

EXAMPLES:
  ats list                                  # Show pending tasks
  ats list --all                            # Show all tasks
  ats create "Review PR #123" --priority 8  # Create a task
  ats get 42                                # View task details
  ats claim 42                              # Claim a task
  ats complete 42                           # Mark complete
  ats message add 42 "On it"                # Add a comment
  ats watch --channel support               # Watch events

  ats repo list                             # List all repositories
  ats repo switch myorg/myproject           # Switch to a repository
  ats repo init myorg/myproject             # Bind current dir to a repo
  ats repo create myorg/newproj             # Create a new repository
  ats repo rename myorg/old neworg/new      # Rename org and project
  ats repo current                          # Show current repository
  ats repo show                             # Show full config
`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.flags.help || args.flags.h || args.command === 'help') {
    showHelp();
    process.exit(0);
  }

  if (args.flags.version || args.command === 'version') {
    console.log(`ats-cli v${VERSION}`);
    process.exit(0);
  }

  if (!args.command) {
    showHelp();
    process.exit(1);
  }

  const config = getConfig({ ...args.options, ...args.flags });

  try {
    const cmd = commands[args.command];

    if (typeof cmd === 'function') {
      // Direct command (list, create, get, health, watch, etc.)
      // Shift positional args: subcommand becomes first positional
      if (args.subcommand) {
        args.positional.unshift(args.subcommand);
      }
      await cmd(args, config);
    } else if (typeof cmd === 'object' && args.subcommand) {
      // Nested command (e.g., `message add`)
      const subcmd = cmd[args.subcommand];
      if (subcmd) {
        await subcmd(args, config);
      } else {
        console.error(`Unknown subcommand: ${args.command} ${args.subcommand}`);
        console.error(`Available subcommands: ${Object.keys(cmd).join(', ')}`);
        process.exit(1);
      }
    } else if (typeof cmd === 'object') {
      console.error(`Subcommand required for: ${args.command}`);
      console.error(`Available subcommands: ${Object.keys(cmd).join(', ')}`);
      process.exit(1);
    } else {
      console.error(`Unknown command: ${args.command}`);
      console.error('Run "ats --help" for usage information.');
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    if (config.verbose) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
