import path from 'path';
import { fileURLToPath } from 'url';

// The backend listens here by default. The frontend + Vite proxy expect 3002.
export const PORT = Number(process.env.PORT) || 3002;

// The memory/knowledge manager is served by this same Express server.
// Override with MANAGER_URL if the manager lives elsewhere.
export const MANAGER_URL = process.env.MANAGER_URL || `http://127.0.0.1:${PORT}`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Root of the server package (where index.js lives)
export const SERVER_ROOT = path.resolve(__dirname, '..');

// Generated files (apps, scripts) that JEXI builds for the user
export const WORKSPACE_DIR = path.join(SERVER_ROOT, 'jexi-workspace');

// Persistent memory / knowledge store (gitignored)
export const DATA_DIR = path.join(SERVER_ROOT, 'data');
export const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');
export const KNOWLEDGE_DIR = path.join(DATA_DIR, 'knowledge');

// Max attempts for the code run-fix-debug loop
export const MAX_DEBUG_ATTEMPTS = Number(process.env.MAX_DEBUG_ATTEMPTS) || 5;

// Max pages JEXI will deep-read during one research pass
export const MAX_SOURCES_TO_READ = Number(process.env.MAX_SOURCES_TO_READ) || 5;
