import { Type } from '@sinclair/typebox';
import type { Feature, FeatureContext } from './types.js';

const feature: Feature = {
  name: 'tasks',
  description: 'Background task management — list, add, complete, remove tasks',

  createTools(ctx: FeatureContext) {
    return [
      {
        name: 'task_list', label: 'Tasks',
        description: 'List tasks.',
        promptSnippet: 'task_list — list all tasks and their status',
        parameters: Type.Object({}),
        async execute() {
          const t = ctx.loadTasks();
          if (!t.length) return ctx.text('No tasks.');
          const lines = t.map(x =>
            `[${x.status}] ${x.id}: ${x.description}`
            + (x.type === 'recurring' ? ` (${x.intervalMinutes}m)` : '')
            + (x.lastRun ? ` last:${x.lastRun}` : '')
          );
          return ctx.text(lines.join('\n'));
        }
      },
      {
        name: 'task_add', label: 'Add Task',
        description: 'Add task.',
        promptSnippet: 'task_add — add a one-time or recurring task',
        parameters: Type.Object({
          description: Type.String(),
          type: Type.Union([Type.Literal('once'), Type.Literal('recurring')]),
          intervalMinutes: Type.Optional(Type.Number())
        }),
        async execute(_id: string, p: { description: string; type: 'once' | 'recurring'; intervalMinutes?: number }) {
          const t = ctx.addTask(ctx.reqStr(p.description, 'desc', ctx.MAX_TASK), p.type, p.intervalMinutes);
          return ctx.text(`Added ${t.id}: ${t.description}`);
        }
      },
      {
        name: 'task_complete', label: 'Complete',
        description: 'Complete task.',
        promptSnippet: 'task_complete — mark a task as done',
        parameters: Type.Object({ id: Type.String() }),
        async execute(_id: string, p: { id: string }) {
          ctx.completeTask(p.id);
          return ctx.text(`Done: ${p.id}`);
        }
      },
      {
        name: 'task_remove', label: 'Remove',
        description: 'Remove task.',
        promptSnippet: 'task_remove — remove a task by id',
        parameters: Type.Object({ id: Type.String() }),
        async execute(_id: string, p: { id: string }) {
          ctx.removeTask(p.id);
          return ctx.text(`Removed: ${p.id}`);
        }
      },
    ];
  }
};

export default feature;
