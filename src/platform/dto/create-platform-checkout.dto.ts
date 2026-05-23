import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreatePlatformCheckoutDto {
  @ApiPropertyOptional({ example: 29900 })
  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyPriceCents?: number;

  @ApiPropertyOptional({ example: 100000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  setupFeeCents?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  collectSetupFee?: boolean;

  @ApiPropertyOptional({
    example: 'https://app.crewflow.ai/admin?billing=success',
  })
  @IsOptional()
  @IsString()
  successUrl?: string;

  @ApiPropertyOptional({
    example: 'https://app.crewflow.ai/admin?billing=cancel',
  })
  @IsOptional()
  @IsString()
  cancelUrl?: string;
}
