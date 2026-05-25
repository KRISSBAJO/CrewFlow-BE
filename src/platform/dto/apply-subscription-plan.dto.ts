import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ApplySubscriptionPlanDto {
  @ApiProperty({ example: 'plan_growth' })
  @IsString()
  planId: string;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  overwriteBilling?: boolean;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  overwriteFeatures?: boolean;
}
