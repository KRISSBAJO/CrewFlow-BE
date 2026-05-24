import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SendConversationQuoteDto {
  @ApiProperty({ example: 'cm_service_id' })
  @IsString()
  serviceId: string;

  @ApiPropertyOptional({ example: 'Does Friday afternoon work?' })
  @IsOptional()
  @IsString()
  note?: string;
}
