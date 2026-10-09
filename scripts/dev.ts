// Uruchamia API (z --watch) i Vite jednocześnie: npm run dev
import { spawn } from 'node:child_process';

const procs = [
  spawn(process.execPath, ['--no-warnings', '--watch', 'server/index.ts'], { stdio: 'inherit', env: { ...process.env, PORT: '5174' } }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5173', '--strictPort'], { stdio: 'inherit' }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { if (code) { stop(); process.exit(code); } }));
