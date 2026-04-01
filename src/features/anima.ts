import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { Type } from '@sinclair/typebox';
import type { Feature, FeatureContext } from './types.js';

const feature: Feature = {
  name: 'anima',
  description: 'Self-modification tools — list, read, write source files and reload',

  createTools(ctx: FeatureContext) {
    return [
      {
        name: 'anima_list', label: 'List Files',
        description: 'List editable source files.',
        promptSnippet: 'anima_list — list editable source files in ~/.cmd0/anima',
        parameters: Type.Object({}),
        async execute() {
          return ctx.text(ctx.listAnimaFiles().join('\n'));
        }
      },
      {
        name: 'anima_read', label: 'Read File',
        description: 'Read a source file from ~/.cmd0/anima.',
        promptSnippet: 'anima_read — read a source file by filename',
        parameters: Type.Object({ filename: Type.String() }),
        async execute(_id: string, p: { filename: string }) {
          try {
            const fp = ctx.resolveAnimaPath(p.filename);
            if (!existsSync(fp)) return ctx.text('Not found: ' + p.filename);
            return ctx.text(readFileSync(fp, 'utf-8'));
          } catch (e: any) {
            return ctx.text(e.message);
          }
        }
      },
      {
        name: 'anima_write', label: 'Write File',
        description: 'Write a source file. Call anima_reload after. Only available during /0 self-modification.',
        promptSnippet: 'anima_write — write a source file, call anima_reload after (requires /0)',
        parameters: Type.Object({ filename: Type.String(), content: Type.String() }),
        async execute(_id: string, p: { filename: string; content: string }) {
          if (!ctx.isAnimaUnlocked()) return ctx.text('anima_write is only available during /0 self-modification.');
          try {
            writeFileSync(ctx.resolveAnimaPath(p.filename), p.content, 'utf-8');
            ctx.dirtyAnimaFiles.add(p.filename);
            return ctx.text(`Wrote ${p.filename}`);
          } catch (e: any) {
            return ctx.text(e.message);
          }
        }
      },
      {
        name: 'anima_reload', label: 'Reload',
        description: 'Auto-snapshots, copies only changed files to project, recompiles, restarts. Only available during /0 self-modification.',
        promptSnippet: 'anima_reload — snapshot, recompile, and restart (requires /0)',
        parameters: Type.Object({}),
        async execute() {
          if (!ctx.isAnimaUnlocked()) return ctx.text('anima_reload is only available during /0 self-modification.');
          try {
            ctx.doSnapshot(`auto-${Date.now()}`);
            ctx.syncDirtyToProject();
            execSync(ctx.TSC, { cwd: ctx.PROJECT_DIR, timeout: 30000 });
            setTimeout(() => { app.relaunch(); app.exit(0); }, 500);
            return ctx.text(`Recompiled (${ctx.dirtyAnimaFiles.size} files). Restarting...`);
          } catch (e: any) {
            return ctx.text(`Build failed: ${e.stdout?.toString() || e.message}`);
          }
        }
      },
    ];
  }
};

export default feature;
