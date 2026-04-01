import { Type } from '@sinclair/typebox';
import type { Feature, FeatureContext } from './types.js';

const feature: Feature = {
  name: 'web',
  description: 'Web search (DuckDuckGo) and URL fetch',

  createTools(ctx: FeatureContext) {
    return [
      {
        name: 'web_search', label: 'Search',
        description: 'Search DuckDuckGo.',
        promptSnippet: 'web_search — search the web via DuckDuckGo',
        parameters: Type.Object({ query: Type.String() }),
        async execute(_id: string, p: { query: string }, signal?: AbortSignal) {
          try {
            const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(p.query)}`, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cmd0/1.0)' },
              signal
            });
            const h = await r.text();
            const res: string[] = [];
            const rx = /<a rel="nofollow" class="result__a" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
            let m; let i = 0;
            while ((m = rx.exec(h)) && i < 8) {
              const t = m[2].replace(/<[^>]+>/g, '').trim();
              const s = m[3].replace(/<[^>]+>/g, '').trim();
              if (t) { res.push(`${t}\n${m[1]}\n${s}`); i++; }
            }
            return ctx.text(res.length ? res.join('\n\n') : 'No results.');
          } catch (e: any) {
            return ctx.text(`Search failed: ${e.message}`);
          }
        }
      },
      {
        name: 'web_fetch', label: 'Fetch',
        description: 'Fetch URL content.',
        promptSnippet: 'web_fetch — fetch and extract text from a URL',
        parameters: Type.Object({ url: Type.String() }),
        async execute(_id: string, p: { url: string }, signal?: AbortSignal) {
          try {
            const u = ctx.validateFetchUrl(p.url);
            const r = await fetch(u, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cmd0/1.0)' },
              signal: signal ?? AbortSignal.timeout(15000)
            });
            const h = await r.text();
            const cleaned = h
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 8000);
            return ctx.text(cleaned);
          } catch (e: any) {
            return ctx.text(`Fetch failed: ${e.message}`);
          }
        }
      },
    ];
  }
};

export default feature;
