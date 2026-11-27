import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { CrosspointDeviceContext } from '../guards/crosspoint-sync-token.guard';

export const CrosspointDevice = createParamDecorator((_data: unknown, context: ExecutionContext): CrosspointDeviceContext => {
  const request = context.switchToHttp().getRequest<FastifyRequest>();
  return (request as unknown as { crosspointDevice: CrosspointDeviceContext }).crosspointDevice;
});
