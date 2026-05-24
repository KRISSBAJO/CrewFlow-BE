import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ReplayPlatformFailureDto {
  @ApiPropertyOptional({ example: 'Retry after provider outage cleared.' })
  @IsOptional()
  @IsString()
  reason?: string;
}
