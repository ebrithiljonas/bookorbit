import { computeBroadcastAddress, parseDiscoveryResponse } from './crosspoint-discovery.service';

describe('CrossPoint discovery response', () => {
  it('reads the hostname and WebSocket port from the firmware reply', () => {
    expect(parseDiscoveryResponse('crosspoint (on crosspoint-x4);81', '192.168.1.50')).toEqual({
      host: '192.168.1.50',
      wsPort: 81,
      hostname: 'crosspoint-x4',
    });
    expect(parseDiscoveryResponse('CrossPoint (on reader);9000,other', '10.0.0.8')).toEqual({
      host: '10.0.0.8',
      wsPort: 9000,
      hostname: 'reader',
    });
  });

  it('falls back to port 81 and no hostname when the reply is sparse', () => {
    expect(parseDiscoveryResponse('crosspoint', '192.168.1.51')).toEqual({
      host: '192.168.1.51',
      wsPort: 81,
      hostname: null,
    });
    expect(parseDiscoveryResponse('crosspoint;not-a-port', '192.168.1.52')).toEqual({
      host: '192.168.1.52',
      wsPort: 81,
      hostname: null,
    });
  });

  it('ignores replies from anything that is not a CrossPoint reader', () => {
    expect(parseDiscoveryResponse('kobo hello', '192.168.1.50')).toBeNull();
    expect(parseDiscoveryResponse('', '192.168.1.50')).toBeNull();
  });
});

describe('CrossPoint broadcast address', () => {
  it('computes the IPv4 subnet broadcast', () => {
    expect(computeBroadcastAddress('192.168.8.42', '255.255.255.0')).toBe('192.168.8.255');
    expect(computeBroadcastAddress('10.1.2.3', '255.255.0.0')).toBe('10.1.255.255');
  });

  it('rejects malformed addresses', () => {
    expect(computeBroadcastAddress('192.168.8.42', '255.255.255')).toBeNull();
    expect(computeBroadcastAddress('192.168.8.999', '255.255.255.0')).toBeNull();
  });
});
