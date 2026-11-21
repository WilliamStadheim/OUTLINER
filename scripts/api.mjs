// Starts the FastAPI backend from the project venv (.venv). No --reload: on Windows the reload
// hangs while shutting down the old worker; restart `npm run dev` after editing api/ or outliner_core.py.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const py = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python';
if (!existsSync(py)) {
  console.error(`No Python venv found at ${py}. See README.md → "Backend setup".`);
  process.exit(1);
}
const args = ['-m', 'uvicorn', 'api.index:app', '--port', '8000'];
// OUTLINER_PREFETCH=1: draw neighbouring angles in a local process pool (not on Vercel)
spawn(py, args, { stdio: 'inherit', env: { ...process.env, OUTLINER_PREFETCH: '1' } }).on('exit', (code) => process.exit(code ?? 0));
