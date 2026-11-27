import { IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CrosspointProgressDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  document!: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  percentage!: number;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  progress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  device?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  device_id?: string;

  @IsOptional()
  @IsNumber()
  timestamp?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  position?: Record<string, unknown>;
}
