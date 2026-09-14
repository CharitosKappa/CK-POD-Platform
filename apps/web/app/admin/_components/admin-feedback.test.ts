import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  ADMIN_FEEDBACK_DISMISS_MS,
  AdminFeedback,
  scheduleAdminFeedbackDismiss,
} from './admin-feedback';

describe('admin action feedback', () => {
  it('renders an accessible manual dismiss control for status and error messages', () => {
    const status = renderToStaticMarkup(
      createElement(AdminFeedback, { tone: 'success', onDismiss: () => undefined }, 'Saved.'),
    );
    const error = renderToStaticMarkup(
      createElement(AdminFeedback, { tone: 'error', onDismiss: () => undefined }, 'Failed.'),
    );

    expect(status).toContain('role="status"');
    expect(status).toContain('aria-label="Dismiss message"');
    expect(status).toContain('>×</button>');
    expect(error).toContain('role="alert"');
    expect(error).toContain('aria-label="Dismiss message"');
  });

  it.each(['success', 'info'] as const)(
    'automatically dismisses %s feedback after four seconds and cancels the timer on cleanup',
    (tone) => {
      let scheduledCallback: (() => void) | undefined;
      const timerId = 73 as unknown as ReturnType<typeof setTimeout>;
      const schedule = vi.fn((callback: () => void, delay: number) => {
        scheduledCallback = callback;
        expect(delay).toBe(4_000);
        return timerId;
      });
      const cancel = vi.fn();
      const onDismiss = vi.fn();

      const cleanup = scheduleAdminFeedbackDismiss(tone, onDismiss, schedule, cancel);

      expect(ADMIN_FEEDBACK_DISMISS_MS).toBe(4_000);
      expect(schedule).toHaveBeenCalledOnce();
      scheduledCallback?.();
      expect(onDismiss).toHaveBeenCalledOnce();
      cleanup();
      expect(cancel).toHaveBeenCalledWith(timerId);
    },
  );

  it('keeps errors visible until manually dismissed', () => {
    const schedule = vi.fn();
    const cancel = vi.fn();

    const cleanup = scheduleAdminFeedbackDismiss('error', vi.fn(), schedule, cancel);

    expect(schedule).not.toHaveBeenCalled();
    cleanup();
    expect(cancel).not.toHaveBeenCalled();
  });
});
