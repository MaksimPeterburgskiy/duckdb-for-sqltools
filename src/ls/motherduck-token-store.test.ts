import { describe, expect, it } from 'vitest';
import { motherDuckTokenKey } from '../motherduck-credentials';
import { getMotherDuckToken, setMotherDuckToken } from './motherduck-token-store';

describe('MotherDuck token store', () => {
  it('returns stored tokens by connection key', () => {
    const key = motherDuckTokenKey('Prod', 'md:analytics');
    setMotherDuckToken(key, 'md_live_secret');

    expect(getMotherDuckToken(key)).toBe('md_live_secret');
    expect(getMotherDuckToken(motherDuckTokenKey('Other', 'md:analytics'))).toBeUndefined();
  });

  it('keys tokens on both name and database', () => {
    expect(motherDuckTokenKey('Prod', 'md:a')).not.toBe(motherDuckTokenKey('Prod', 'md:b'));
    expect(motherDuckTokenKey('A', 'md:x')).not.toBe(motherDuckTokenKey('B', 'md:x'));
    expect(motherDuckTokenKey(undefined, 'md:x')).toBe(motherDuckTokenKey(undefined, 'md:x'));
  });
});
