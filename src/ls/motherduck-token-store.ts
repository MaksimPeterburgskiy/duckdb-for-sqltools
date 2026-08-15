// In-memory MotherDuck token stash, private to the language-server process.
// The extension host pushes tokens here (see SET_MOTHERDUCK_TOKEN_REQUEST)
// instead of returning them through the public driver extension API, where
// any installed VS Code extension could read them. Nothing in the language
// server may expose these values back over the wire.

const tokens = new Map<string, string>();

export function setMotherDuckToken(key: string, token: string): void {
  tokens.set(key, token);
}

export function getMotherDuckToken(key: string): string | undefined {
  return tokens.get(key);
}
