import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, test } from 'vitest';
import { Button } from './index';

describe('button variant and size classes', () => {
  test.each(['default', 'outline', 'ghost', 'link'] as const)(
    'keeps %s independent of default size',
    (variant) => {
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
      const host = document.createElement('div');
      const root = createRoot(host);
      act(() => root.render(<Button variant={variant}>Action</Button>));
      const button = host.querySelector('button')!;
      expect(button.classList.contains(`portal-button--${variant}`)).toBe(true);
      expect(button.classList.contains('portal-button--size-default')).toBe(true);
      expect(button.classList.contains('portal-button--default')).toBe(variant === 'default');
      expect(button.type).toBe('button');
      act(() => root.unmount());
    }
  );
});
