import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { Feature, FeatureContext } from './types.js';

import anima from './anima.js';
import web from './web.js';
import browser from './browser.js';
import notify from './notify.js';
import screenshot from './screenshot.js';
import tasks from './tasks.js';

/** All available features in load order */
const ALL_FEATURES: Feature[] = [anima, web, browser, notify, screenshot, tasks];

/** Get list of all feature names (for config defaults, listing, etc.) */
export function getFeatureNames(): string[] {
  return ALL_FEATURES.map(f => f.name);
}

/** Get feature descriptions keyed by name */
export function getFeatureDescriptions(): Record<string, string> {
  return Object.fromEntries(ALL_FEATURES.map(f => [f.name, f.description]));
}

/**
 * Load enabled features and return their combined tools + a cleanup function.
 *
 * @param ctx     Shared context passed to each feature's createTools
 * @param enabled Map of feature name -> enabled. Missing keys default to true.
 */
export function loadFeatures(
  ctx: FeatureContext,
  enabled: Record<string, boolean> = {}
): { tools: ToolDefinition[]; onReady: () => void; cleanup: () => Promise<void> } {
  const active: Feature[] = [];

  for (const feature of ALL_FEATURES) {
    const isEnabled = enabled[feature.name] ?? true; // default: on
    if (isEnabled) {
      active.push(feature);
    } else {
      console.log(`[cmd0] Feature disabled: ${feature.name}`);
    }
  }

  const tools = active.flatMap(f => f.createTools(ctx));
  const readyFns = active.filter(f => f.onReady).map(f => f.onReady!);
  const cleanupFns = active.filter(f => f.cleanup).map(f => f.cleanup!);

  return {
    tools,
    onReady() {
      for (const fn of readyFns) {
        try { fn(ctx); } catch (e) { console.error('[cmd0] Feature onReady error:', e); }
      }
    },
    async cleanup() {
      for (const fn of cleanupFns) {
        try { await fn(); } catch (e) { console.error('[cmd0] Feature cleanup error:', e); }
      }
    }
  };
}

export type { Feature, FeatureContext } from './types.js';
