import { siaClient } from './sia-client';

describe('siaClient', () => {
  it('should work', () => {
    expect(siaClient()).toEqual('sia-client');
  });
});
