// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest';
import html from '../index.html?raw';
import { Input } from '../src/input';
import { SaveFile } from '../src/storage';
import { UI } from '../src/ui';

const el = (id: string) => document.getElementById(id) as HTMLElement;
beforeEach(() => {
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)![1]!.replace(/<script[\s\S]*?<\/script>/g, '');
});

it('keeps a tap that ends before the next step: pressed once, no longer held', () => {
  const surface = el('game'), input = new Input(surface);
  dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
  expect(input.held).toBe(true);
  dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
  expect([input.takePress(), input.held, input.takePress()]).toEqual([true, false, false]);
  surface.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0 }));
  dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
  expect([input.takePress(), input.held]).toEqual([true, false]);
});

it('rewrites only the device’s own words when the way of playing changes', () => {
  const ui = new UI(new SaveFile(() => { throw new Error('none'); }));
  const icon = el('btn-mute').firstChild, keys = document.querySelector('[data-keys]')!;
  const before = keys.textContent, hint = el('hint').textContent;
  ui.setDevice('touch');
  expect(keys.textContent).not.toBe(before);
  expect(el('hint').textContent).not.toBe(hint);
  // The same icon node: nothing else was rebuilt on the way of an input.
  expect(el('btn-mute').firstChild).toBe(icon);
});
