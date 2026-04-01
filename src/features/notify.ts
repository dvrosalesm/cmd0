import { promisify } from 'util';
import { execFile } from 'child_process';
import { Type } from '@sinclair/typebox';
import type { Feature, FeatureContext } from './types.js';

const execFileAsync = promisify(execFile);

const feature: Feature = {
  name: 'notify',
  description: 'Desktop notifications',

  createTools(ctx: FeatureContext) {
    return [
      {
        name: 'notify', label: 'Notify',
        description: 'Send a desktop notification.',
        promptSnippet: 'notify — send a desktop notification',
        parameters: Type.Object({ title: Type.String(), message: Type.String() }),
        async execute(_id: string, p: { title: string; message: string }) {
          try {
            if (ctx.IS_MAC) {
              await execFileAsync('osascript', [
                '-e', `display notification ${JSON.stringify(p.message)} with title ${JSON.stringify(p.title)}`
              ]);
            } else {
              await execFileAsync('notify-send', [p.title, p.message]);
            }
            return ctx.text('Sent.');
          } catch (e: any) {
            return ctx.text(`Failed: ${e.message}`);
          }
        }
      },
    ];
  }
};

export default feature;
