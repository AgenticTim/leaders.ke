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
  // 0 disables svelte-toasts' auto-dismiss timer: an error stays until the
  // user closes it, since a 5s auto-dismiss risks it disappearing unread.
  error:   make('error', 0),
};
