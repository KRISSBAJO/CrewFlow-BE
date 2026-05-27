import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export enum ProviderWorkflowTarget {
  STRIPE = 'STRIPE',
  PAYSTACK = 'PAYSTACK',
  ALL = 'ALL',
}

export class VerifyProviderWorkflowDto {
  @ApiPropertyOptional({
    enum: ProviderWorkflowTarget,
    example: ProviderWorkflowTarget.ALL,
  })
  @IsOptional()
  @IsEnum(ProviderWorkflowTarget)
  provider?: ProviderWorkflowTarget;
}
