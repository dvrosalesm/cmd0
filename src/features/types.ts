import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { BrowserWindow } from 'electron';

/** Return type for tool execute functions */
export type ToolResult = { content: { type: 'text'; text: string }[]; details: Record<string, unknown> }
  | { content: { type: 'image'; data: string; mimeType: string }[]; details: Record<string, unknown> };

/** Shared context passed to every feature's createTools */
export interface FeatureContext {
  // Platform
  IS_MAC: boolean;
  IS_LINUX: boolean;

  // Paths
  PROJECT_DIR: string;
  CMD0_DIR: string;
  ANIMA_DIR: string;
  DATA_DIR: string;
  TASKS_FILE: string;
  TSC: string;

  // Mutable state
  getWin(): BrowserWindow | null;
  isAnimaUnlocked(): boolean;

  // Result helpers
  text(t: string): ToolResult;
  image(data: string): ToolResult;

  // Anima helpers
  resolveAnimaPath(filename: string): string;
  readAnimaOrSource(filename: string): string | null;
  listAnimaFiles(): string[];
  doSnapshot(name: string): string;
  compileWithOverlay(): void;

  // Security
  validateFetchUrl(url: string): URL;

  // Tasks
  loadTasks(): { id: string; description: string; type: 'once' | 'recurring'; intervalMinutes?: number; status: string; lastRun?: string; createdAt: string }[];
  addTask(desc: string, type: 'once' | 'recurring', mins?: number): { id: string; description: string };
  completeTask(id: string): void;
  removeTask(id: string): void;

  // Validation
  reqStr(v: unknown, f: string, max: number): string;
  MAX_TASK: number;

  // Screenshot
  captureScreenshot(): Promise<string | null>;
}

/** A feature module that provides tools to the agent */
export interface Feature {
  /** Unique identifier used in config to enable/disable */
  name: string;
  /** Human-readable description */
  description: string;
  /** Create the tool definitions for this feature */
  createTools(ctx: FeatureContext): ToolDefinition[];
  /** Optional cleanup called on app exit */
  cleanup?(): Promise<void>;
  /** Called after the renderer page is loaded — inject UI, register handlers, etc. */
  onReady?(ctx: FeatureContext): void;
}
