import { app } from 'electron';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { Type } from '@sinclair/typebox';
import type { Feature, FeatureContext } from './types.js';

const feature: Feature = {
  name: 'anima',
  description: 'Self-modification tools — list, read, write source files and reload',

  createTools(ctx: FeatureContext) {
    return [
      {
        name: 'anima_list', label: 'List Files',
        description: 'List editable source files. Files marked [customized] have user overrides in ~/.cmd0/anima.',
        promptSnippet: 'anima_list — list editable source files ([customized] = has override in anima)',
        parameters: Type.Object({}),
        async execute() {
          return ctx.text(ctx.listAnimaFiles().join('\n'));
        }
      },
      {
        name: 'anima_read', label: 'Read File',
        description: 'Read a source file. Returns the anima override if it exists, otherwise the upstream project source.',
        promptSnippet: 'anima_read — read a source file (anima override or upstream source)',
        parameters: Type.Object({ filename: Type.String() }),
        async execute(_id: string, p: { filename: string }) {
          try {
            const content = ctx.readAnimaOrSource(p.filename);
            if (content === null) return ctx.text('Not found: ' + p.filename);
            return ctx.text(content);
          } catch (e: any) {
            return ctx.text(e.message);
          }
        }
      },
      {
        name: 'anima_write', label: 'Write File',
        description: 'Write a customization to ~/.cmd0/anima. Call anima_reload after. Only available during /0.',
        promptSnippet: 'anima_write — write a file to anima overlay, call anima_reload after (requires /0)',
        parameters: Type.Object({ filename: Type.String(), content: Type.String() }),
        async execute(_id: string, p: { filename: string; content: string }) {
          if (!ctx.isAnimaUnlocked()) return ctx.text('anima_write is only available during /0 self-modification.');
          try {
            const fp = ctx.resolveAnimaPath(p.filename);
            const parentDir = dirname(fp);
            if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
            writeFileSync(fp, p.content, 'utf-8');
            return ctx.text(`Wrote ${p.filename}`);
          } catch (e: any) {
            return ctx.text(e.message);
          }
        }
      },
      {
        name: 'anima_reload', label: 'Reload',
        description: 'Snapshots state, overlays anima onto source, compiles, restores source, restarts. Only available during /0.',
        promptSnippet: 'anima_reload — snapshot, overlay-compile, and restart (requires /0)',
        parameters: Type.Object({}),
        async execute() {
          if (!ctx.isAnimaUnlocked()) return ctx.text('anima_reload is only available during /0 self-modification.');
          try {
            ctx.doSnapshot(`auto-${Date.now()}`);
            ctx.compileWithOverlay();
            setTimeout(() => { app.relaunch(); app.exit(0); }, 500);
            return ctx.text('Compiled with overlay. Restarting...');
          } catch (e: any) {
            return ctx.text(`Build failed: ${e.stdout?.toString() || e.message}`);
          }
        }
      },
    ];
  }
};

export default feature;
