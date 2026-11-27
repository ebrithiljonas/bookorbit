import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { CROSSPOINT_SELECTION_MODES, type CrosspointSelectionMode } from '@bookorbit/types';

export class CrosspointSelectionDto {
  @IsIn(CROSSPOINT_SELECTION_MODES)
  mode: CrosspointSelectionMode;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @Min(1, { each: true })
  collectionIds?: number[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @Min(1, { each: true })
  smartScopeIds?: number[];
}
