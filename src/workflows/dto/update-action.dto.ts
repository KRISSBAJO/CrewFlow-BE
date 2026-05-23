import { ApiPropertyOptional } from '@nestjs/swagger';
import { ActionPriority, ActionStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateActionDto {
  @ApiPropertyOptional({ enum: ActionStatus, example: ActionStatus.COMPLETED })
  @IsOptional()
  @IsEnum(ActionStatus)
  status?: ActionStatus;

  @ApiPropertyOptional({ enum: ActionPriority, example: ActionPriority.HIGH })
  @IsOptional()
  @IsEnum(ActionPriority)
  priority?: ActionPriority;

  @ApiPropertyOptional({ example: 'clx_manager_id' })
  @IsOptional()
  @IsString()
  assignedToId?: string;

  @ApiPropertyOptional({ example: '2026-05-23T18:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @ApiPropertyOptional({ example: 'Customer confirmed they will pay today.' })
  @IsOptional()
  @IsString()
  note?: string;
}
