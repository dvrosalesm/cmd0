// renderer — loaded as a plain <script>, not a module

const input = document.getElementById('input') as HTMLInputElement;
const attach = document.getElementById('attach')!;
const bubble = document.getElementById('bubble')!;
const bar = document.getElementById('bar')!;
const attachmentsEl = document.getElementById('attachments')!;

let busy = false;
let waitingForKey = false;
let waitingForModel = false;
let pendingKey = '';

// --- Attachments ---
interface Attachment { type: 'screenshot' | 'file'; name: string; data: string; }
let attachments: Attachment[] = [];
let attachCounter = 0;

function addAttachment(att: Attachment) { attachments.push(att); renderAttachments(); }
function removeAttachment(i: number) { attachments.splice(i, 1); renderAttachments(); }
function clearAttachments() { attachments = []; renderAttachments(); }

function renderAttachments() {
  if (attachments.length === 0) { attachmentsEl.classList.add('hidden'); attachmentsEl.innerHTML = ''; return; }
  attachmentsEl.classList.remove('hidden');
  attachmentsEl.replaceChildren();
  for (const [i, att] of attachments.entries()) {
    const pill = document.createElement('div'); pill.className = 'pill';
    const icon = document.createElement('span');
    icon.innerHTML = att.type === 'screenshot'
      ? '<svg class="pill-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>'
      : '<svg class="pill-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';
    const name = document.createElement('span'); name.className = 'pill-name'; name.textContent = att.name;
    const btn = document.createElement('button'); btn.className = 'pill-remove'; btn.type = 'button'; btn.textContent = '\u00d7';
    btn.addEventListener('click', () => removeAttachment(i));
    pill.append(icon, name, btn);
    attachmentsEl.appendChild(pill);
  }
}

// --- Log state ---
let logParts: string[] = [];
let currentThinking = '';
let currentText = '';
let isThinking = false;

function flushLog() {
  const sections = [...logParts];
  if (isThinking && currentThinking) sections.push('[thinking] ' + currentThinking);
  if (currentText) sections.push(currentText);
  if (sections.length === 0) return;
  bubble.textContent = sections.join('\n\n');
  bubble.classList.remove('hidden');
  bubble.scrollTop = bubble.scrollHeight;
}

function showActivity(label?: string) {
  const activity = document.createElement('span');
  activity.className = 'activity';

  const dots = document.createElement('span');
  dots.className = 'dots';
  dots.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
  activity.appendChild(dots);

  if (label) {
    const status = document.createElement('span');
    status.className = 'activity-label';
    status.textContent = label;
    activity.appendChild(status);
  }

  bubble.replaceChildren(activity);
  bubble.classList.remove('hidden');
}

function showBubble(text: string) {
  bubble.textContent = text;
  bubble.classList.remove('hidden');
}

// --- Command palette ---
type CmdEntry = { name: string; description: string; source: string };
let allCommands: CmdEntry[] = [];
let paletteVisible = false;
let paletteIdx = -1;
let paletteFiltered: CmdEntry[] = [];

const palette = document.createElement('div');
palette.className = 'palette hidden';
bar.parentElement!.insertBefore(palette, bar);

async function loadCommands() {
  try { allCommands = await window.cmd0.getCommands(); } catch { /* not ready yet */ }
}

function updatePalette() {
  const val = input.value;
  if (!val.startsWith('/') || val.includes(' ')) { hidePalette(); return; }
  const query = val.slice(1).toLowerCase();
  paletteFiltered = query
    ? allCommands.filter(c => c.name.toLowerCase().includes(query))
    : allCommands;
  if (!paletteFiltered.length) { hidePalette(); return; }
  paletteIdx = 0;
  renderPalette();
  palette.classList.remove('hidden');
  paletteVisible = true;
}

function renderPalette() {
  palette.innerHTML = paletteFiltered.map((c, i) =>
    `<div class="palette-item${i === paletteIdx ? ' active' : ''}" data-idx="${i}">` +
    `<span class="palette-name">/${c.name}</span>` +
    `<span class="palette-desc">${c.description}</span>` +
    (c.source !== 'builtin' ? `<span class="palette-source">${c.source}</span>` : '') +
    `</div>`
  ).join('');
}

function hidePalette() {
  palette.classList.add('hidden');
  paletteVisible = false;
  paletteIdx = -1;
}

function selectPaletteItem(idx: number) {
  const cmd = paletteFiltered[idx];
  if (!cmd) return;
  input.value = '/' + cmd.name + ' ';
  hidePalette();
  bar.classList.add('command');
  input.focus();
}

function scrollPaletteActive() {
  const el = palette.querySelector('.palette-item.active') as HTMLElement | null;
  if (el) el.scrollIntoView({ block: 'nearest' });
}

palette.addEventListener('mousedown', (e) => {
  e.preventDefault(); // keep input focus
  const item = (e.target as HTMLElement).closest('.palette-item') as HTMLElement | null;
  if (item) selectPaletteItem(Number(item.dataset.idx));
});

input.addEventListener('blur', () => setTimeout(hidePalette, 100));

function updateCommandHighlight() {
  const val = input.value;
  const isCmd = val.startsWith('/') && allCommands.some(c => val === '/' + c.name || val.startsWith('/' + c.name + ' '));
  bar.classList.toggle('command', isCmd);
}

input.addEventListener('input', () => {
  updateCommandHighlight();
  updatePalette();
});

// --- Onboarding ---
function askForKey() {
  waitingForKey = true; waitingForModel = false; pendingKey = '';
  input.value = ''; input.type = 'password'; input.placeholder = 'Paste your API key...';
  showBubble('Enter your API key.\n\nSupported: OpenRouter (sk-or-...), Fireworks AI (fw_...)');
  input.focus();
}
function askForModel(provider: string) {
  waitingForKey = false; waitingForModel = true; input.type = 'text'; input.value = '';
  const def = provider === 'fireworks' ? 'accounts/fireworks/routers/kimi-k2p5-turbo' : 'minimax/minimax-m2.7';
  input.placeholder = def;
  showBubble(`Detected ${provider}. Enter model name or press Enter for default:\n${def}`);
  input.focus();
}

// --- Input handler ---
input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (paletteVisible) { hidePalette(); e.preventDefault(); return; } input.blur(); return; }

  if (paletteVisible) {
    if (e.key === 'ArrowDown') { e.preventDefault(); paletteIdx = (paletteIdx + 1) % paletteFiltered.length; renderPalette(); scrollPaletteActive(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); paletteIdx = (paletteIdx - 1 + paletteFiltered.length) % paletteFiltered.length; renderPalette(); scrollPaletteActive(); return; }
    if (e.key === 'Tab' || (e.key === 'Enter' && paletteIdx >= 0)) { e.preventDefault(); selectPaletteItem(paletteIdx); return; }
  }

  if (e.key !== 'Enter') return;
  if (!input.value.trim() && !waitingForModel) return;

  const text = input.value.trim(); input.value = ''; bar.classList.remove('command');

  if (waitingForKey) {
    if (!text) return;
    input.disabled = true; showBubble('Validating key...');
    window.cmd0.validateKey(text).then(r => {
      input.disabled = false;
      if (r.ok) { pendingKey = text; askForModel(r.provider!); }
      else { showBubble('Invalid key: ' + (r.error || 'unknown error') + '\n\nTry again.'); input.focus(); }
    });
    return;
  }
  if (waitingForModel) { showBubble('Connecting...'); input.disabled = true; waitingForModel = false; window.cmd0.setKey(pendingKey, text || undefined); return; }

  if (text === '/safe') { showBubble('Restarting in safe mode...'); window.cmd0.relaunchSafe(); return; }
  if (text === '/cancel') { if (busy) { window.cmd0.cancel(); showBubble('Cancelled.'); input.placeholder = 'Say something...'; busy = false; logParts = []; currentText = ''; currentThinking = ''; isThinking = false; } return; }
  if (text === '/snapshots') { window.cmd0.listSnapshots().then(l => showBubble(l.length ? 'Snapshots:\n' + l.map(s => '  - ' + s).join('\n') : 'No snapshots.')); return; }
  if (text.startsWith('/snap ')) { const n = text.slice(6).trim(); if (!n) { showBubble('Usage: /snap <name>'); return; } window.cmd0.snapshot(n).then(m => showBubble(m)); return; }
  if (text.startsWith('/restore ')) { const n = text.slice(9).trim(); if (!n) { showBubble('Usage: /restore <name>'); return; } window.cmd0.restoreSnapshot(n).then(m => showBubble(m)); return; }

  if (text === '/tasks' || text.startsWith('/tasks ')) {
    const arg = text.slice(6).trim(); startBusy();
    window.cmd0.prompt(arg ? 'Manage tasks: ' + arg + '\n\nUse task_add, task_remove, task_list, task_complete.' : 'List all tasks using task_list.');
    return;
  }

  if (text.startsWith('/update')) {
    startBusy();
    window.cmd0.promptAnima([
      'The user wants to update cmd0 to the latest version.',
      'Steps:',
      '1. Run `git pull` in the project directory to fetch upstream changes.',
      '2. Use anima_list to see which files have [customized] overrides.',
      '3. For each customized file, compare the anima version with the new upstream source (use anima_read to see what the user has, use bash to cat the project source).',
      '4. If there are conflicts (upstream changed something the user also customized), explain the differences and ask the user how to resolve.',
      '5. IMPORTANT: Static files (index.html, style.css, preload.cjs) live in ~/.cmd0/anima/ and are loaded at runtime from there.',
      '   After git pull, read the NEW upstream versions of these files and merge any upstream changes into the anima copies.',
      '   For example, if upstream added a new element to index.html, add it to the anima copy while preserving the user\'s customizations.',
      '6. Once resolved, call anima_reload to recompile with the updated source + user overlays.',
      '7. After updating, append a brief summary of what changed to ~/.cmd0/changelog.md.',
    ].join('\n'));
    return;
  }

  if (text.startsWith('/0')) {
    const instr = text.slice(2).trim();
    if (!instr) { showBubble('Usage: /0 <what to change>'); return; }
    startBusy();
    window.cmd0.promptAnima([
      'You are modifying your own source code via the anima overlay system.',
      '~/.cmd0/anima/ stores ONLY your customizations as overrides on the upstream source.',
      'Use anima_list to see files ([customized] = has override), anima_read to read (shows override or upstream), anima_write to write overrides.',
      'After changes call anima_reload — it overlays anima onto source, compiles, restores source, and restarts.',
      'If you need npm packages, use bash to run npm install in the project dir.',
      'IMPORTANT: Do NOT remove existing features or simplify working code. Only make the requested change.',
      'After making changes, append a brief entry to ~/.cmd0/changelog.md describing what was changed and why.',
      '', 'The user wants: ' + instr,
    ].join('\n'));
    return;
  }

  if (busy) {
    window.cmd0.steer(text);
    logParts.push(`[you] ${text}`); flushLog();
  } else {
    startBusy();
    const screenshots = attachments.filter(a => a.type === 'screenshot');
    const files = attachments.filter(a => a.type === 'file');
    let prompt = text;
    if (files.length) prompt = files.map(f => `--- ${f.name} ---\n${f.data}`).join('\n\n') + '\n\n' + text;
    if (screenshots.length) window.cmd0.promptWithImage(prompt, screenshots[0].data);
    else window.cmd0.prompt(prompt);
    clearAttachments();
  }
});

function startBusy() {
  busy = true; hadOutput = false; logParts = []; currentText = ''; currentThinking = ''; isThinking = false;
  showActivity(); input.placeholder = '...';
}

// --- Agent events ---
let hadOutput = false;
window.cmd0.onEvent((ev) => {
  hadOutput = true;
  switch (ev.kind) {
    case 'thinking_start': isThinking = true; currentThinking = ''; break;
    case 'thinking_delta': currentThinking += ev.delta || ''; flushLog(); break;
    case 'thinking_end': if (currentThinking) logParts.push('[thinking] ' + currentThinking); isThinking = false; currentThinking = ''; flushLog(); break;
    case 'text_delta': currentText += ev.delta || ''; flushLog(); break;
    case 'tool_start': if (currentText) { logParts.push(currentText); currentText = ''; } logParts.push(`> ${ev.toolName} ${ev.args || ''}`); flushLog(); break;
    case 'tool_end': { const ic = ev.isError ? 'x' : 'ok'; const prev = ev.result?.slice(0, 200) || ''; logParts.push(`[${ic}] ${ev.toolName}${prev ? '\n' + prev : ''}`); flushLog(); break; }
    case 'turn_start': showActivity('thinking'); break;
    case 'turn_end': if (currentText) { logParts.push(currentText); currentText = ''; } break;
    case 'ext_notify': {
      const prefix = ev.notificationType === 'warning' ? 'Warning: ' : ev.notificationType === 'error' ? 'Error: ' : '';
      logParts.push(prefix + (ev.message || '')); flushLog(); break;
    }
    case 'ext_status': if (ev.text) showActivity(ev.text); break;
  }
});

window.cmd0.onDone(() => {
  if (!busy) return; // ignore duplicate agent:done
  if (currentText) { logParts.push(currentText); currentText = ''; }
  if (logParts.length) flushLog();
  else if (!hadOutput) showBubble('Command completed. Extension commands may need terminal for full output — run: pi /<command>');
  input.placeholder = 'Say something...'; busy = false; logParts = []; currentText = ''; currentThinking = ''; isThinking = false; hadOutput = false; input.focus();
});

window.cmd0.onNeedKey(() => askForKey());
window.cmd0.onReady(async () => {
  waitingForKey = false; input.type = 'text'; input.disabled = false; input.placeholder = 'Say something...'; input.value = '';
  const safe = await window.cmd0.isSafeMode();
  showBubble(safe ? 'Ready (safe mode).' : 'Ready.'); input.focus();
  loadCommands();
});
window.cmd0.onKeyError(() => { input.disabled = false; input.type = 'password'; input.value = ''; showBubble('Invalid key. Try again.'); });

attach.addEventListener('click', async () => { if (busy) return; const f = await window.cmd0.pickFile(); if (f) { addAttachment({ type: 'file', name: f.name, data: f.content }); input.focus(); } });
window.cmd0.onFocus(() => setTimeout(() => input.focus(), 50));

// --- Drag ---
let dragging = false, lx = 0, ly = 0;
bar.addEventListener('mousedown', (e: MouseEvent) => { if ((e.target as HTMLElement).closest('.attach, .input')) return; dragging = true; lx = e.screenX; ly = e.screenY; });
document.addEventListener('mousemove', (e: MouseEvent) => { if (!dragging) return; window.cmd0.move(e.screenX - lx, e.screenY - ly); lx = e.screenX; ly = e.screenY; });
document.addEventListener('mouseup', () => { dragging = false; });

// --- Expose shared state for feature UI scripts injected from main process ---
Object.defineProperty(window, '__cmd0_busy', { get: () => busy });
Object.defineProperty(window, '__cmd0_attachCounter', { get: () => attachCounter, set: (v: number) => { attachCounter = v; } });
(window as any).__cmd0_addAttachment = (att: Attachment) => { addAttachment(att); input.focus(); };

// --- Paste ---
document.addEventListener('paste', async (e: ClipboardEvent) => {
  if (busy || waitingForKey) return;
  const items = e.clipboardData?.items; if (!items) return;
  let handled = false;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault(); handled = true; const blob = item.getAsFile(); if (!blob) continue;
      const reader = new FileReader();
      reader.onload = () => { attachCounter++; addAttachment({ type: 'screenshot', name: `Pasted ${attachCounter}`, data: (reader.result as string).split(',')[1] }); };
      reader.readAsDataURL(blob);
    }
  }
  if (!handled) { const files = await window.cmd0.readClipboardFiles(); if (files.length) { e.preventDefault(); for (const f of files) addAttachment({ type: 'file', name: f.name, data: f.content }); } }
});
