import { IsBoolean, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import { CrosspointAddressDto } from './crosspoint-address.dto';
import { CrosspointSelectionDto } from './device-selection.dto';

export class CreateCrosspointDeviceDto extends CrosspointAddressDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

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
