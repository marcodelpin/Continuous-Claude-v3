// src/heartbeat.ts
import { readFileSync } from "fs";
import { join as join2 } from "path";

// src/shared/db-utils-pg.ts
import { spawnSync } from "child_process";

// src/shared/opc-path.ts
import { existsSync } from "fs";
import { join } from "path";
function getOpcDir() {
  const envOpcDir = process.env.CLAUDE_OPC_DIR;
  if (envOpcDir && existsSync(envOpcDir)) {
    return envOpcDir;
  }
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const localOpc = join(projectDir, "opc");
  if (existsSync(localOpc)) {
    return localOpc;
  }
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  if (homeDir) {
    const globalClaude = join(homeDir, ".claude");
    const globalScripts = join(globalClaude, "scripts", "core");
    if (existsSync(globalScripts)) {
      return globalClaude;
    }
  }
  return null;
}
function requireOpcDir() {
  const opcDir = getOpcDir();
  if (!opcDir) {
    console.log(JSON.stringify({ result: "continue" }));
    process.exit(0);
  }
  return opcDir;
}

// src/shared/db-utils-pg.ts
function getPgConnectionString() {
  return process.env.OPC_POSTGRES_URL || process.env.DATABASE_URL || "postgresql://claude:claude_dev@localhost:5432/continuous_claude";
}
function runPgQuery(pythonCode, args = []) {
  const opcDir = requireOpcDir();
  const wrappedCode = `
import sys
import os
import asyncio
import json

# Add opc to path for imports
sys.path.insert(0, '${opcDir}')
os.chdir('${opcDir}')

${pythonCode}
`;
  try {
    const result = spawnSync("uv", ["run", "python", "-c", wrappedCode, ...args], {
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
      cwd: opcDir,
      env: {
        ...process.env,
        OPC_POSTGRES_URL: getPgConnectionString()
      }
    });
    return {
      success: result.status === 0,
      stdout: result.stdout?.trim() || "",
      stderr: result.stderr || ""
    };
  } catch (err) {
    return {
      success: false,
      stdout: "",
      stderr: String(err)
    };
  }
}

// src/heartbeat.ts
function getSessionId() {
  try {
    const claudeDir = join2(process.env.HOME || "/tmp", ".claude");
    const sessionFile = join2(claudeDir, ".coordination-session-id");
    return readFileSync(sessionFile, "utf-8").trim();
  } catch {
    return process.env.COORDINATION_SESSION_ID || process.env.BRAINTRUST_SPAN_ID?.slice(0, 8) || "";
  }
}
function getProject() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}
function main() {
  if (process.env.CONTINUOUS_CLAUDE_COORDINATION !== "true") {
    console.log(JSON.stringify({ result: "continue" }));
    return;
  }
  const sessionId = getSessionId();
  const project = getProject();
  if (!sessionId) {
    console.log(JSON.stringify({ result: "continue" }));
    return;
  }
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
  runPgQuery(pythonCode, [sessionId, project]);
  const output = {
    result: "continue"
  };
  console.log(JSON.stringify(output));
}
main();
export {
  main
};
