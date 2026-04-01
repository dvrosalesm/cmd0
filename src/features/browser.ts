import { join } from 'path';
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { Type } from '@sinclair/typebox';
import { chromium, Page, BrowserContext } from 'playwright';
import type { Feature, FeatureContext } from './types.js';

/** Seed Chromium profile name and avatar icon before first launch */
function seedProfile(profileDir: string, projectDir: string) {
  const defaultDir = join(profileDir, 'Default');
  mkdirSync(defaultDir, { recursive: true });

  // Set profile name in Preferences
  const prefsPath = join(defaultDir, 'Preferences');
  let prefs: Record<string, any> = {};
  if (existsSync(prefsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(prefsPath, 'utf-8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) prefs = parsed;
    } catch (e) {
      console.warn('[cmd0] Browser preferences corrupted, starting fresh:', e);
    }
  }
  if (!prefs.profile || typeof prefs.profile !== 'object') prefs.profile = {};
  prefs.profile.name = 'cmd0';
  writeFileSync(prefsPath, JSON.stringify(prefs, null, 2), 'utf-8');

  // Copy app icon as profile picture
  const iconSrc = join(projectDir, 'icon.png');
  const iconDest = join(defaultDir, 'Google Profile Picture.png');
  if (existsSync(iconSrc) && !existsSync(iconDest)) {
    copyFileSync(iconSrc, iconDest);
  }
}

interface BrowserSession {
  id: string;
  context: BrowserContext;
  page: Page;
  refMap: Map<string, string>;
  createdAt: number;
  profile: string;
}

const sessions = new Map<string, BrowserSession>();
let sessionCounter = 0;

function generateSessionId(): string {
  return `browser-${++sessionCounter}-${Date.now().toString(36)}`;
}

async function buildSnapshot(page: Page, interactiveOnly = true): Promise<{ snapshot: string; refMap: Map<string, string> }> {
  const refMap = new Map<string, string>();
  let refCounter = 1;

  const buildNode = async (element: any, depth = 0): Promise<string> => {
    if (depth > 10) return '';
    const tag = await element.evaluate((el: any) => el.tagName?.toLowerCase()).catch(() => null);
    if (!tag) return '';

    const role = await element.evaluate((el: any) => {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      if (el.tagName === 'BUTTON') return 'button';
      if (el.tagName === 'A' && el.href) return 'link';
      if (el.tagName === 'INPUT') return el.type || 'textbox';
      if (el.tagName === 'TEXTAREA') return 'textbox';
      if (el.tagName === 'SELECT') return 'combobox';
      if (el.tagName === 'IMG') return 'img';
      if (el.tagName.match(/^H[1-6]$/)) return 'heading';
      return null;
    }).catch(() => null);

    const name = await element.evaluate((el: any) => {
      return el.getAttribute('aria-label')
        || el.getAttribute('aria-labelledby')
        || el.getAttribute('placeholder')
        || el.getAttribute('title')
        || el.textContent?.slice(0, 100)
        || '';
    }).catch(() => '');

    const isInteractive = role && ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'menuitem', 'tab', 'switch'].includes(role);

    if (interactiveOnly && !isInteractive) {
      const children = await element.locator(':scope > *').all();
      const childSnapshots = [];
      for (const child of children) {
        const childSnap = await buildNode(child, depth + 1);
        if (childSnap) childSnapshots.push(childSnap);
      }
      return childSnapshots.join('');
    }

    let ref = '';
    let selector = '';
    if (isInteractive) {
      const refId = `e${refCounter++}`;
      ref = `@${refId}`;
      const testId = await element.getAttribute('data-testid').catch(() => null);
      const id = await element.getAttribute('id').catch(() => null);
      if (testId) {
        selector = `[data-testid="${testId}"]`;
      } else if (id) {
        selector = `#${id}`;
      } else {
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

    const children = await element.locator(':scope > *').all();
    const childLines = [];
    for (const child of children) {
      const childLine = await buildNode(child, depth + 1);
      if (childLine && !childLine.startsWith(indent + '  @')) {
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

  const body = await page.locator('body');
  const snapshot = await buildNode(body, 0);
  return { snapshot: snapshot || '(empty page)', refMap };
}

async function browserCommand(sessionId: string, command: string, args: string[]): Promise<string> {
  const s = sessions.get(sessionId);
  if (!s) return `Session not found: ${sessionId}`;
  const page = s.page;

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
      s.refMap = refMap;
      return `Page snapshot:\n\n${snapshot}\n\nUse @eN refs to interact with elements.`;
    }
    case 'click': {
      const target = args[0];
      if (!target) return 'Usage: click <@ref or selector>';
      const selector = target.startsWith('@') ? s.refMap.get(target.slice(1)) || target : target;
      await page.locator(selector).first().click();
      return `Clicked: ${target}`;
    }
    case 'fill':
    case 'type': {
      const target = args[0];
      const text = args.slice(1).join(' ');
      if (!target || !text) return `Usage: ${command} <@ref or selector> <text>`;
      const selector = target.startsWith('@') ? s.refMap.get(target.slice(1)) || target : target;
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

const feature: Feature = {
  name: 'browser',
  description: 'Browser automation using Playwright with persistent profiles and snapshot-based workflow',

  createTools(ctx: FeatureContext) {
    const profilesDir = join(ctx.CMD0_DIR, 'browser-profiles');

    return [
      {
        name: 'browser', label: 'Browser',
        description: 'Browser automation using snapshot-based workflow with persistent profiles. Logins, cookies, and localStorage persist across sessions. Start session, then use commands: open, snapshot, click, fill, type, press, screenshot, scroll, wait, eval, text. Prefer using @eN refs from snapshots over CSS selectors.',
        promptSnippet: 'browser — browser automation with persistent profiles and snapshot workflow. Sessions remember logins.',
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
          headless: Type.Optional(Type.Boolean({ description: 'For start action: run headless' })),
          profile: Type.Optional(Type.String({ description: 'Profile name for persistent sessions (default: "default"). Each profile keeps its own cookies/logins.' }))
        }),
        async execute(_id: string, p: { sessionId?: string; action: string; args?: string[]; headless?: boolean; profile?: string }) {
          if (p.action === 'start' || !p.sessionId) {
            if (p.action !== 'start' && !p.sessionId) {
              return ctx.text('No session ID provided. Start a session first with: browser action=start');
            }
            try {
              const profileName = (p.profile || 'cmd0').replace(/[^a-zA-Z0-9_-]/g, '_');
              const profileDir = join(profilesDir, profileName);
              mkdirSync(profileDir, { recursive: true });
              seedProfile(profileDir, ctx.PROJECT_DIR);

              const context = await chromium.launchPersistentContext(profileDir, {
                headless: p.headless ?? false,
                slowMo: p.headless ? 0 : 100,
                args: ['--disable-blink-features=AutomationControlled'],
                viewport: { width: 1280, height: 800 },
                userAgent: ctx.IS_MAC
                  ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                  : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
              });

              // Persistent context opens with one page already; reuse it
              const page = context.pages()[0] || await context.newPage();

              const sessionId = generateSessionId();
              const session: BrowserSession = { id: sessionId, context, page, refMap: new Map(), createdAt: Date.now(), profile: profileName };
              sessions.set(sessionId, session);

              if (p.action === 'start') {
                return ctx.text(`Browser started: ${sessionId}\nProfile: ${profileName} (persistent — logins will be remembered)\nHeadless: ${p.headless ?? false}\n\nNext: browser sessionId=${sessionId} action=open args=["https://example.com"]`);
              }
              p.sessionId = sessionId;
            } catch (e: any) {
              return ctx.text(`Failed to start browser: ${e.message}`);
            }
          }

          const sessionId = p.sessionId!;

          if (p.action === 'close') {
            const s = sessions.get(sessionId);
            if (!s) return ctx.text(`Session not found: ${sessionId}`);
            await s.context.close();
            sessions.delete(sessionId);
            return ctx.text(`Closed: ${sessionId} (profile "${s.profile}" saved)`);
          }

          const args = p.args || [];
          const result = await browserCommand(sessionId, p.action, args);

          if (result.startsWith('[screenshot:')) {
            const b64 = result.slice(12, -1);
            return ctx.image(b64);
          }
          return ctx.text(result);
        }
      },
    ];
  },

  async cleanup() {
    for (const [id, s] of sessions) {
      try {
        await s.context.close();
      } catch (e) {
        console.error(`[cmd0] Failed to close browser ${id}:`, e);
      }
    }
    sessions.clear();
  }
};

export default feature;
