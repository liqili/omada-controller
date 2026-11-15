// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { theme } from '../theme';
import type { Device } from '../api/types';

// xterm needs a real canvas; the panel only uses this much of it.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 100;
    rows = 30;
    loadAddon() {}
    open() {}
    write() {}
    writeln() {}
    focus() {}
    dispose() {}
    onData() {
      return { dispose() {} };
    }
    onResize() {
      return { dispose() {} };
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('../api/client', () => ({ tokenStore: { omadacId: () => 'omadac0001', get: () => 'tok' } }));

const sent: unknown[] = [];
class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onerror?: () => void;
  onclose?: () => void;
  constructor() {
    queueMicrotask(() => this.onopen?.());
  }
  send(m: string) {
    sent.push(JSON.parse(m));
  }
  close() {}
}

import TerminalPanel from '../pages/device/TerminalPanel';

const f65: Device = { mac: '20-36-26-D5-A7-20', type: 'ap', model: 'EAP-F65', status: 14, statusCategory: 1 };
const mount = () =>
  render(
    <ThemeProvider theme={theme}>
      <TerminalPanel siteId="site00001" device={f65} connected />
    </ThemeProvider>,
  );

beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('terminal startup command', () => {
  it('sends the command in the open message and remembers it for the model', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('Startup command (optional)'), { target: { value: ' sh ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ type: 'open', mac: f65.mac, command: 'sh' });
    expect(localStorage.getItem('terminal.command.EAP-F65')).toBe('sh');
  });

  it('opens a plain shell without one, and prefills a remembered command', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).not.toHaveProperty('command');

    localStorage.setItem('terminal.command.EAP-F65', 'sh');
    mount();
    expect((screen.getAllByLabelText('Startup command (optional)')[1] as HTMLInputElement).value).toBe('sh');
  });
});
