import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateBookingIntentFromConversationDto {
  @ApiPropertyOptional({ example: 'clx_service_id' })
  @IsOptional()
  @IsString()
  serviceId?: string;

  @ApiPropertyOptional({ example: 'Friday afternoon' })
  @IsOptional()
  @IsString()
  preferredWindow?: string;

  @ApiPropertyOptional({ example: '123 Main St, Chicago, IL' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'Customer wants recurring monthly service.' })
  @IsOptional()
  @IsString()
  notes?: string;
}
