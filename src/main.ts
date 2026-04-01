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
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';
import { Type } from '@sinclair/typebox';
import { chromium, Browser, Page, BrowserContext } from 'playwright';

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
  { src: 'index.html', dest: 'index.html' },
  { src: 'preload.cjs', dest: 'preload.cjs' },
  { src: 'tsconfig.json', dest: 'tsconfig.json' },
  { src: 'package.json', dest: 'package.json' },
  { src: 'me.md', dest: 'me.md' },
];

function syncAnimaFromProject() {
  for (const f of ANIMA_FILES) {
    const d = join(ANIMA_DIR, f.dest);
    if (!existsSync(d)) {
      const s = join(PROJECT_DIR, f.src);
      if (existsSync(s)) copyFileSync(s, d);
    }
  }
}

function backupBaseFiles() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  for (const f of ANIMA_FILES) {
    const s = join(PROJECT_DIR, f.src);
    const b = join(BACKUP_DIR, f.dest);
    if (existsSync(s)) copyFileSync(s, b);
  }
}

function restoreBaseFiles() {
  for (const f of ANIMA_FILES) {
    const b = join(BACKUP_DIR, f.dest);
    const d = join(PROJECT_DIR, f.src);
    if (existsSync(b)) copyFileSync(b, d);
  }
}

function syncProjectFromAnima() {
  backupBaseFiles();
  for (const f of ANIMA_FILES) {
    const s = join(ANIMA_DIR, f.dest);
    const d = join(PROJECT_DIR, f.src);
    if (existsSync(s)) copyFileSync(s, d);
  }
}

function listAnimaFiles(): string[] {
  return existsSync(ANIMA_DIR)
    ? readdirSync(ANIMA_DIR).filter(f => !f.startsWith('.'))
    : [];
}

const dirtyAnimaFiles = new Set<string>();

function syncDirtyToProject() {
  backupBaseFiles();
  for (const filename of dirtyAnimaFiles) {
    const mapping = ANIMA_FILES.find(f => f.dest === filename);
    if (mapping) {
      const src = join(ANIMA_DIR, mapping.dest);
      const dest = join(PROJECT_DIR, mapping.src);
      if (existsSync(src)) copyFileSync(src, dest);
    }
  }
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
  const files = findMdFiles(ANIMA_DIR);
  if (!files.length) return '';
  const secs = files.map(fp => {
    const c = readFileSync(fp, 'utf-8').trim();
    return c ? `--- ${fp.slice(ANIMA_DIR.length + 1)} ---\n${c}` : '';
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
function doSnapshot(name: string): string {
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
  syncProjectFromAnima();
  try {
    execSync(TSC, { cwd: PROJECT_DIR, timeout: 30000 });
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

// --- Browser Automation (Snapshot-based, inspired by Vercel agent-browser) ---

interface BrowserSession {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  refMap: Map<string, string>; // ref -> selector mapping
  createdAt: number;
}

const browserSessions = new Map<string, BrowserSession>();
let browserSessionCounter = 0;

function generateSessionId(): string {
  return `browser-${++browserSessionCounter}-${Date.now().toString(36)}`;
}

// Build accessibility tree snapshot with refs
async function buildSnapshot(page: Page, interactiveOnly = true): Promise<{ snapshot: string; refMap: Map<string, string> }> {
  const refMap = new Map<string, string>();
  let refCounter = 1;
  
  const buildNode = async (element: any, depth = 0): Promise<string> => {
    if (depth > 10) return '';
    
    const tag = await element.evaluate((el: any) => el.tagName?.toLowerCase()).catch(() => null);
    if (!tag) return '';
    
    // Get computed role
    const role = await element.evaluate((el: any) => {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      // Implicit roles for common elements
      if (el.tagName === 'BUTTON') return 'button';
      if (el.tagName === 'A' && el.href) return 'link';
      if (el.tagName === 'INPUT') return el.type || 'textbox';
      if (el.tagName === 'TEXTAREA') return 'textbox';
      if (el.tagName === 'SELECT') return 'combobox';
      if (el.tagName === 'IMG') return 'img';
      if (el.tagName.match(/^H[1-6]$/)) return 'heading';
      return null;
    }).catch(() => null);
    
    // Get accessible name
    const name = await element.evaluate((el: any) => {
      return el.getAttribute('aria-label') 
        || el.getAttribute('aria-labelledby') 
        || el.getAttribute('placeholder')
        || el.getAttribute('title')
        || el.textContent?.slice(0, 100)
        || '';
    }).catch(() => '');
    
    // Check if interactive
    const isInteractive = role && ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'menuitem', 'tab', 'switch'].includes(role);
    
    if (interactiveOnly && !isInteractive) {
      // Still recurse for children
      const children = await element.locator(':scope > *').all();
      const childSnapshots = [];
      for (const child of children) {
        const childSnap = await buildNode(child, depth + 1);
        if (childSnap) childSnapshots.push(childSnap);
      }
      return childSnapshots.join('');
    }
    
    // Assign ref to interactive elements
    let ref = '';
    let selector = '';
    if (isInteractive) {
      const refId = `e${refCounter++}`;
      ref = `@${refId}`;
      
      // Build stable selector
      const testId = await element.getAttribute('data-testid').catch(() => null);
      const id = await element.getAttribute('id').catch(() => null);
      if (testId) {
        selector = `[data-testid="${testId}"]`;
      } else if (id) {
        selector = `#${id}`;
      } else {
        // Use nth-of-type for position-based selector
        const tagName = await element.evaluate((el: any) => el.tagName.toLowerCase());
        selector = `${tagName}:nth-of-type(${await element.evaluate((el: any) => {
          let i = 1;
          let sibling = el.previousElementSibling;
          while (sibling) {
            if (sibling.tagName === el.tagName) i++;
            sibling = sibling.previousElementSibling;
          }
          return i;
        })})`;
      }
      refMap.set(refId, selector);
    }
    
    // Build output line
    const indent = '  '.repeat(depth);
    const attrs = [];
    const inputType = await element.getAttribute('type').catch(() => null);
    if (inputType) attrs.push(`type="${inputType}"`);
    const placeholder = await element.getAttribute('placeholder').catch(() => null);
    if (placeholder) attrs.push(`placeholder="${placeholder.slice(0, 30)}"`);
    const href = await element.getAttribute('href').catch(() => null);
    if (href) attrs.push(`href`);
    
    let line = `${indent}${ref} [${role || tag}]`;
    if (name.trim()) line += ` "${name.trim().slice(0, 50)}"`;
    if (attrs.length) line += ` ${attrs.join(' ')}`;
    
    // Get children if container
    const children = await element.locator(':scope > *').all();
    const childLines = [];
    for (const child of children) {
      const childLine = await buildNode(child, depth + 1);
      if (childLine && !childLine.startsWith(indent + '  @')) {
        // Only include non-ref children if we're not interactive-only mode
        if (!interactiveOnly) childLines.push(childLine);
      } else if (childLine) {
        childLines.push(childLine);
      }
    }
    
    if (childLines.length) {
      return line + '\n' + childLines.join('\n');
    }
    return line;
  };
  
  // Get body and build tree
  const body = await page.locator('body');
  const snapshot = await buildNode(body, 0);
  
  return { snapshot: snapshot || '(empty page)', refMap };
}

// Execute browser command
async function browserCommand(sessionId: string, command: string, args: string[]): Promise<string> {
  const session = browserSessions.get(sessionId);
  if (!session) return `Session not found: ${sessionId}`;
  
  const page = session.page;
  
  switch (command) {
    case 'open':
    case 'navigate':
    case 'goto': {
      const url = args[0];
      if (!url) return 'Usage: open <url>';
      await page.goto(url, { waitUntil: 'networkidle' });
      return `Opened: ${page.url()}`;
    }
    
    case 'snapshot': {
      const interactiveOnly = !args.includes('--full');
      const { snapshot, refMap } = await buildSnapshot(page, interactiveOnly);
      session.refMap = refMap;
      return `Page snapshot:\n\n${snapshot}\n\nUse @eN refs to interact with elements.`;
    }
    
    case 'click': {
      const target = args[0];
      if (!target) return 'Usage: click <@ref or selector>';
      const selector = target.startsWith('@') ? session.refMap.get(target.slice(1)) || target : target;
      await page.locator(selector).first().click();
      return `Clicked: ${target}`;
    }
    
    case 'fill':
    case 'type': {
      const target = args[0];
      const text = args.slice(1).join(' ');
      if (!target || !text) return `Usage: ${command} <@ref or selector> <text>`;
      const selector = target.startsWith('@') ? session.refMap.get(target.slice(1)) || target : target;
      await page.locator(selector).first().fill(text);
      return `${command === 'fill' ? 'Filled' : 'Typed'} "${text}" into ${target}`;
    }
    
    case 'press': {
      const key = args[0];
      if (!key) return 'Usage: press <key> (Enter, Escape, Tab, etc.)';
      await page.keyboard.press(key as any);
      return `Pressed: ${key}`;
    }
    
    case 'screenshot': {
      const fullPage = args.includes('--full');
      const buffer = await page.screenshot({ fullPage, type: 'png' });
      return `[screenshot:${buffer.toString('base64')}]`;
    }
    
    case 'scroll': {
      const direction = args[0] || 'down';
      if (direction === 'bottom') {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      } else {
        const amount = parseInt(args[1] || '500');
        await page.mouse.wheel(0, direction === 'up' ? -amount : amount);
      }
      return `Scrolled: ${direction}`;
    }
    
    case 'wait': {
      const ms = parseInt(args[0] || '1000');
      await page.waitForTimeout(ms);
      return `Waited: ${ms}ms`;
    }
    
    case 'eval': {
      const script = args.join(' ');
      if (!script) return 'Usage: eval <javascript>';
      const result = await page.evaluate(script);
      return `Result: ${JSON.stringify(result, null, 2)}`;
    }
    
    case 'text':
    case 'gettext': {
      const bodyText = await page.evaluate(() => document.body.innerText);
      return bodyText.slice(0, 3000);
    }
    
    default:
      return `Unknown command: ${command}. Available: open, snapshot, click, fill, type, press, screenshot, scroll, wait, eval, text`;
  }
}

// --- Tools ---
function text(t: string) { return { content: [{ type: 'text' as const, text: t }], details: {} }; }
function image(data: string) { return { content: [{ type: 'image' as const, data, mimeType: 'image/png' }], details: {} }; }

function createTools(): ToolDefinition[] {
  return [
    {
      name: 'anima_list', label: 'List Files',
      description: 'List editable source files.',
      promptSnippet: 'anima_list — list editable source files in ~/.cmd0/anima',
      parameters: Type.Object({}),
      async execute() {
        return text(listAnimaFiles().join('\n'));
      }
    },
    {
      name: 'anima_read', label: 'Read File',
      description: 'Read a source file from ~/.cmd0/anima.',
      promptSnippet: 'anima_read — read a source file by filename',
      parameters: Type.Object({ filename: Type.String() }),
      async execute(_id: string, p: { filename: string }) {
        try {
          const fp = resolveAnimaPath(p.filename);
          if (!existsSync(fp)) return text('Not found: ' + p.filename);
          return text(readFileSync(fp, 'utf-8'));
        } catch (e: any) {
          return text(e.message);
        }
      }
    },
    {
      name: 'anima_write', label: 'Write File',
      description: 'Write a source file. Call anima_reload after. Only available during /0 self-modification.',
      promptSnippet: 'anima_write — write a source file, call anima_reload after (requires /0)',
      parameters: Type.Object({ filename: Type.String(), content: Type.String() }),
      async execute(_id: string, p: { filename: string; content: string }) {
        if (!animaUnlocked) return text('anima_write is only available during /0 self-modification.');
        try {
          writeFileSync(resolveAnimaPath(p.filename), p.content, 'utf-8');
          dirtyAnimaFiles.add(p.filename);
          return text(`Wrote ${p.filename}`);
        } catch (e: any) {
          return text(e.message);
        }
      }
    },
    {
      name: 'anima_reload', label: 'Reload',
      description: 'Auto-snapshots, copies only changed files to project, recompiles, restarts. Only available during /0 self-modification.',
      promptSnippet: 'anima_reload — snapshot, recompile, and restart (requires /0)',
      parameters: Type.Object({}),
      async execute() {
        if (!animaUnlocked) return text('anima_reload is only available during /0 self-modification.');
        try {
          doSnapshot(`auto-${Date.now()}`);
          syncDirtyToProject();
          execSync(TSC, { cwd: PROJECT_DIR, timeout: 30000 });
          setTimeout(() => { app.relaunch(); app.exit(0); }, 500);
          return text(`Recompiled (${dirtyAnimaFiles.size} files). Restarting...`);
        } catch (e: any) {
          return text(`Build failed: ${e.stdout?.toString() || e.message}`);
        }
      }
    },
    {
      name: 'web_search', label: 'Search',
      description: 'Search DuckDuckGo.',
      promptSnippet: 'web_search — search the web via DuckDuckGo',
      parameters: Type.Object({ query: Type.String() }),
      async execute(_id: string, p: { query: string }, signal?: AbortSignal) {
        try {
          const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(p.query)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cmd0/1.0)' },
            signal
          });
          const h = await r.text();
          const res: string[] = [];
          const rx = /<a rel="nofollow" class="result__a" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
          let m; let i = 0;
          while ((m = rx.exec(h)) && i < 8) {
            const t = m[2].replace(/<[^>]+>/g, '').trim();
            const s = m[3].replace(/<[^>]+>/g, '').trim();
            if (t) { res.push(`${t}\n${m[1]}\n${s}`); i++; }
          }
          return text(res.length ? res.join('\n\n') : 'No results.');
        } catch (e: any) {
          return text(`Search failed: ${e.message}`);
        }
      }
    },
    {
      name: 'web_fetch', label: 'Fetch',
      description: 'Fetch URL content.',
      promptSnippet: 'web_fetch — fetch and extract text from a URL',
      parameters: Type.Object({ url: Type.String() }),
      async execute(_id: string, p: { url: string }, signal?: AbortSignal) {
        try {
          const u = validateFetchUrl(p.url);
          const r = await fetch(u, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cmd0/1.0)' },
            signal: signal ?? AbortSignal.timeout(15000)
          });
          const h = await r.text();
          const cleaned = h
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 8000);
          return text(cleaned);
        } catch (e: any) {
          return text(`Fetch failed: ${e.message}`);
        }
      }
    },
    {
      name: 'notify', label: 'Notify',
      description: 'Send a desktop notification.',
      promptSnippet: 'notify — send a desktop notification',
      parameters: Type.Object({ title: Type.String(), message: Type.String() }),
      async execute(_id: string, p: { title: string; message: string }) {
        try {
          if (IS_MAC) {
            await execFileAsync('osascript', [
              '-e', `display notification ${JSON.stringify(p.message)} with title ${JSON.stringify(p.title)}`
            ]);
          } else {
            await execFileAsync('notify-send', [p.title, p.message]);
          }
          return text('Sent.');
        } catch (e: any) {
          return text(`Failed: ${e.message}`);
        }
      }
    },
    {
      name: 'screenshot', label: 'Screenshot',
      description: 'Capture a region of the screen.',
      promptSnippet: 'screenshot — capture a region of the screen',
      parameters: Type.Object({}),
      async execute() {
        const b = await captureScreenshot();
        if (b) return image(b);
        return text('Failed.');
      }
    },
    {
      name: 'task_list', label: 'Tasks',
      description: 'List tasks.',
      promptSnippet: 'task_list — list all tasks and their status',
      parameters: Type.Object({}),
      async execute() {
        const t = loadTasks();
        if (!t.length) return text('No tasks.');
        const lines = t.map(x =>
          `[${x.status}] ${x.id}: ${x.description}`
          + (x.type === 'recurring' ? ` (${x.intervalMinutes}m)` : '')
          + (x.lastRun ? ` last:${x.lastRun}` : '')
        );
        return text(lines.join('\n'));
      }
    },
    {
      name: 'task_add', label: 'Add Task',
      description: 'Add task.',
      promptSnippet: 'task_add — add a one-time or recurring task',
      parameters: Type.Object({
        description: Type.String(),
        type: Type.Union([Type.Literal('once'), Type.Literal('recurring')]),
        intervalMinutes: Type.Optional(Type.Number())
      }),
      async execute(_id: string, p: { description: string; type: 'once' | 'recurring'; intervalMinutes?: number }) {
        const t = addTask(reqStr(p.description, 'desc', MAX_TASK), p.type, p.intervalMinutes);
        return text(`Added ${t.id}: ${t.description}`);
      }
    },
    {
      name: 'task_complete', label: 'Complete',
      description: 'Complete task.',
      promptSnippet: 'task_complete — mark a task as done',
      parameters: Type.Object({ id: Type.String() }),
      async execute(_id: string, p: { id: string }) {
        completeTask(p.id);
        return text(`Done: ${p.id}`);
      }
    },
    {
      name: 'task_remove', label: 'Remove',
      description: 'Remove task.',
      promptSnippet: 'task_remove — remove a task by id',
      parameters: Type.Object({ id: Type.String() }),
      async execute(_id: string, p: { id: string }) {
        removeTask(p.id);
        return text(`Removed: ${p.id}`);
      }
    },
    // --- Browser Automation (Unified Tool) ---
    {
      name: 'browser', label: 'Browser',
      description: 'Browser automation using snapshot-based workflow. Start session, then use commands: open, snapshot, click, fill, type, press, screenshot, scroll, wait, eval, text. Prefer using @eN refs from snapshots over CSS selectors.',
      promptSnippet: 'browser — browser automation with snapshot workflow',
      parameters: Type.Object({
        sessionId: Type.Optional(Type.String({ description: 'Session ID (omit to start new session)' })),
        action: Type.Union([
          Type.Literal('start'),
          Type.Literal('open'),
          Type.Literal('snapshot'),
          Type.Literal('click'),
          Type.Literal('fill'),
          Type.Literal('type'),
          Type.Literal('press'),
          Type.Literal('screenshot'),
          Type.Literal('scroll'),
          Type.Literal('wait'),
          Type.Literal('eval'),
          Type.Literal('text'),
          Type.Literal('close')
        ]),
        args: Type.Optional(Type.Array(Type.String(), { description: 'Command arguments' })),
        headless: Type.Optional(Type.Boolean({ description: 'For start action: run headless' }))
      }),
      async execute(_id: string, p: { sessionId?: string; action: string; args?: string[]; headless?: boolean }) {
        // Start new session if needed
        if (p.action === 'start' || !p.sessionId) {
          if (p.action !== 'start' && !p.sessionId) {
            return text('No session ID provided. Start a session first with: browser action=start');
          }
          
          try {
            const browser = await chromium.launch({
              headless: p.headless ?? false,
              slowMo: p.headless ? 0 : 100,
              args: ['--disable-blink-features=AutomationControlled']
            });
            
            const context = await browser.newContext({
              viewport: { width: 1280, height: 800 },
              userAgent: IS_MAC
                ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });
            
            const page = await context.newPage();
            
            const sessionId = generateSessionId();
            const session: BrowserSession = {
              id: sessionId,
              browser,
              context,
              page,
              refMap: new Map(),
              createdAt: Date.now()
            };
            
            browserSessions.set(sessionId, session);
            
            if (p.action === 'start') {
              return text(`Browser started: ${sessionId}\nHeadless: ${p.headless ?? false}\n\nNext: browser sessionId=${sessionId} action=open args=["https://example.com"]`);
            }
            
            // Auto-set sessionId for non-start actions
            p.sessionId = sessionId;
          } catch (e: any) {
            return text(`Failed to start browser: ${e.message}`);
          }
        }
        
        const sessionId = p.sessionId!;
        
        // Handle close
        if (p.action === 'close') {
          const session = browserSessions.get(sessionId);
          if (!session) return text(`Session not found: ${sessionId}`);
          await session.context.close();
          await session.browser.close();
          browserSessions.delete(sessionId);
          return text(`Closed: ${sessionId}`);
        }
        
        // Execute command
        const args = p.args || [];
        const result = await browserCommand(sessionId, p.action, args);
        
        // Check if result is a screenshot
        if (result.startsWith('[screenshot:')) {
          const b64 = result.slice(12, -1);
          return image(b64);
        }
        
        return text(result);
      }
    },
  ];
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
  });
  await rl.reload();

  const result = await createAgentSession({
    cwd: PROJECT_DIR,
    agentDir,
    sessionManager: SessionManager.continueRecent(PROJECT_DIR, join(CMD0_DIR, 'sessions')),
    settingsManager,
    authStorage,
    modelRegistry: new ModelRegistry(authStorage),
    model,
    thinkingLevel: 'low',
    customTools: createTools(),
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

// --- Cleanup on exit ---
async function cleanupBrowsers() {
  for (const [id, session] of browserSessions) {
    try {
      await session.context.close();
      await session.browser.close();
    } catch (e) {
      console.error(`[cmd0] Failed to close browser ${id}:`, e);
    }
  }
  browserSessions.clear();
}

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
    syncAnimaFromProject();
  }

  createWindow();
  const cfg = loadConfig();
  const key = cfg.apiKey || cfg.openrouterKey || process.env.OPENROUTER_API_KEY;
  if (key) {
    try {
      await initAgent(key, cfg.model || undefined);
      win?.webContents.once('did-finish-load', () => {
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
  await cleanupBrowsers();
  if (settingsManager) await settingsManager.flush(); 
  session?.dispose(); 
});
app.on('window-all-closed', () => app.quit());
