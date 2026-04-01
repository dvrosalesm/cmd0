import {
  app, BrowserWindow, screen, globalShortcut, ipcMain,
  nativeImage, dialog, clipboard, Tray, Menu, safeStorage
} from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, sep } from 'path';
import { isIP } from 'net';
import { homedir } from 'os';
import {
  mkdirSync, readFileSync, writeFileSync, existsSync,
  readdirSync, copyFileSync, statSync, unlinkSync
} from 'fs';
import { readFile } from 'fs/promises';
import { execSync, execFile } from 'child_process';
import { promisify } from 'util';
import {
  createAgentSession, AuthStorage, ModelRegistry,
  SessionManager, DefaultResourceLoader, getAgentDir,
  SettingsManager
} from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';
import { loadFeatures } from './features/index.js';
import type { FeatureContext } from './features/types.js';

const execFileAsync = promisify(execFile);

const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';

// Enable Wayland support via Ozone on Linux
if (IS_LINUX && process.env.WAYLAND_DISPLAY) {
  app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');
  app.commandLine.appendSwitch('ozone-platform', 'wayland');
}

app.setName('cmd0');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_DIR = join(__dirname, '..');
const TSC = join(PROJECT_DIR, 'node_modules', '.bin', 'tsc');

const CMD0_DIR = join(homedir(), '.cmd0');
const DATA_DIR = join(CMD0_DIR, 'data');
const ANIMA_DIR = join(CMD0_DIR, 'anima');
const CONFIG_FILE = join(DATA_DIR, 'config.json');
const TASKS_FILE = join(CMD0_DIR, 'tasks.md');
const SNAPSHOTS_DIR = join(CMD0_DIR, 'snapshots');
const BACKUP_DIR = join(CMD0_DIR, 'base');
const PID_FILE = join(CMD0_DIR, 'pid');

// --- CLI flags ---
const SAFE_MODE = process.argv.includes('--safe');
if (SAFE_MODE) console.log('[cmd0] SAFE MODE');

const snapIdx = process.argv.indexOf('--snap');
const restoreIdx = process.argv.indexOf('--restore');

// --- Config ---
interface Config {
  apiKey?: string;
  apiKeyEncrypted?: string;
  model?: string;
  windowVisible?: boolean;
  windowX?: number;
  windowY?: number;
  openrouterKey?: string;
  features?: Record<string, boolean>;
}

function ensureDirs() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(ANIMA_DIR, { recursive: true });
}

function loadConfig(): Config {
  try {
    if (existsSync(CONFIG_FILE)) {
      const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as Config;
      if (!config.apiKey && config.apiKeyEncrypted && safeStorage.isEncryptionAvailable()) {
        try {
          config.apiKey = safeStorage.decryptString(Buffer.from(config.apiKeyEncrypted, 'base64'));
        } catch (e) {
          console.error('[cmd0] Decrypt failed:', e);
        }
      }
      return config;
    }
  } catch (e) {
    console.error('[cmd0] Config load failed:', e);
  }
  return {};
}

function saveConfig(config: Config) {
  const stored: Config = { ...config };
  if (stored.apiKey && safeStorage.isEncryptionAvailable()) {
    stored.apiKeyEncrypted = safeStorage.encryptString(stored.apiKey).toString('base64');
    delete stored.apiKey;
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(stored, null, 2), 'utf-8');
}

// --- Anima files ---
const ANIMA_FILES = [
  { src: 'src/main.ts', dest: 'main.ts' },
  { src: 'src/renderer.ts', dest: 'renderer.ts' },
  { src: 'src/style.css', dest: 'style.css' },
  { src: 'src/globals.d.ts', dest: 'globals.d.ts' },
  { src: 'src/features/types.ts', dest: 'features/types.ts' },
  { src: 'src/features/index.ts', dest: 'features/index.ts' },
  { src: 'src/features/anima.ts', dest: 'features/anima.ts' },
  { src: 'src/features/web.ts', dest: 'features/web.ts' },
  { src: 'src/features/browser.ts', dest: 'features/browser.ts' },
  { src: 'src/features/notify.ts', dest: 'features/notify.ts' },
  { src: 'src/features/screenshot.ts', dest: 'features/screenshot.ts' },
  { src: 'src/features/tasks.ts', dest: 'features/tasks.ts' },
  { src: 'index.html', dest: 'index.html' },
  { src: 'preload.cjs', dest: 'preload.cjs' },
  { src: 'tsconfig.json', dest: 'tsconfig.json' },
  { src: 'package.json', dest: 'package.json' },
  { src: 'me.md', dest: 'me.md' },
];

// --- Anima overlay system ---
// Anima (~/.cmd0/anima/) stores ONLY user customizations made via /0.
// Project source (git repo) is the base. At compile time, anima files are
// overlaid onto source temporarily, compiled, then source is restored.

function backupBaseFiles() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  for (const f of ANIMA_FILES) {
    const s = join(PROJECT_DIR, f.src);
    const b = join(BACKUP_DIR, f.dest);
    const parentDir = dirname(b);
    if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
    if (existsSync(s)) copyFileSync(s, b);
  }
}

function restoreBaseFiles() {
  for (const f of ANIMA_FILES) {
    const b = join(BACKUP_DIR, f.dest);
    const d = join(PROJECT_DIR, f.src);
    const parentDir = dirname(d);
    if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
    if (existsSync(b)) copyFileSync(b, d);
  }
}

/** Overlay anima customizations onto project source, compile, restore source. */
function compileWithOverlay() {
  backupBaseFiles();
  try {
    // Overlay: copy anima files on top of project source
    for (const f of ANIMA_FILES) {
      const a = join(ANIMA_DIR, f.dest);
      if (existsSync(a)) {
        const d = join(PROJECT_DIR, f.src);
        const parentDir = dirname(d);
        if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
        copyFileSync(a, d);
      }
    }
    // Compile
    execSync(TSC, { cwd: PROJECT_DIR, timeout: 30000 });
  } finally {
    // Always restore source so git stays clean
    restoreBaseFiles();
  }
}

/** Read a file: anima override first, then project source fallback. */
function readAnimaOrSource(filename: string): string | null {
  const animaPath = resolveAnimaPath(filename);
  if (existsSync(animaPath)) return readFileSync(animaPath, 'utf-8');
  const mapping = ANIMA_FILES.find(f => f.dest === filename);
  if (mapping) {
    const srcPath = join(PROJECT_DIR, mapping.src);
    if (existsSync(srcPath)) return readFileSync(srcPath, 'utf-8');
  }
  return null;
}

function listAnimaFiles(): string[] {
  const overrides = new Set<string>();
  if (existsSync(ANIMA_DIR)) {
    function walk(dir: string, prefix: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(join(dir, entry.name), rel);
        else overrides.add(rel);
      }
    }
    walk(ANIMA_DIR, '');
  }
  const lines: string[] = [];
  for (const f of ANIMA_FILES) {
    lines.push(overrides.has(f.dest) ? `${f.dest} [customized]` : f.dest);
  }
  return lines;
}

function resolveAnimaPath(filename: string): string {
  const root = resolve(ANIMA_DIR);
  const fp = resolve(root, filename);
  if (fp !== root && !fp.startsWith(root + sep)) throw new Error('Path traversal blocked.');
  return fp;
}

// --- Security helpers ---
function isPrivateHostname(h: string): boolean {
  const n = h.toLowerCase();
  if (n === 'localhost' || n.endsWith('.localhost') || n.endsWith('.local')) return true;
  if (isIP(n) === 4) {
    const o = n.split('.').map(Number);
    return o[0] === 0 || o[0] === 10 || o[0] === 127
      || (o[0] === 100 && o[1] >= 64 && o[1] <= 127)
      || (o[0] === 169 && o[1] === 254)
      || (o[0] === 172 && o[1] >= 16 && o[1] <= 31)
      || (o[0] === 192 && o[1] === 168);
  }
  if (isIP(n) === 6) return n === '::1' || n.startsWith('fc') || n.startsWith('fd') || n.startsWith('fe80:');
  return false;
}

function validateFetchUrl(url: string): URL {
  const p = new URL(url);
  if (!['http:', 'https:'].includes(p.protocol)) throw new Error('Only http/https allowed.');
  if (isPrivateHostname(p.hostname)) throw new Error('Private addresses blocked.');
  return p;
}

const MAX_PROMPT = 20000;
const MAX_KEY = 512;
const MAX_MODEL = 256;
const MAX_TASK = 500;
const MAX_ATTACH = 1024 * 1024;
const MAX_IMG = 5 * 1024 * 1024;

function reqStr(v: unknown, f: string, max: number): string {
  if (typeof v !== 'string') throw new Error(`${f} must be string.`);
  const t = v.trim();
  if (!t) throw new Error(`${f} required.`);
  if (t.length > max) throw new Error(`${f} too long.`);
  return t;
}

function optStr(v: unknown, f: string, max: number): string | undefined {
  if (v == null || v === '') return undefined;
  return reqStr(v, f, max);
}

function reqImg(d: unknown): string {
  if (typeof d !== 'string' || !d.trim()) throw new Error('Image required.');
  const n = d.trim();
  if (Buffer.byteLength(n, 'base64') > MAX_IMG) throw new Error('Image too large.');
  return n;
}

async function readTextAttach(fp: string): Promise<{ name: string; content: string }> {
  const s = statSync(fp);
  if (!s.isFile()) throw new Error('Not a file.');
  if (s.size > MAX_ATTACH) throw new Error('File too large (1MB limit).');
  const buf = await readFile(fp);
  if (buf.includes(0)) throw new Error('Binary files not supported.');
  return { name: fp.split('/').pop() || fp, content: buf.toString('utf-8') };
}

// --- MD context ---
function findMdFiles(dir: string): string[] {
  const r: string[] = [];
  if (!existsSync(dir)) return r;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith('.')) r.push(...findMdFiles(p));
    else if (e.isFile() && e.name.endsWith('.md')) r.push(p);
  }
  return r;
}

function loadAnimaContext(): string {
  // Collect .md files: anima overrides first, then project source fallbacks
  const mdFiles = new Map<string, string>(); // relative path → absolute path
  // Project source .md files (base)
  for (const f of ANIMA_FILES) {
    if (f.dest.endsWith('.md')) {
      const srcPath = join(PROJECT_DIR, f.src);
      if (existsSync(srcPath)) mdFiles.set(f.dest, srcPath);
    }
  }
  // Anima overrides (take precedence)
  const animaMds = existsSync(ANIMA_DIR) ? findMdFiles(ANIMA_DIR) : [];
  for (const fp of animaMds) {
    const rel = fp.slice(ANIMA_DIR.length + 1);
    mdFiles.set(rel, fp);
  }
  if (!mdFiles.size) return '';
  const secs = [...mdFiles.entries()].map(([rel, fp]) => {
    const c = readFileSync(fp, 'utf-8').trim();
    return c ? `--- ${rel} ---\n${c}` : '';
  }).filter(Boolean);
  return secs.length ? '\n\n# Context\n\n' + secs.join('\n\n') : '';
}

// --- Tasks ---
interface Task {
  id: string;
  description: string;
  type: 'once' | 'recurring';
  intervalMinutes?: number;
  status: 'pending' | 'running' | 'done';
  lastRun?: string;
  createdAt: string;
}

function loadTasks(): Task[] {
  if (!existsSync(TASKS_FILE)) return [];
  try { return JSON.parse(readFileSync(TASKS_FILE, 'utf-8')); }
  catch (e) { console.error('[cmd0] Tasks parse failed:', e); return []; }
}

function saveTasks(t: Task[]) {
  writeFileSync(TASKS_FILE, JSON.stringify(t, null, 2), 'utf-8');
}

function addTask(desc: string, type: 'once' | 'recurring', mins?: number): Task {
  const tasks = loadTasks();
  const t: Task = {
    id: Date.now().toString(36),
    description: desc,
    type,
    intervalMinutes: mins,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  tasks.push(t);
  saveTasks(tasks);
  return t;
}

function completeTask(id: string) {
  const tasks = loadTasks();
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  if (t.type === 'once') t.status = 'done';
  else { t.status = 'pending'; t.lastRun = new Date().toISOString(); }
  saveTasks(tasks);
}

function removeTask(id: string) {
  saveTasks(loadTasks().filter(t => t.id !== id));
}

function getDueTasks(): Task[] {
  const now = Date.now();
  return loadTasks().filter(t => {
    if (t.status !== 'pending') return false;
    if (t.type === 'once') return true;
    if (!t.lastRun) return true;
    return now - new Date(t.lastRun).getTime() >= (t.intervalMinutes || 5) * 60000;
  });
}

function markRunning(id: string) {
  const tasks = loadTasks();
  const t = tasks.find(x => x.id === id);
  if (t) { t.status = 'running'; saveTasks(tasks); }
}

function resetPending(id: string) {
  const tasks = loadTasks();
  const t = tasks.find(x => x.id === id);
  if (t) { t.status = 'pending'; saveTasks(tasks); }
}

// --- Daemon ---
let daemonTimer: ReturnType<typeof setInterval> | null = null;
let daemonBusy = false;
let sessionBusy = false;

function startDaemon() {
  if (daemonTimer) return;
  daemonTimer = setInterval(async () => {
    if (daemonBusy || !session || sessionBusy) return;
    for (const task of getDueTasks()) {
      if (daemonBusy) break;
      daemonBusy = true;
      markRunning(task.id);
      if (win) {
        win.webContents.send('agent:event', {
          kind: 'text_delta',
          delta: `\n---\nRunning task: ${task.description}\n\n`
        });
      }
      try {
        await runPrompt(`Background task: ${task.description}\nAfter completing, call task_complete with id "${task.id}".`);
        completeTask(task.id);
      } catch (e: any) {
        resetPending(task.id);
        if (win) {
          win.webContents.send('agent:event', { kind: 'text_delta', delta: `\nTask failed: ${e?.message}\n` });
          win.webContents.send('agent:done');
        }
      }
      daemonBusy = false;
    }
  }, 60_000);
}

function stopDaemon() {
  if (daemonTimer) { clearInterval(daemonTimer); daemonTimer = null; }
}

function sendError(err: unknown) {
  if (!win) return;
  win.webContents.send('agent:event', {
    kind: 'text_delta',
    delta: `\nError: ${err instanceof Error ? err.message : err}`
  });
  win.webContents.send('agent:done');
}

// When true, anima_write and anima_reload are allowed.
// Only set during /0 prompts; cleared when the prompt finishes.
let animaUnlocked = false;

async function runPrompt(text: string, img?: string) {
  if (!session) throw new Error('No session.');
  if (sessionBusy) throw new Error('Agent busy.');
  sessionBusy = true;
  try {
    if (img) {
      await session.prompt(text, { images: [{ type: 'image', data: img, mimeType: 'image/png' }] });
    } else {
      await session.prompt(text);
    }
  } finally {
    sessionBusy = false;
    animaUnlocked = false;
  }
}

async function runAnimaPrompt(text: string) {
  animaUnlocked = true;
  return runPrompt(text);
}

// --- Snapshot helpers ---
function validateSnapName(name: string): string {
  const n = name.trim();
  if (!n || !/^[a-zA-Z0-9_-]+$/.test(n)) throw new Error('Invalid snapshot name (use alphanumeric, dash, underscore only).');
  return n;
}

function doSnapshot(name: string): string {
  name = validateSnapName(name);
  const dir = join(SNAPSHOTS_DIR, name);
  if (existsSync(dir)) return `Snapshot "${name}" already exists.`;
  const ad = join(dir, 'anima');
  mkdirSync(ad, { recursive: true });
  if (existsSync(ANIMA_DIR)) {
    for (const f of readdirSync(ANIMA_DIR)) {
      const s = join(ANIMA_DIR, f);
      if (statSync(s).isFile()) copyFileSync(s, join(ad, f));
    }
  }
  if (existsSync(CONFIG_FILE)) copyFileSync(CONFIG_FILE, join(dir, 'config.json'));
  if (existsSync(TASKS_FILE)) copyFileSync(TASKS_FILE, join(dir, 'tasks.md'));
  return `Snapshot "${name}" saved.`;
}

function doRestore(name: string): string {
  name = validateSnapName(name);
  const dir = join(SNAPSHOTS_DIR, name);
  if (!existsSync(dir)) return `Snapshot "${name}" not found.`;
  const ad = join(dir, 'anima');
  if (existsSync(ad)) {
    for (const f of readdirSync(ad)) copyFileSync(join(ad, f), join(ANIMA_DIR, f));
  }
  const sc = join(dir, 'config.json');
  if (existsSync(sc)) {
    const cur = loadConfig();
    const snap = JSON.parse(readFileSync(sc, 'utf-8'));
    snap.apiKey = cur.apiKey;
    snap.apiKeyEncrypted = cur.apiKeyEncrypted;
    saveConfig(snap);
  }
  if (existsSync(join(dir, 'tasks.md'))) copyFileSync(join(dir, 'tasks.md'), TASKS_FILE);
  try {
    compileWithOverlay();
    setTimeout(() => { app.relaunch(); app.exit(0); }, 500);
    return `Restored "${name}". Restarting...`;
  } catch {
    return `Restored but recompile failed.`;
  }
}

function listSnaps(): string[] {
  return existsSync(SNAPSHOTS_DIR)
    ? readdirSync(SNAPSHOTS_DIR).filter(f => statSync(join(SNAPSHOTS_DIR, f)).isDirectory() && !f.startsWith('.'))
    : [];
}

// --- Tool result helpers ---
function text(t: string) { return { content: [{ type: 'text' as const, text: t }], details: {} }; }
function image(data: string) { return { content: [{ type: 'image' as const, data, mimeType: 'image/png' }], details: {} }; }

// --- Feature context (passed to all feature modules) ---
function buildFeatureContext(): FeatureContext {
  return {
    IS_MAC, IS_LINUX,
    PROJECT_DIR, CMD0_DIR, ANIMA_DIR, DATA_DIR, TASKS_FILE, TSC,
    getWin: () => win,
    isAnimaUnlocked: () => animaUnlocked,
    text, image,
    resolveAnimaPath, readAnimaOrSource, listAnimaFiles, doSnapshot, compileWithOverlay,
    validateFetchUrl,
    loadTasks, addTask, completeTask, removeTask,
    reqStr, MAX_TASK,
    captureScreenshot,
  };
}

// --- Screenshot ---
async function captureScreenshot(): Promise<string | null> {
  const fp = join(DATA_DIR, `ss-${Date.now()}.png`);
  try {
    if (win?.isVisible()) win.hide();
    await new Promise(r => setTimeout(r, 300));
    if (IS_MAC) {
      await execFileAsync('screencapture', ['-x', '-s', fp]);
    } else {
      // Linux (Wayland: grim+slurp, X11: scrot fallback)
      try {
        const { stdout: geom } = await execFileAsync('slurp');
        await execFileAsync('grim', ['-g', geom.trim(), fp]);
      } catch {
        await execFileAsync('scrot', ['-s', '-f', fp]);
      }
    }
    if (win) { win.show(); win.focus(); }
    if (existsSync(fp)) {
      const buf = readFileSync(fp);
      if (buf.length < 1000) {
        try { unlinkSync(fp); } catch {}
        if (IS_MAC) return await promptScreenPermission();
        return null;
      }
      try { unlinkSync(fp); } catch (e) { console.error('[cmd0] SS cleanup:', e); }
      return buf.toString('base64');
    }
  } catch (e) {
    console.error('[cmd0] SS failed:', e);
    if (win && !win.isVisible()) { win.show(); win.focus(); }
    if (IS_MAC) return await promptScreenPermission();
  }
  if (win && !win.isVisible()) { win.show(); win.focus(); }
  return null;
}

async function promptScreenPermission(): Promise<null> {
  if (win && !win.isVisible()) { win.show(); win.focus(); }
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Screen Recording',
    message: 'cmd0 needs Screen Recording permission.',
    detail: 'Open Settings to enable, then restart.',
    buttons: ['Open Settings', 'Cancel']
  });
  if (response === 0) execSync('open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"');
  return null;
}

// --- Provider ---
function detectProvider(key: string) {
  return key.startsWith('fw_') ? 'fireworks' as const : 'openrouter' as const;
}

function createModel(provider: 'openrouter' | 'fireworks', id: string) {
  if (provider === 'fireworks') {
    return {
      id, name: id, api: 'openai-completions' as const,
      provider: 'fireworks', baseUrl: 'https://api.fireworks.ai/inference/v1',
      reasoning: false, input: ['text' as const, 'image' as const],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 131072, maxTokens: 16384
    };
  }
  try {
    return getModel('openrouter', id as any);
  } catch {
    console.warn('[cmd0] Model not in registry:', id);
    return {
      id, name: id, api: 'openai-completions' as const,
      provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1',
      reasoning: false, input: ['text' as const, 'image' as const],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 131072, maxTokens: 16384
    };
  }
}

// --- App state ---
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | null = null;
let apiKey: string | null = null;

let settingsManager: ReturnType<typeof SettingsManager.create> | null = null;

async function initAgent(key: string, modelId?: string) {
  const provider = detectProvider(key);
  const resolved = modelId || (provider === 'openrouter'
    ? 'minimax/minimax-m2.7'
    : 'accounts/fireworks/routers/kimi-k2p5-turbo');
  const agentDir = getAgentDir();
  const authStorage = AuthStorage.create();
  authStorage.setRuntimeApiKey(provider, key);
  settingsManager = SettingsManager.create(PROJECT_DIR, agentDir);
  const model = createModel(provider, resolved);
  const animaCtx = SAFE_MODE ? '' : loadAnimaContext();
  const rl = new DefaultResourceLoader({
    cwd: PROJECT_DIR,
    agentDir,
    settingsManager,
    appendSystemPrompt: animaCtx || undefined,
    extensionFactories: [(pi) => {
      // Map project source paths to anima dest names for quick lookup
      const srcToAnima = new Map(ANIMA_FILES.map(f => [resolve(PROJECT_DIR, f.src), f.dest]));

      pi.on('tool_call', async (event) => {
        if (event.toolName !== 'write' && event.toolName !== 'edit' && event.toolName !== 'bash') return undefined;

        if (event.toolName === 'write' || event.toolName === 'edit') {
          const p = resolve(String(event.input.path));

          if (animaUnlocked) {
            // During /0: redirect project source edits → anima overlay
            const animaDest = srcToAnima.get(p);
            if (animaDest) {
              const animaPath = join(ANIMA_DIR, animaDest);
              const parentDir = dirname(animaPath);
              if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
              event.input.path = animaPath;
            }
            return undefined;
          }

          // Outside /0: block writes to anima dir
          if (p.startsWith(ANIMA_DIR + sep) || p === ANIMA_DIR) {
            return { block: true, reason: 'Self-modification requires /0. Use /0 <instruction> to modify cmd0.' };
          }
        }

        if (event.toolName === 'bash' && !animaUnlocked) {
          const cmd = String(event.input.command || '');
          if (cmd.includes(ANIMA_DIR) || cmd.includes('.cmd0/anima')) {
            return { block: true, reason: 'Self-modification requires /0. Use /0 <instruction> to modify cmd0.' };
          }
        }

        return undefined;
      });
    }],
  });
  await rl.reload();

  const cfg = loadConfig();
  const { tools, onReady, cleanup } = loadFeatures(buildFeatureContext(), cfg.features || {});
  featureCleanup = cleanup;
  featureOnReady = onReady;

  const result = await createAgentSession({
    cwd: PROJECT_DIR,
    agentDir,
    sessionManager: SessionManager.continueRecent(PROJECT_DIR, join(CMD0_DIR, 'sessions')),
    settingsManager,
    authStorage,
    modelRegistry: new ModelRegistry(authStorage),
    model,
    thinkingLevel: 'low',
    customTools: tools,
    resourceLoader: rl
  });
  session = result.session;

  session.subscribe((event) => {
    if (!win) return;
    switch (event.type) {
      case 'message_update': {
        const e = event.assistantMessageEvent;
        if (e.type === 'text_delta') win.webContents.send('agent:event', { kind: 'text_delta', delta: e.delta });
        else if (e.type === 'thinking_delta') win.webContents.send('agent:event', { kind: 'thinking_delta', delta: e.delta });
        else if (e.type === 'thinking_start') win.webContents.send('agent:event', { kind: 'thinking_start' });
        else if (e.type === 'thinking_end') win.webContents.send('agent:event', { kind: 'thinking_end' });
        break;
      }
      case 'tool_execution_start': {
        let a = '';
        try { a = JSON.stringify(event.args); if (a.length > 200) a = a.slice(0, 200) + '...'; } catch {}
        win.webContents.send('agent:event', { kind: 'tool_start', toolName: event.toolName, args: a });
        break;
      }
      case 'tool_execution_end': {
        let r = '';
        try { r = JSON.stringify(event.result); if (r.length > 300) r = r.slice(0, 300) + '...'; } catch {}
        win.webContents.send('agent:event', { kind: 'tool_end', toolName: event.toolName, isError: event.isError, result: r });
        break;
      }
      case 'turn_start':
        win.webContents.send('agent:event', { kind: 'turn_start' });
        break;
      case 'turn_end':
        win.webContents.send('agent:event', { kind: 'turn_end' });
        break;
      case 'compaction_start':
        win.webContents.send('agent:event', { kind: 'text_delta', delta: '\n[compacting context...]\n' });
        break;
      case 'compaction_end':
        win.webContents.send('agent:event', { kind: 'text_delta', delta: '[compaction done]\n' });
        break;
      case 'auto_retry_start':
        win.webContents.send('agent:event', { kind: 'text_delta', delta: `\n[retrying ${event.attempt}/${event.maxAttempts}...]\n` });
        break;
      case 'auto_retry_end':
        if (!event.success) win.webContents.send('agent:event', { kind: 'text_delta', delta: `[retry failed: ${event.finalError}]\n` });
        break;
      case 'agent_end':
        win.webContents.send('agent:done');
        break;
    }
  });

  apiKey = key;
  saveConfig({ ...loadConfig(), apiKey: key, model: resolved });
  startDaemon();
}

// --- Window ---
function createWindow() {
  const cfg = loadConfig();
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: 400, height: 300,
    x: cfg.windowX ?? Math.round((sw - 400) / 2),
    y: cfg.windowY ?? (sh - 340),
    frame: false, transparent: IS_MAC, alwaysOnTop: true,
    resizable: false, skipTaskbar: true, hasShadow: false, show: false,
    ...(IS_LINUX ? { backgroundColor: '#00000000' } : {}),
    webPreferences: {
      preload: join(__dirname, '..', 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false,
      sandbox: true, webSecurity: true
    }
  });

  win.loadFile(join(__dirname, '..', 'index.html'));
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(false);

  // globalShortcut works on macOS and X11, but not on Wayland.
  // On Wayland/Hyprland, use: bind = SUPER, 0, exec, cmd0
  // The single-instance lock handles the toggle.
  const isWayland = IS_LINUX && !!process.env.WAYLAND_DISPLAY;
  if (!isWayland) {
    globalShortcut.register('CommandOrControl+0', () => toggleWindow());
  }

  if (cfg.windowVisible) {
    win.show();
    win.webContents.once('did-finish-load', () => {
      win!.webContents.send('widget:focus');
      if (!apiKey) win!.webContents.send('agent:need-key');
    });
  }
}

function saveWinState(vis: boolean) {
  if (!win) return;
  const [x, y] = win.getPosition();
  const c = loadConfig();
  c.windowVisible = vis;
  c.windowX = x;
  c.windowY = y;
  saveConfig(c);
}

// --- IPC ---
ipcMain.handle('agent:validate-key', async (_e, key: string) => {
  const k = reqStr(key, 'Key', MAX_KEY);
  const provider = detectProvider(k);
  const base = provider === 'fireworks'
    ? 'https://api.fireworks.ai/inference/v1'
    : 'https://openrouter.ai/api/v1';
  try {
    const r = await fetch(`${base}/models`, {
      headers: { 'Authorization': `Bearer ${k}` },
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) return { ok: false, error: `Invalid key (${r.status})` };
    return { ok: true, provider };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

ipcMain.on('agent:set-key', async (_e, key: string, model?: string) => {
  if (!win) return;
  try {
    await initAgent(reqStr(key, 'Key', MAX_KEY), optStr(model, 'Model', MAX_MODEL));
    if (featureOnReady) featureOnReady();
    win.webContents.send('agent:ready');
  } catch (e) {
    win.webContents.send('agent:key-error', String(e));
  }
});

ipcMain.on('agent:prompt', async (_e, text: string) => {
  if (!session || !win) return;
  try { await runPrompt(reqStr(text, 'Prompt', MAX_PROMPT)); }
  catch (e) { sendError(e); }
});

ipcMain.on('agent:prompt-anima', async (_e, text: string) => {
  if (!session || !win) return;
  try { await runAnimaPrompt(reqStr(text, 'Prompt', MAX_PROMPT)); }
  catch (e) { sendError(e); }
});

ipcMain.on('agent:prompt-image', async (_e, text: string, img: string) => {
  if (!session || !win) return;
  try { await runPrompt(reqStr(text, 'Prompt', MAX_PROMPT), reqImg(img)); }
  catch (e) { sendError(e); }
});

ipcMain.on('relaunch-safe', () => {
  app.relaunch({ args: [...process.argv.slice(1).filter(a => a !== '--safe'), '--safe'] });
  app.exit(0);
});

ipcMain.handle('is-safe-mode', () => SAFE_MODE);

ipcMain.on('agent:cancel', async () => {
  if (!session) return;
  try { await session.abort(); } catch (e) { console.error('[cmd0] Abort:', e); }
  sessionBusy = false;
  animaUnlocked = false;
  if (win) win.webContents.send('agent:done');
});

ipcMain.on('agent:steer', async (_e, text: string) => {
  if (!session || !sessionBusy) return;
  try { await session.steer(reqStr(text, 'Steer', MAX_PROMPT)); }
  catch (e) { console.error('[cmd0] Steer:', e); }
});

ipcMain.on('widget:move', (_e, { dx, dy }: { dx: number; dy: number }) => {
  if (!win || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
  const [x, y] = win.getPosition();
  win.setPosition(x + dx, y + dy);
  saveWinState(true);
});

ipcMain.handle('read-clipboard-files', async () => {
  const r: { name: string; content: string }[] = [];
  try {
    if (IS_MAC) {
      const raw = clipboard.read('NSFilenamesPboardType');
      if (raw) {
        const ms = raw.match(/<string>(.*?)<\/string>/g);
        if (ms) {
          for (const m of ms) {
            const fp = m.replace(/<\/?string>/g, '');
            if (existsSync(fp)) {
              try { r.push(await readTextAttach(fp)); }
              catch (e) { console.warn('[cmd0] Skip clipboard file:', e); }
            }
          }
        }
      }
    } else {
      // Linux: try reading file paths from clipboard via text
      const raw = clipboard.readText().trim();
      if (raw) {
        for (const line of raw.split('\n')) {
          const fp = line.trim().replace(/^file:\/\//, '');
          if (fp && existsSync(fp)) {
            try { r.push(await readTextAttach(fp)); }
            catch (e) { console.warn('[cmd0] Skip clipboard file:', e); }
          }
        }
      }
    }
  } catch (e) {
    console.error('[cmd0] Clipboard:', e);
  }
  return r;
});

ipcMain.handle('pick-file', async () => {
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, { properties: ['openFile'] });
  if (res.canceled || !res.filePaths.length) return null;
  try { return await readTextAttach(res.filePaths[0]); }
  catch (e: any) { await dialog.showMessageBox(win, { type: 'warning', message: e.message }); return null; }
});

ipcMain.handle('screenshot', async () => await captureScreenshot());
ipcMain.handle('snapshot', (_e, name: string) => doSnapshot(name));
ipcMain.handle('restore-snapshot', (_e, name: string) => doRestore(name));
ipcMain.handle('list-snapshots', () => listSnaps());

// --- Feature state (set by initAgent) ---
let featureCleanup: (() => Promise<void>) | null = null;
let featureOnReady: (() => void) | null = null;

// --- Toggle helper ---
function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) {
    win.hide();
    saveWinState(false);
  } else {
    win.show();
    win.webContents.send('widget:focus');
    if (!apiKey) win.webContents.send('agent:need-key');
    saveWinState(true);
  }
}

// --- Startup ---
const CLI_MODE = snapIdx !== -1 || restoreIdx !== -1;

// Single-instance lock: second launch toggles the existing window
// (needed on Wayland where globalShortcut doesn't work)
if (!CLI_MODE) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => toggleWindow());
  }
}

if (CLI_MODE) {
  app.whenReady().then(() => {
    ensureDirs();
    if (snapIdx !== -1) {
      const name = process.argv[snapIdx + 1];
      if (!name) { console.error('Usage: cmd0 --snap <name>'); app.exit(1); return; }
      console.log(doSnapshot(name));
    } else if (restoreIdx !== -1) {
      const name = process.argv[restoreIdx + 1];
      if (!name) { console.error('Usage: cmd0 --restore <name>'); app.exit(1); return; }
      console.log(doRestore(name));
    }
    app.exit(0);
  });
}

if (!CLI_MODE) app.whenReady().then(async () => {
  const iconPath = join(__dirname, '..', 'icon.png');
  if (IS_MAC && existsSync(iconPath)) app.dock?.setIcon(nativeImage.createFromPath(iconPath));

  const trayIconPath = IS_MAC
    ? join(__dirname, '..', 'trayTemplate.png')
    : join(__dirname, '..', 'icon.png');
  if (existsSync(trayIconPath)) {
    const img = nativeImage.createFromPath(trayIconPath);
    if (IS_MAC) img.setTemplateImage(true);
    const r = img.resize({ width: 18, height: 18 });
    if (IS_MAC) r.setTemplateImage(true);
    tray = new Tray(r);
    tray.setToolTip('cmd0');
    const isWayland = IS_LINUX && !!process.env.WAYLAND_DISPLAY;
    const hotkeyLabel = IS_MAC ? 'Cmd+0' : isWayland ? 'Super+-' : 'Ctrl+0';
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `Toggle (${hotkeyLabel})`, click: () => {
        if (!win) return;
        if (win.isVisible()) win.hide();
        else { win.show(); win.webContents.send('widget:focus'); }
      }},
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ]));
    tray.on('click', () => {
      if (!win) return;
      if (win.isVisible()) win.hide();
      else { win.show(); win.webContents.send('widget:focus'); }
    });
  }

  ensureDirs();
  writeFileSync(PID_FILE, String(process.pid));
  process.on('SIGUSR2', () => toggleWindow());
  backupBaseFiles();

  if (SAFE_MODE) {
    restoreBaseFiles();
    try { execSync(TSC, { cwd: PROJECT_DIR, timeout: 30000 }); }
    catch (e) { console.error('[cmd0] Safe recompile:', e); }
  } else {
    // Compile with anima overlay so user customizations take effect
    try { compileWithOverlay(); }
    catch (e) { console.error('[cmd0] Overlay compile:', e); }
  }

  createWindow();
  const cfg = loadConfig();
  const key = cfg.apiKey || cfg.openrouterKey || process.env.OPENROUTER_API_KEY;
  if (key) {
    try {
      await initAgent(key, cfg.model || undefined);
      win?.webContents.once('did-finish-load', () => {
        if (featureOnReady) featureOnReady();
        win!.webContents.send('agent:ready');
      });
    } catch (e) {
      console.error('[cmd0] Init failed, requesting new key:', e);
      // Saved key didn't work — fall back to onboarding
      win?.webContents.once('did-finish-load', () => {
        win!.show();
        win!.webContents.send('agent:need-key');
      });
    }
  } else {
    // No key in config — show window and ask for one
    win?.webContents.once('did-finish-load', () => {
      win!.show();
      win!.webContents.send('agent:need-key');
    });
  }
});

app.on('will-quit', async () => {
  stopDaemon();
  try { unlinkSync(PID_FILE); } catch {}
  globalShortcut.unregisterAll();
  if (featureCleanup) await featureCleanup();
  if (settingsManager) await settingsManager.flush();
  session?.dispose();
});
app.on('window-all-closed', () => app.quit());
