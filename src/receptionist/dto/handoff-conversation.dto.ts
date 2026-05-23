import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class HandoffConversationDto {
  @ApiPropertyOptional({ example: 'Customer asked for a manager callback.' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ example: 'clx_manager_user_id' })
  @IsOptional()
  @IsString()
  handedOffToId?: string;
}
