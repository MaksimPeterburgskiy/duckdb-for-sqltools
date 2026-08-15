import { ILanguageServerPlugin } from '@sqltools/types';
import YourDriver from './driver';
import { DRIVER_ALIASES } from './../constants';
import { SET_MOTHERDUCK_TOKEN_REQUEST, SetMotherDuckTokenParams } from '../motherduck-credentials';
import { setMotherDuckToken } from './motherduck-token-store';

const YourDriverPlugin: ILanguageServerPlugin = {
  register(server) {
    DRIVER_ALIASES.forEach(({ value }) => {
      server.getContext().drivers.set(value, YourDriver as any);
    });
    // Write-only: tokens can be pushed into the store but there is no
    // request that reads them back out of the language server.
    server.onRequest(SET_MOTHERDUCK_TOKEN_REQUEST, ({ key, token }: SetMotherDuckTokenParams) => {
      setMotherDuckToken(key, token);
    });
  }
}

export default YourDriverPlugin;
