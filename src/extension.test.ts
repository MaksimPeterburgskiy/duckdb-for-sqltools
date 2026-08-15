import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const sendRequest = vi.fn(async (_method: string, _params?: unknown) => undefined);
  const registerPlugin = vi.fn((plugin: any) => {
    void plugin.register({
      resourcesMap: () => new Map(),
      client: { sendRequest },
    });
  });
  const getExtension = vi.fn((extensionId: string) => {
    if (extensionId === 'mtxr.sqltools') {
      return {
        activate: vi.fn(async () => undefined),
        exports: { registerPlugin },
      };
    }
    return undefined;
  });
  return { sendRequest, registerPlugin, getExtension };
});

vi.mock('vscode', () => ({
  commands: { executeCommand: vi.fn() },
  extensions: { getExtension: mocks.getExtension },
  window: { showErrorMessage: vi.fn() },
  workspace: { workspaceFolders: undefined },
}));

import { activate } from './extension';

function activateExtension() {
  return activate({
    asAbsolutePath: (relativePath: string) => `/extension/${relativePath}`,
  } as never);
}

describe('extension API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never resolves or returns a token for credentialless MotherDuck connections', async () => {
    const api = await activateExtension();

    const resolved = await api.resolveConnection?.({
      connInfo: { name: 'DuckDB', database: 'md:' },
    } as never);

    expect(resolved).toMatchObject({ database: 'md:', askForPassword: true });
    expect(resolved).not.toHaveProperty('password');
  });

  it('preserves ask-on-connect MotherDuck connections', async () => {
    const api = await activateExtension();

    const resolved = await api.resolveConnection?.({
      connInfo: { name: 'Prod', database: 'md:analytics', askForPassword: true },
    } as never);

    expect(resolved).toMatchObject({
      database: 'md:analytics',
      askForPassword: true,
    });
    expect(resolved).not.toHaveProperty('password');
  });

  it('leaves explicitly saved plaintext tokens untouched', async () => {
    const api = await activateExtension();

    const resolved = await api.resolveConnection?.({
      connInfo: {
        name: 'Prod',
        database: 'md:analytics',
        askForPassword: false,
        password: 'user-supplied',
      },
    } as never);

    expect(resolved).toMatchObject({
      password: 'user-supplied',
      askForPassword: false,
    });
  });

  it('does not prompt for non-MotherDuck connections', async () => {
    const api = await activateExtension();

    const resolved = await api.resolveConnection?.({
      connInfo: { name: 'Local', database: ':memory:' },
    } as never);

    expect(resolved).toMatchObject({ database: ':memory:' });
    expect(resolved).not.toHaveProperty('askForPassword');
  });
});
