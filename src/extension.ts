import * as vscode from 'vscode';
import { IExtension, IExtensionPlugin, IDriverExtensionApi, ILanguageClient } from '@sqltools/types';
import { ExtensionContext } from 'vscode';
import { DRIVER_ALIASES } from './constants';
import {
  DuckDBConnectionInfo,
  isMotherDuckConnection,
  parseBeforeEditConnection,
  parseBeforeSaveConnection,
  resolveConnectionPaths,
} from './connection-parser';
import {
  CONFLICTING_DUCKDB_EXTENSION_ID,
  DUCKDB_EXTENSION_CONFLICT_MESSAGE,
  hasConflictingDuckDBExtension,
} from './extension-conflict';
import { motherDuckTokenKey, SET_MOTHERDUCK_TOKEN_REQUEST } from './motherduck-credentials';
const { publisher, name, displayName } = require('../package.json');

const AUTHENTICATION_PROVIDER = 'sqltools-driver-credentials';
const MOTHERDUCK_CREDENTIAL_SCOPE = 'MotherDuck token';

function getWorkspaceContext() {
  return {
    workspaceFolders: vscode.workspace.workspaceFolders?.map(folder => ({
      name: folder.name,
      fsPath: folder.uri.fsPath,
    })),
  };
}

// The exported API is callable by any installed extension, so token resolution
// is limited to connections the user actually saved in SQLTools settings.
function isSavedMotherDuckConnection(resolved: DuckDBConnectionInfo): boolean {
  const configs = [
    vscode.workspace.getConfiguration('sqltools'),
    ...(vscode.workspace.workspaceFolders ?? []).map(folder =>
      vscode.workspace.getConfiguration('sqltools', folder.uri)),
  ];
  return configs.some(config =>
    (config.get<DuckDBConnectionInfo[]>('connections') ?? []).some(saved =>
      !!saved
      && DRIVER_ALIASES.some(({ value }) => value === saved.driver)
      && saved.name === resolved.name
      && isMotherDuckConnection(saved)
      && (saved.database ?? saved.databaseFilePath) === (resolved.database ?? resolved.databaseFilePath)),
  );
}

export async function activate(extContext: ExtensionContext): Promise<IDriverExtensionApi> {
  if (hasConflictingDuckDBExtension(extensionId => vscode.extensions.getExtension(extensionId))) {
    const action = await vscode.window.showErrorMessage(
      DUCKDB_EXTENSION_CONFLICT_MESSAGE,
      'Show Evidence extension',
    );
    if (action) {
      await vscode.commands.executeCommand(
        'workbench.extensions.search',
        `@id:${CONFLICTING_DUCKDB_EXTENSION_ID}`,
      );
    }
    throw new Error(DUCKDB_EXTENSION_CONFLICT_MESSAGE);
  }

  const sqltools = vscode.extensions.getExtension<IExtension>('mtxr.sqltools');
  if (!sqltools) {
    throw new Error('SQLTools not installed');
  }
  await sqltools.activate();

  const api = sqltools.exports;

  let resolveLanguageClient!: (client: ILanguageClient) => void;
  const languageClient = new Promise<ILanguageClient>(resolve => {
    resolveLanguageClient = resolve;
  });

  const extensionId = `${publisher}.${name}`;
  const plugin: IExtensionPlugin = {
    extensionId,
    name: `${displayName} Plugin`,
    type: 'driver',
    async register(extension) {
      // register ext part here
      extension.resourcesMap().set(`driver/${DRIVER_ALIASES[0].value}/icons`, {
        active: extContext.asAbsolutePath('icons/active.png'),
        default: extContext.asAbsolutePath('icons/default.png'),
        inactive: extContext.asAbsolutePath('icons/inactive.png'),
      });
      DRIVER_ALIASES.forEach(({ value }) => {
        extension.resourcesMap().set(`driver/${value}/extension-id`, extensionId);
        extension
          .resourcesMap()
          .set(`driver/${value}/connection-schema`, extContext.asAbsolutePath('connection.schema.json'));
        extension.resourcesMap().set(`driver/${value}/ui-schema`, extContext.asAbsolutePath('ui.schema.json'));
      });
      await extension.client.sendRequest('ls/RegisterPlugin', { path: extContext.asAbsolutePath('out/ls/plugin.js') });
      resolveLanguageClient(extension.client);
    },
  };
  api.registerPlugin(plugin);
  return {
    driverName: displayName,
    parseBeforeSaveConnection: ({ connInfo }) =>
      parseBeforeSaveConnection({ connInfo }, getWorkspaceContext()),
    parseBeforeEditConnection: ({ connInfo }) =>
      parseBeforeEditConnection({ connInfo }, getWorkspaceContext()),
    resolveConnection: async ({ connInfo }) => {
      const resolved = resolveConnectionPaths(connInfo, getWorkspaceContext());
      if (
        isMotherDuckConnection(resolved)
        && resolved.password === undefined
        && !resolved.askForPassword
        && isSavedMotherDuckConnection(resolved)
      ) {
        const scopes = [resolved.name ?? 'DuckDB', MOTHERDUCK_CREDENTIAL_SCOPE];
        let session = await vscode.authentication.getSession(AUTHENTICATION_PROVIDER, scopes, { silent: true });
        if (!session) {
          session = await vscode.authentication.getSession(AUTHENTICATION_PROVIDER, scopes, { createIfNone: true });
        }
        if (session) {
          // Hand the token to our driver inside the SQLTools language server
          // instead of returning it here: this API is reachable by every
          // installed extension, and a returned password would let any of
          // them read the MotherDuck token.
          const client = await languageClient;
          await client.sendRequest(SET_MOTHERDUCK_TOKEN_REQUEST, {
            key: motherDuckTokenKey(resolved.name, resolved.database ?? resolved.databaseFilePath),
            token: session.accessToken,
          });
        }
      }
      return resolved;
    },
    driverAliases: DRIVER_ALIASES,
  };
}

export function deactivate() {}
