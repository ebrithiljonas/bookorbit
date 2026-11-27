import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import { CrosspointSelectionDto } from './device-selection.dto';

export class UpdateCrosspointDeviceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(253)
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  wsPort?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  httpPort?: number;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  rootFolder?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  fileNamingPattern?: string;

  @IsOptional()
  @IsBoolean()
  removeMissing?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => CrosspointSelectionDto)
  selection?: CrosspointSelectionDto;
}
