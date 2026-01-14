/**
 * PostToolUse Hook - Updates session heartbeat for coordination layer.
 *
 * This hook:
 * 1. Updates the session's last_heartbeat timestamp in PostgreSQL
 * 2. Runs on every tool use to keep the session marked as active
 *
 * Part of the coordination layer architecture (Phase 1).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { runPgQuery } from './shared/db-utils-pg.js';
import type { HookOutput } from './shared/types.js';

/**
 * Get the coordination session ID from file or environment.
 * Different from resource-reader's getSessionId() which uses CLAUDE_SESSION_ID.
 *
 * @returns Coordination session ID or empty string if not found
 */
function getCoordinationSessionId(): string {
  // Try file first (persisted by session-register)
  try {
    const claudeDir = join(process.env.HOME || '/tmp', '.claude');
    const sessionFile = join(claudeDir, '.coordination-session-id');
    return readFileSync(sessionFile, 'utf-8').trim();
  } catch {
    // Fall back to environment variables
    return process.env.COORDINATION_SESSION_ID ||
           process.env.BRAINTRUST_SPAN_ID?.slice(0, 8) ||
           '';
  }
}

/**
 * Returns the current project directory path.
 *
 * @returns CLAUDE_PROJECT_DIR env var or current working directory
 */
function getProject(): string {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

/**
 * Main entry point for the heartbeat hook.
 * Updates session heartbeat in the database.
 */
export function main(): void {
  // Skip if coordination is disabled
  if (process.env.CONTINUOUS_CLAUDE_COORDINATION !== 'true') {
    console.log(JSON.stringify({ result: 'continue' }));
    return;
  }

  const sessionId = getCoordinationSessionId();
  const project = getProject();

  // Skip if no session ID
  if (!sessionId) {
    console.log(JSON.stringify({ result: 'continue' }));
    return;
  }

  // Update heartbeat - use ID only (not project) since session may switch projects
  const pythonCode = `
import asyncpg
import os

session_id = sys.argv[1]
project = sys.argv[2]
pg_url = os.environ.get('OPC_POSTGRES_URL', 'postgresql://claude:claude_dev@localhost:5432/continuous_claude')

async def main():
    conn = await asyncpg.connect(pg_url)
    try:
        # Update heartbeat and project (handles session ID reuse across projects)
        await conn.execute('''
            UPDATE sessions SET
                last_heartbeat = NOW(),
                project = $2
            WHERE id = $1
        ''', session_id, project)
        print('ok')
    finally:
        await conn.close()

asyncio.run(main())
`;

  const result = runPgQuery(pythonCode, [sessionId, project]);
  if (!result.success) {
    console.error(`[heartbeat] Update failed: ${result.stderr || result.stdout}`);
  }

  const output: HookOutput = {
    result: 'continue',
  };

  console.log(JSON.stringify(output));
}

// Run if executed directly
main();
