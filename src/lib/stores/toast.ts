// Thin wrapper around svelte-toasts so call sites stay terse and consistent.
import { toasts as raw } from 'svelte-toasts';

type Opts = { duration?: number; title?: string };

const make = (type: 'info' | 'success' | 'warning' | 'error', duration: number = 5000) =>
  (message: string, opts: Opts = {}) =>
    raw.add({
      description: message,
      type,
      duration: opts.duration ?? duration,
      ...(opts.title ? { title: opts.title } : {}),
    });

export const toast = {
  info:    make('info'),
  success: make('success'),
  warn:    make('warning'),
  error:   make('error'),
};
