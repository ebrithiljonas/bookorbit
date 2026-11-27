import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateCrosspointDeviceDto } from './create-device.dto';
import { ProbeCrosspointDeviceDto } from './probe-device.dto';
import { UpdateCrosspointDeviceDto } from './update-device.dto';

async function errorsFor<T extends object>(cls: new () => T, value: Record<string, unknown>) {
  return validate(plainToInstance(cls, value));
}

describe('CrossPoint DTO validation', () => {
  it('accepts a complete device request with a nested selection', async () => {
    const errors = await errorsFor(CreateCrosspointDeviceDto, {
      name: 'Bedroom reader',
      host: '192.168.1.50',
      wsPort: 81,
      httpPort: 80,
      rootFolder: '/BookOrbit',
      fileNamingPattern: '{library}/<{authors:first}|Unknown Author>/<{series}/>{originalFilename}',
      removeMissing: true,
      selection: { mode: 'selected', libraryIds: [9], collectionIds: [1, 2], smartScopeIds: [3] },
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts library selection and validates its ids', async () => {
    expect(
      (
        await errorsFor(CreateCrosspointDeviceDto, {
          name: 'Reader',
          host: '192.168.1.50',
          selection: { mode: 'libraries', libraryIds: [1, 2] },
        })
      ).length,
    ).toBe(0);
    expect(
      (
        await errorsFor(CreateCrosspointDeviceDto, {
          name: 'Reader',
          host: '192.168.1.50',
          selection: { mode: 'libraries', libraryIds: [0] },
        })
      ).length,
    ).toBeGreaterThan(0);
  });

  it('rejects missing names, hosts and invalid ports', async () => {
    expect((await errorsFor(CreateCrosspointDeviceDto, { host: '192.168.1.50' })).length).toBeGreaterThan(0);
    expect((await errorsFor(CreateCrosspointDeviceDto, { name: 'Reader' })).length).toBeGreaterThan(0);
    expect((await errorsFor(CreateCrosspointDeviceDto, { name: '', host: '192.168.1.50' })).length).toBeGreaterThan(0);
    expect((await errorsFor(CreateCrosspointDeviceDto, { name: 'Reader', host: '192.168.1.50', wsPort: 0 })).length).toBeGreaterThan(0);
    expect((await errorsFor(CreateCrosspointDeviceDto, { name: 'Reader', host: '192.168.1.50', httpPort: 70000 })).length).toBeGreaterThan(0);
  });

  it('rejects an unknown selection mode, non-integer ids and duplicates', async () => {
    expect(
      (
        await errorsFor(CreateCrosspointDeviceDto, {
          name: 'Reader',
          host: '192.168.1.50',
          selection: { mode: 'some' },
        })
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await errorsFor(CreateCrosspointDeviceDto, {
          name: 'Reader',
          host: '192.168.1.50',
          selection: { mode: 'selected', collectionIds: [0] },
        })
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await errorsFor(CreateCrosspointDeviceDto, {
          name: 'Reader',
          host: '192.168.1.50',
          selection: { mode: 'selected', smartScopeIds: [1, 1] },
        })
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await errorsFor(CreateCrosspointDeviceDto, {
          name: 'Reader',
          host: '192.168.1.50',
          selection: {},
        })
      ).length,
    ).toBeGreaterThan(0);
  });

  it('accepts partial updates and rejects an empty name', async () => {
    expect((await errorsFor(UpdateCrosspointDeviceDto, { removeMissing: true })).length).toBe(0);
    expect((await errorsFor(UpdateCrosspointDeviceDto, { name: '' })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateCrosspointDeviceDto, { wsPort: 0 })).length).toBeGreaterThan(0);
  });

  it('validates a standalone probe address', async () => {
    expect((await errorsFor(ProbeCrosspointDeviceDto, { host: '192.168.1.50' })).length).toBe(0);
    expect((await errorsFor(ProbeCrosspointDeviceDto, { host: '' })).length).toBeGreaterThan(0);
  });
});
