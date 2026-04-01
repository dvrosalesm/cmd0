interface AgentEvent {
  kind: string;
  delta?: string;
  toolName?: string;
  args?: string;
  result?: string;
  isError?: boolean;
  message?: string;
  notificationType?: string;
  key?: string;
  text?: string;
}

interface Window {
  cmd0: {
    onFocus: (cb: () => void) => void;
    onNeedKey: (cb: () => void) => void;
    onReady: (cb: () => void) => void;
    onKeyError: (cb: (msg: string) => void) => void;
    validateKey: (key: string) => Promise<{ ok: boolean; error?: string; provider?: string }>;
    setKey: (key: string, model?: string) => void;
    prompt: (text: string) => void;
    promptAnima: (text: string) => void;
    promptWithImage: (text: string, imageBase64: string) => void;
    onEvent: (cb: (event: AgentEvent) => void) => void;
    onDone: (cb: () => void) => void;
    screenshot: () => Promise<string | null>;
    cancel: () => void;
    steer: (text: string) => void;
    relaunchSafe: () => void;
    isSafeMode: () => Promise<boolean>;
    move: (dx: number, dy: number) => void;
    pickFile: () => Promise<{ name: string; content: string } | null>;
    readClipboardFiles: () => Promise<{ name: string; content: string }[]>;
    snapshot: (name: string) => Promise<string>;
    restoreSnapshot: (name: string) => Promise<string>;
    listSnapshots: () => Promise<string[]>;
    getCommands: () => Promise<{ name: string; description: string; source: string }[]>;
    cmdStart: (command: string) => void;
    cmdInput: (text: string) => void;
    cmdKill: () => void;
    onCmdOutput: (cb: (data: string) => void) => void;
    onCmdExit: (cb: (code: number) => void) => void;
  };
}
