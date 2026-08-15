import * as vscode from 'vscode';
import { IExtension, IExtensionPlugin, IDriverExtensionApi } from '@sqltools/types';
import { ExtensionContext } from 'vscode';
import { DRIVER_ALIASES } from './constants';
import {
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
const { publisher, name, displayName } = require('../package.json');

function getWorkspaceContext() {
  return {
    workspaceFolders: vscode.workspace.workspaceFolders?.map(folder => ({
      name: folder.name,
      fsPath: folder.uri.fsPath,
    })),
  };
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
    },
  };
  api.registerPlugin(plugin);
  return {
    driverName: displayName,
    parseBeforeSaveConnection: ({ connInfo }) =>
      parseBeforeSaveConnection({ connInfo }, getWorkspaceContext()),
    parseBeforeEditConnection: ({ connInfo }) =>
      parseBeforeEditConnection({ connInfo }, getWorkspaceContext()),
    resolveConnection: ({ connInfo }) => {
      const resolved = resolveConnectionPaths(connInfo, getWorkspaceContext());
      if (isMotherDuckConnection(resolved) && resolved.password === undefined) {
        // The returned API is public to every installed extension. Ask SQLTools
        // for the token during its normal connection flow instead of resolving
        // a credential here and exposing it to the caller.
        resolved.askForPassword = true;
      }
      return resolved;
    },
    driverAliases: DRIVER_ALIASES,
  };
}

export function deactivate() {}
