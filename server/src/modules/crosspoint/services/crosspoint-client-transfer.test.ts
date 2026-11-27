import 'reflect-metadata';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CrosspointAbortError, CrosspointClientService } from './crosspoint-client.service';

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(''),
  } as unknown as Response;
}

class FakeSocket extends EventTarget {
  binaryType = 'blob';
  bufferedAmount = 0;
  sent: (string | Buffer)[] = [];
  closed = false;
  onSend: ((data: string | Buffer) => void) | null = null;

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    const value = typeof data === 'string' ? data : Buffer.from(data as ArrayBufferView);
    this.sent.push(value);
    this.onSend?.(value);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.dispatchEvent(new Event('close'));
  }

  open() {
    this.dispatchEvent(new Event('open'));
  }

  message(data: string) {
    this.dispatchEvent(Object.assign(new Event('message'), { data }));
  }
}

class TestCrosspointClient extends CrosspointClientService {
  constructor(private readonly fake: FakeSocket) {
    super();
  }

  protected override createSocket(): never {
    queueMicrotask(() => this.fake.open());
    return this.fake as never;
  }
}

describe('CrosspointClientService transfer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists files and filters malformed entries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response([
        { name: 'A.epub', size: 10, isDirectory: false, isEpub: true },
        { name: 'Folder', size: 0, isDirectory: true, isEpub: false },
        { name: '../evil.epub', size: 1, isDirectory: false, isEpub: true },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new CrosspointClientService();
    await expect(client.listFiles('192.168.1.50', 80, '/BookOrbit')).resolves.toEqual([
      { path: '/BookOrbit/A.epub', name: 'A.epub', size: 10, isDirectory: false, isEpub: true },
      { path: '/BookOrbit/Folder', name: 'Folder', size: 0, isDirectory: true, isEpub: false },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('http://192.168.1.50:80/api/files?path=%2FBookOrbit', expect.objectContaining({ redirect: 'error' }));
  });

  it('walks subfolders recursively', async () => {
    const client = new CrosspointClientService();
    const listSpy = vi.spyOn(client, 'listFiles').mockImplementation((_host, _port, path) => {
      if (path === '/BookOrbit') {
        return Promise.resolve([
          { path: '/BookOrbit/Author', name: 'Author', size: 0, isDirectory: true, isEpub: false },
          { path: '/BookOrbit/Root.epub', name: 'Root.epub', size: 1, isDirectory: false, isEpub: true },
        ]);
      }
      if (path === '/BookOrbit/Author') {
        return Promise.resolve([{ path: '/BookOrbit/Author/Nested.epub', name: 'Nested.epub', size: 2, isDirectory: false, isEpub: true }]);
      }
      return Promise.resolve([]);
    });

    const files = await client.listFilesRecursive('192.168.1.50', 80, '/BookOrbit');

    expect(files.map((file) => file.path).sort()).toEqual(['/BookOrbit/Author/Nested.epub', '/BookOrbit/Root.epub']);
    expect(listSpy).toHaveBeenCalledWith('192.168.1.50', 80, '/BookOrbit/Author');
  });

  it('creates every missing folder level once', async () => {
    const client = new CrosspointClientService();
    vi.spyOn(client, 'listFiles').mockResolvedValue([]);
    const mkdirSpy = vi.spyOn(client as unknown as { mkdir: (...args: unknown[]) => Promise<void> }, 'mkdir').mockResolvedValue(undefined);

    await client.ensureDirectory('192.168.1.50', 80, '/BookOrbit/Author/Series');

    expect(mkdirSpy.mock.calls).toEqual([
      ['192.168.1.50', 80, 'BookOrbit', '/'],
      ['192.168.1.50', 80, 'Author', '/BookOrbit'],
      ['192.168.1.50', 80, 'Series', '/BookOrbit/Author'],
    ]);
  });

  it('deletes paths through the JSON form field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({}));
    vi.stubGlobal('fetch', fetchMock);

    const client = new CrosspointClientService();
    await client.deletePaths('192.168.1.50', 80, ['/BookOrbit/A.epub']);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.body as URLSearchParams).toString()).toBe('paths=%5B%22%2FBookOrbit%2FA.epub%22%5D');
  });

  it('uploads a file and reports progress through DONE', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'crosspoint-client-'));
    const filePath = join(directory, 'book.epub');
    const content = Buffer.alloc(5_000, 1);
    await writeFile(filePath, content);

    const socket = new FakeSocket();
    let received = 0;
    socket.onSend = (data) => {
      if (typeof data === 'string' && data.startsWith('START:')) {
        queueMicrotask(() => socket.message('READY'));
        return;
      }
      if (Buffer.isBuffer(data)) {
        received += data.length;
        if (received >= content.length) {
          queueMicrotask(() => socket.message('PROGRESS:5000:5000'));
          queueMicrotask(() => socket.message('DONE'));
        }
      }
    };
    const client = new TestCrosspointClient(socket);
    const progress: number[] = [];

    try {
      await client.uploadFile({
        host: '192.168.1.50',
        wsPort: 81,
        directory: '/BookOrbit',
        filename: 'book.epub',
        filePath,
        onProgress: (value) => progress.push(value.sent),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }

    expect(socket.sent[0]).toBe(`START:book.epub:5000:/BookOrbit`);
    expect(received).toBe(5000);
    expect(progress.at(-1)).toBe(5000);
  });

  it('surfaces a device upload error', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'crosspoint-client-'));
    const filePath = join(directory, 'book.epub');
    await writeFile(filePath, Buffer.from('hello'));

    const socket = new FakeSocket();
    socket.onSend = (data) => {
      if (typeof data === 'string' && data.startsWith('START:')) {
        queueMicrotask(() => socket.message('ERROR:File already exists: book.epub'));
      }
    };
    const client = new TestCrosspointClient(socket);

    try {
      await expect(
        client.uploadFile({
          host: '192.168.1.50',
          wsPort: 81,
          directory: '/BookOrbit',
          filename: 'book.epub',
          filePath,
        }),
      ).rejects.toMatchObject({ deviceMessage: 'File already exists: book.epub' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses an upload that was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new CrosspointClientService();

    await expect(
      client.uploadFile({
        host: '192.168.1.50',
        wsPort: 81,
        directory: '/BookOrbit',
        filename: 'book.epub',
        filePath: '/does/not/matter.epub',
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(CrosspointAbortError);
  });
});
