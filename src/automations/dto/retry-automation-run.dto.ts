import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RetryAutomationRunDto {
  @ApiPropertyOptional({
    example: 'Manager manually retried after checking phone number.',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
