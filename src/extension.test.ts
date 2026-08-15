import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SET_MOTHERDUCK_TOKEN_REQUEST } from './motherduck-credentials';

const mocks = vi.hoisted(() => {
  const getSession = vi.fn();
  const sendRequest = vi.fn(async (_method: string, _params?: unknown) => undefined);
  const savedConnections: { value: unknown[] } = { value: [] };
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
  return { getSession, sendRequest, savedConnections, registerPlugin, getExtension };
});

vi.mock('vscode', () => ({
  authentication: { getSession: mocks.getSession },
  commands: { executeCommand: vi.fn() },
  extensions: { getExtension: mocks.getExtension },
  window: { showErrorMessage: vi.fn() },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({
      get: (key: string) => (key === 'connections' ? mocks.savedConnections.value : undefined),
    }),
  },
}));

import { activate } from './extension';

function activateExtension() {
  return activate({
    asAbsolutePath: (relativePath: string) => `/extension/${relativePath}`,
  } as never);
}

function tokenPushes() {
  return mocks.sendRequest.mock.calls.filter(([method]) => method === SET_MOTHERDUCK_TOKEN_REQUEST);
}

describe('extension API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.savedConnections.value = [];
  });

  it('does not resolve credentials for MotherDuck connections that are not saved in SQLTools', async () => {
    const api = await activateExtension();

    const resolved = await api.resolveConnection?.({
      connInfo: { name: 'DuckDB', database: 'md:' },
    } as never);

    expect(resolved).toMatchObject({ database: 'md:' });
    expect(resolved).not.toHaveProperty('password');
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(tokenPushes()).toHaveLength(0);
  });

  it('never returns the token through resolveConnection for saved connections', async () => {
    mocks.savedConnections.value = [{ name: 'Prod', driver: 'DuckDB', database: 'md:analytics' }];
    mocks.getSession.mockResolvedValueOnce({ accessToken: 'md_live_secret' });
    const api = await activateExtension();

    const resolved = await api.resolveConnection?.({
      connInfo: { name: 'Prod', database: 'md:analytics' },
    } as never);

    expect(resolved).not.toHaveProperty('password');
    expect(mocks.getSession).toHaveBeenCalledWith(
      'sqltools-driver-credentials',
      ['Prod', 'MotherDuck token'],
      { silent: true },
    );
    expect(tokenPushes()).toEqual([[
      SET_MOTHERDUCK_TOKEN_REQUEST,
      { key: JSON.stringify(['Prod', 'md:analytics']), token: 'md_live_secret' },
    ]]);
  });

  it('falls back to createIfNone when no silent session exists, without leaking the token', async () => {
    mocks.savedConnections.value = [{ name: 'Prod', driver: 'DuckDB', database: 'md:analytics' }];
    mocks.getSession
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ accessToken: 'md_live_new' });
    const api = await activateExtension();

    const resolved = await api.resolveConnection?.({
      connInfo: { name: 'Prod', database: 'md:analytics' },
    } as never);

    expect(resolved).not.toHaveProperty('password');
    expect(mocks.getSession).toHaveBeenNthCalledWith(
      2,
      'sqltools-driver-credentials',
      ['Prod', 'MotherDuck token'],
      { createIfNone: true },
    );
    expect(tokenPushes()).toEqual([[
      SET_MOTHERDUCK_TOKEN_REQUEST,
      { key: JSON.stringify(['Prod', 'md:analytics']), token: 'md_live_new' },
    ]]);
  });

  it('requires the saved connection to match name and database', async () => {
    mocks.savedConnections.value = [{ name: 'Prod', driver: 'DuckDB', database: 'md:analytics' }];
    const api = await activateExtension();

    const resolved = await api.resolveConnection?.({
      connInfo: { name: 'Prod', database: 'md:other' },
    } as never);

    expect(resolved).not.toHaveProperty('password');
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(tokenPushes()).toHaveLength(0);
  });

  it('leaves plaintext passwords supplied by the caller untouched', async () => {
    mocks.savedConnections.value = [{ name: 'Prod', driver: 'DuckDB', database: 'md:analytics' }];
    const api = await activateExtension();

    const resolved = await api.resolveConnection?.({
      connInfo: { name: 'Prod', database: 'md:analytics', password: 'user-supplied' },
    } as never);

    expect(resolved).toMatchObject({ password: 'user-supplied' });
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(tokenPushes()).toHaveLength(0);
  });

  it('does not resolve credentials for non-MotherDuck connections', async () => {
    const api = await activateExtension();

    const resolved = await api.resolveConnection?.({
      connInfo: { name: 'Local', database: ':memory:' },
    } as never);

    expect(resolved).toMatchObject({ database: ':memory:' });
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(tokenPushes()).toHaveLength(0);
  });
});
