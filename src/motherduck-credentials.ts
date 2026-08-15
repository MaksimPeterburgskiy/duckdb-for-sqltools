// Shared between the extension host bundle (out/extension.js) and the
// language-server bundle (out/ls/plugin.js). Keep this module stateless:
// each bundle gets its own copy.

/** Custom LS request used to hand a MotherDuck token to the driver. */
export const SET_MOTHERDUCK_TOKEN_REQUEST = 'duckdb/setMotherDuckToken';

export interface SetMotherDuckTokenParams {
  key: string;
  token: string;
}

/**
 * Identifies which connection a stashed token belongs to. Must produce the
 * same value from the resolved connection in the extension host and from
 * `credentials` inside the language-server driver.
 */
export function motherDuckTokenKey(name: unknown, database: unknown): string {
  return JSON.stringify([name ?? null, database ?? null]);
}
