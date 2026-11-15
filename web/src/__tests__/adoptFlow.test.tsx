// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { theme } from '../theme';
import { useAdoptFlow } from '../components/AdoptFlow';
import { OmadaApiError } from '../api/client';
import type { AdoptTarget, DeviceAccount } from '../api/domains/device';

type Adopt = (d: AdoptTarget[], a?: DeviceAccount) => Promise<unknown>;

function Harness({ devices, adopt, onError }: { devices: AdoptTarget[]; adopt: Adopt; onError?: (e: unknown) => void }) {
  const flow = useAdoptFlow(adopt, onError);
  return (
    <ThemeProvider theme={theme}>
      <button onClick={() => flow.start(devices)}>go</button>
      {flow.dialog}
    </ThemeProvider>
  );
}

const enterLogin = (username: string, password: string) => {
  fireEvent.change(screen.getByLabelText(/Username/), { target: { value: username } });
  fireEvent.change(screen.getByLabelText(/Password/), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Adopt' }));
};

// What the user's NAS controller answered for a device with another login (2026-11-15).
const loginRefused = () =>
  new OmadaApiError('Failed to adopt the device because the username or password is incorrect.', -39003);

describe('adopt flow', () => {
  it('adopts a factory-fresh device straight away', async () => {
    const adopt = vi.fn<Adopt>().mockResolvedValue(undefined);
    render(<Harness devices={[{ mac: 'M1', status: 20 }]} adopt={adopt} />);
    await act(async () => fireEvent.click(screen.getByText('go')));
    expect(adopt).toHaveBeenCalledWith([{ mac: 'M1', status: 20 }], undefined);
    expect(screen.queryByText('Device login needed')).toBeNull();
  });

  it('asks for the login of a device managed by another controller, then adopts with it', async () => {
    const adopt = vi.fn<Adopt>().mockResolvedValue(undefined);
    render(<Harness devices={[{ mac: 'M2', status: 26 }]} adopt={adopt} />);
    fireEvent.click(screen.getByText('go'));
    expect(adopt).not.toHaveBeenCalled();
    await act(async () => enterLogin('admin', 'pw'));
    expect(adopt).toHaveBeenCalledWith([{ mac: 'M2', status: 26 }], { username: 'admin', password: 'pw' });
    await waitFor(() => expect(screen.queryByText('Device login needed')).toBeNull());
  });

  it('on -39003 opens the login dialog with the message, and retries until the login is right', async () => {
    const adopt = vi
      .fn<Adopt>()
      .mockRejectedValueOnce(loginRefused()) // first try, no login
      .mockRejectedValueOnce(loginRefused()) // wrong login
      .mockResolvedValueOnce(undefined); // right login
    const onError = vi.fn();
    render(<Harness devices={[{ mac: 'B0-19-21-2D-A5-EC', status: 20 }]} adopt={adopt} onError={onError} />);

    await act(async () => fireEvent.click(screen.getByText('go')));
    expect(await screen.findByText('Device login needed')).toBeTruthy();
    expect(screen.getByText(/username or password is incorrect/)).toBeTruthy();

    await act(async () => enterLogin('admin', 'wrong'));
    expect(adopt).toHaveBeenLastCalledWith([{ mac: 'B0-19-21-2D-A5-EC', status: 20 }], { username: 'admin', password: 'wrong' });
    expect(screen.getByText('Device login needed')).toBeTruthy(); // still open, password cleared
    expect((screen.getByLabelText(/Password/) as HTMLInputElement).value).toBe('');

    await act(async () => enterLogin('admin', 'right'));
    expect(adopt).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(screen.queryByText('Device login needed')).toBeNull());
    expect(onError).not.toHaveBeenCalled();
  });

  it('passes other errors to onError without asking for a login', async () => {
    const boom = new OmadaApiError('Site not found', -1);
    const onError = vi.fn();
    render(<Harness devices={[{ mac: 'M1', status: 20 }]} adopt={vi.fn<Adopt>().mockRejectedValue(boom)} onError={onError} />);
    await act(async () => fireEvent.click(screen.getByText('go')));
    expect(onError).toHaveBeenCalledWith(boom);
    expect(screen.queryByText('Device login needed')).toBeNull();
  });
});
