import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ArchiveTenantDto {
  @ApiProperty({ example: 'Sparkle Home Services' })
  @IsString()
  confirmation: string;

  @ApiProperty({ example: 'Customer requested cancellation.' })
  @IsString()
  reason: string;
}
