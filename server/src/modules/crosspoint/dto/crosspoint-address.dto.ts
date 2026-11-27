import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CrosspointAddressDto {
  @IsString()
  @MinLength(1)
  @MaxLength(253)
  host: string;

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
}
