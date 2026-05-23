import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ActionPriority } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateActionFromConversationDto {
  @ApiProperty({ example: 'Follow up with customer' })
  @IsString()
  title: string;

  @ApiPropertyOptional({
    example: 'Customer asked for a callback before booking.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: ActionPriority, example: ActionPriority.HIGH })
  @IsOptional()
  @IsEnum(ActionPriority)
  priority?: ActionPriority;

  @ApiPropertyOptional({ example: '2026-05-24T15:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  dueAt?: string;
}
