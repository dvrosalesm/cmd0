// renderer — loaded as a plain <script>, not a module

const input = document.getElementById('input') as HTMLInputElement;
const attach = document.getElementById('attach')!;
const screenshotBtn = document.getElementById('screenshot')!;
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

// --- Commands ---
const COMMANDS = [
  { name: '/0', hint: '/0 <instruction> — modify own source code' },
  { name: '/cancel', hint: '/cancel — stop the agent' },
  { name: '/tasks', hint: '/tasks — list, add, or remove tasks' },
  { name: '/safe', hint: '/safe — restart in safe mode' },
  { name: '/snap', hint: '/snap <name> — save a snapshot' },
  { name: '/restore', hint: '/restore <name> — restore a snapshot' },
  { name: '/snapshots', hint: '/snapshots — list all snapshots' },
];

function getMatchedCommand(text: string): typeof COMMANDS[0] | null {
  for (const cmd of COMMANDS) { if (text === cmd.name || text.startsWith(cmd.name + ' ')) return cmd; }
  return null;
}
function updateCommandHighlight() { bar.classList.toggle('command', !!getMatchedCommand(input.value)); }
input.addEventListener('input', updateCommandHighlight);

// --- Tab autocomplete ---
let acIdx = -1;
let acMatches: typeof COMMANDS = [];
function getAcMatches(t: string) { return t.startsWith('/') ? COMMANDS.filter(c => c.name.startsWith(t) && c.name !== t) : []; }

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
  if (e.key === 'Escape') { input.blur(); return; }
  if (e.key === 'Tab') {
    const t = input.value; if (!t.startsWith('/')) return; e.preventDefault();
    if (acIdx === -1) { acMatches = getAcMatches(t); if (!acMatches.length) return; acIdx = 0; }
    else acIdx = (acIdx + 1) % acMatches.length;
    input.value = acMatches[acIdx].name + ' '; input.placeholder = acMatches[acIdx].hint;
    updateCommandHighlight(); return;
  }
  acIdx = -1; acMatches = [];
  if (e.key !== 'Enter') return;
  if (!input.value.trim() && !waitingForModel) return;

  const text = input.value.trim(); input.value = ''; bar.classList.remove('command');

  if (waitingForKey) { if (!text) return; pendingKey = text; askForModel(text.startsWith('fw_') ? 'fireworks' : 'openrouter'); return; }
  if (waitingForModel) { showBubble('Connecting...'); input.disabled = true; waitingForModel = false; window.cmd0.setKey(pendingKey, text || undefined); return; }

  if (text === '/safe') { showBubble('Restarting in safe mode...'); window.cmd0.relaunchSafe(); return; }
  if (text === '/cancel') { if (busy) { window.cmd0.cancel(); showBubble('Cancelled.'); input.placeholder = 'Say something...'; busy = false; logParts = []; currentText = ''; currentThinking = ''; isThinking = false; } return; }
  if (text === '/snapshots') { window.cmd0.listSnapshots().then(l => showBubble(l.length ? 'Snapshots:\n' + l.map(s => '  - ' + s).join('\n') : 'No snapshots.')); return; }
  if (text.startsWith('/snap ')) { const n = text.slice(6).trim(); if (!n) { showBubble('Usage: /snap <name>'); return; } window.cmd0.snapshot(n).then(m => showBubble(m)); return; }
  if (text.startsWith('/restore ')) { const n = text.slice(9).trim(); if (!n) { showBubble('Usage: /restore <name>'); return; } window.cmd0.restoreSnapshot(n).then(m => showBubble(m)); return; }

  if (text === '/tasks' || text.startsWith('/tasks ')) {
    const arg = text.slice(6).trim(); busy = true; showActivity(); input.placeholder = '...';
    window.cmd0.prompt(arg ? 'Manage tasks: ' + arg + '\n\nUse task_add, task_remove, task_list, task_complete.' : 'List all tasks using task_list.');
    return;
  }

  if (text.startsWith('/0')) {
    const instr = text.slice(2).trim();
    if (!instr) { showBubble('Usage: /0 <what to change>'); return; }
    busy = true; logParts = []; currentText = ''; currentThinking = ''; isThinking = false; showActivity(); input.placeholder = '...';
    window.cmd0.prompt([
      'You are modifying your own source code. Files live in ~/.cmd0/anima.',
      'Use anima_list, anima_read, anima_write. After changes call anima_reload.',
      'If you need npm packages, use bash to run npm install in the project dir.',
      'IMPORTANT: Do NOT remove existing features or simplify working code. Only make the requested change.',
      '', 'The user wants: ' + instr,
    ].join('\n'));
    return;
  }

  if (busy) {
    window.cmd0.steer(text);
    logParts.push(`[you] ${text}`); flushLog();
  } else {
    busy = true; logParts = []; currentText = ''; currentThinking = ''; isThinking = false; showActivity(); input.placeholder = '...';
    const screenshots = attachments.filter(a => a.type === 'screenshot');
    const files = attachments.filter(a => a.type === 'file');
    let prompt = text;
    if (files.length) prompt = files.map(f => `--- ${f.name} ---\n${f.data}`).join('\n\n') + '\n\n' + text;
    if (screenshots.length) window.cmd0.promptWithImage(prompt, screenshots[0].data);
    else window.cmd0.prompt(prompt);
    clearAttachments();
  }
});

// --- Agent events ---
window.cmd0.onEvent((ev) => {
  switch (ev.kind) {
    case 'thinking_start': isThinking = true; currentThinking = ''; break;
    case 'thinking_delta': currentThinking += ev.delta || ''; flushLog(); break;
    case 'thinking_end': if (currentThinking) logParts.push('[thinking] ' + currentThinking); isThinking = false; currentThinking = ''; flushLog(); break;
    case 'text_delta': currentText += ev.delta || ''; flushLog(); break;
    case 'tool_start': if (currentText) { logParts.push(currentText); currentText = ''; } logParts.push(`> ${ev.toolName} ${ev.args || ''}`); flushLog(); break;
    case 'tool_end': { const ic = ev.isError ? 'x' : 'ok'; const prev = ev.result?.slice(0, 200) || ''; logParts.push(`[${ic}] ${ev.toolName}${prev ? '\n' + prev : ''}`); flushLog(); break; }
    case 'turn_start': showActivity('thinking'); break;
    case 'turn_end': if (currentText) { logParts.push(currentText); currentText = ''; } break;
  }
});

window.cmd0.onDone(() => {
  if (currentText) { logParts.push(currentText); currentText = ''; }
  if (logParts.length) flushLog();
  input.placeholder = 'Say something...'; busy = false; logParts = []; currentText = ''; currentThinking = ''; isThinking = false; input.focus();
});

window.cmd0.onNeedKey(() => askForKey());
window.cmd0.onReady(async () => {
  waitingForKey = false; input.type = 'text'; input.disabled = false; input.placeholder = 'Say something...'; input.value = '';
  const safe = await window.cmd0.isSafeMode();
  showBubble(safe ? 'Ready (safe mode).' : 'Ready.'); input.focus();
});
window.cmd0.onKeyError(() => { input.disabled = false; input.type = 'password'; input.value = ''; showBubble('Invalid key. Try again.'); });

attach.addEventListener('click', async () => { if (busy) return; const f = await window.cmd0.pickFile(); if (f) { addAttachment({ type: 'file', name: f.name, data: f.content }); input.focus(); } });
screenshotBtn.addEventListener('click', async () => { if (busy) return; const b = await window.cmd0.screenshot(); if (b) { attachCounter++; addAttachment({ type: 'screenshot', name: `Screenshot ${attachCounter}`, data: b }); input.focus(); } });
window.cmd0.onFocus(() => setTimeout(() => input.focus(), 50));

// --- Drag ---
let dragging = false, lx = 0, ly = 0;
bar.addEventListener('mousedown', (e: MouseEvent) => { if ((e.target as HTMLElement).closest('.attach, .input')) return; dragging = true; lx = e.screenX; ly = e.screenY; });
document.addEventListener('mousemove', (e: MouseEvent) => { if (!dragging) return; window.cmd0.move(e.screenX - lx, e.screenY - ly); lx = e.screenX; ly = e.screenY; });
document.addEventListener('mouseup', () => { dragging = false; });

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
