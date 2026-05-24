import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AssignJobDto {
  @ApiProperty({ example: 'clv_staff_123' })
  @IsString()
  staffId!: string;

  @ApiPropertyOptional({ example: 'Bring ladder and confirm garage access.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  dispatchNote?: string;
}
