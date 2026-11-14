import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { tokenStore } from '../../api/client';
import type { Device } from '../../api/types';

// SSH session to the device through the terminal gateway (web/terminal/).
// The gateway signs in with the site's device account; the browser only ever
// sends keystrokes and its own controller session.

type State = 'idle' | 'connecting' | 'open' | 'closed';

export default function TerminalPanel({ siteId, device, connected }: { siteId: string; device: Device; connected: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState(0);

  useEffect(() => {
    if (session === 0 || !host.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: { background: '#111418' },
      convertEol: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();
    setError(null);
    setState('connecting');

    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${window.location.host}/terminal/ws`);
    const note = (text: string) => term.writeln(`\x1b[2m${text}\x1b[0m`);

    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          type: 'open',
          omadacId: tokenStore.omadacId(),
          token: tokenStore.get(),
          siteId,
          mac: device.mac,
          cols: term.cols,
          rows: term.rows,
        }),
      );
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === 'data') {
        setState('open');
        term.write(msg.data);
      } else if (msg.type === 'status') note(msg.text);
      else if (msg.type === 'error') {
        setError(msg.text);
        note(msg.text);
      } else if (msg.type === 'exit') note('Session ended.');
    };
    ws.onerror = () => setError('Could not reach the terminal gateway.');
    ws.onclose = () => setState('closed');

    const input = term.onData((data) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'data', data })));
    const resize = term.onResize(({ cols, rows }) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'resize', cols, rows })));
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(host.current);
    term.focus();

    return () => {
      observer.disconnect();
      input.dispose();
      resize.dispose();
      ws.close();
      term.dispose();
    };
  }, [session, siteId, device.mac]);

  const running = state === 'connecting' || state === 'open';
  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
          SSH terminal
        </Typography>
        {state !== 'idle' && (
          <Chip
            size="small"
            variant="outlined"
            color={state === 'open' ? 'success' : state === 'connecting' ? 'info' : 'default'}
            label={state === 'open' ? 'Connected' : state === 'connecting' ? 'Connecting' : 'Closed'}
          />
        )}
        <Button
          size="small"
          variant={running ? 'outlined' : 'contained'}
          disabled={!connected && !running}
          onClick={() => (running ? setSession(0) : setSession((n) => n + 1))}
        >
          {running ? 'Disconnect' : state === 'closed' ? 'Reconnect' : 'Connect'}
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Signs in with the site’s device account. SSH must be on for the site (Services → SSH).
      </Typography>
      {!connected && state === 'idle' && <Alert severity="info">The device must be connected to open a terminal.</Alert>}
      {error && state === 'closed' && <Alert severity="error">{error}</Alert>}
      <Box
        ref={host}
        aria-label="Device terminal"
        sx={{
          display: session ? 'block' : 'none',
          height: { xs: 360, sm: 460 },
          bgcolor: '#111418',
          borderRadius: 1,
          p: 1,
          overflow: 'hidden',
        }}
      />
    </Stack>
  );
}
