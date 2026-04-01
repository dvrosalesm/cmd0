import { Type } from '@sinclair/typebox';
import type { Feature, FeatureContext } from './types.js';

const feature: Feature = {
  name: 'screenshot',
  description: 'Screen capture tool and UI button',

  onReady(ctx: FeatureContext) {
    const win = ctx.getWin();
    if (!win) return;
    win.webContents.executeJavaScript(`(() => {
      const bar = document.getElementById('bar');
      const input = document.getElementById('input');
      const btn = document.createElement('button');
      btn.className = 'attach';
      btn.title = 'Take screenshot';
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
      btn.addEventListener('click', async () => {
        if (window.__cmd0_busy) return;
        const b = await window.cmd0.screenshot();
        if (b && window.__cmd0_addAttachment) {
          window.__cmd0_addAttachment({ type: 'screenshot', name: 'Screenshot ' + (++window.__cmd0_attachCounter), data: b });
        }
      });
      bar.insertBefore(btn, input);
    })()`);
  },

  createTools(ctx: FeatureContext) {
    return [
      {
        name: 'screenshot', label: 'Screenshot',
        description: 'Capture a region of the screen.',
        promptSnippet: 'screenshot — capture a region of the screen',
        parameters: Type.Object({}),
        async execute() {
          const b = await ctx.captureScreenshot();
          if (b) return ctx.image(b);
          return ctx.text('Failed.');
        }
      },
    ];
  }
};

export default feature;
