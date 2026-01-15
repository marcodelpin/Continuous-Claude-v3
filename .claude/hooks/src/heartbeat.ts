/**
 * PostToolUse Hook - Updates session heartbeat for coordination layer.
 *
 * This hook:
 * 1. Updates the session's last_heartbeat timestamp in PostgreSQL
 * 2. Updates the project field if session ID was reused from another project
 * 3. Runs on every tool use to keep the session marked as active
 *
 * Part of the coordination layer architecture (Phase 1).
 */

import { runPgQuery } from './shared/db-utils-pg.js';
import { getSessionId, getProject } from './shared/session-id.js';
import type { HookOutput } from './shared/types.js';

/**
 * Main entry point for the heartbeat hook.
 * Updates session heartbeat in the database.
 */
export function main(): void {
  // Skip if coordination is disabled
  if (process.env.CONTINUOUS_CLAUDE_COORDINATION !== 'true') {
    console.log(JSON.stringify({ result: 'continue' } as HookOutput));
    return;
  }

  const sessionId = getSessionId();
  const project = getProject();

  // Skip if no session ID
  if (!sessionId) {
    console.log(JSON.stringify({ result: 'continue' } as HookOutput));
    return;
  }

  // Update heartbeat and project field
  // NOTE: We match only on session ID (not project) because a session ID might
  // be reused when switching projects. Updating the project field ensures the
  // session is associated with the current project.
  const pythonCode = `
import asyncpg
import os

session_id = sys.argv[1]
project = sys.argv[2]
pg_url = os.environ.get('CONTINUOUS_CLAUDE_DB_URL', 'postgresql://claude:claude_dev@localhost:5432/continuous_claude')

async def main():
    conn = await asyncpg.connect(pg_url)
    try:
        result = await conn.execute('''
            UPDATE sessions
            SET last_heartbeat = NOW(), project = $2
            WHERE id = $1
        ''', session_id, project)
        print('ok')
    finally:
        await conn.close()

asyncio.run(main())
`;

  const result = runPgQuery(pythonCode, [sessionId, project]);
  if (!result.success && result.stderr) {
    console.error(`[heartbeat] WARNING: ${result.stderr}`);
  }

  console.log(JSON.stringify({ result: 'continue' } as HookOutput));
}

main();
