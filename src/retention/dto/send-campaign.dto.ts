import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageProvider } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export enum RevenueCampaignType {
  REBOOKING = 'REBOOKING',
  WIN_BACK = 'WIN_BACK',
  VIP_CHECK_IN = 'VIP_CHECK_IN',
  PAYMENT_RECOVERY = 'PAYMENT_RECOVERY',
}

export class SendCampaignDto {
  @ApiProperty({ enum: RevenueCampaignType })
  @IsEnum(RevenueCampaignType)
  type!: RevenueCampaignType;

  @ApiProperty({ example: ['customer-id-1', 'customer-id-2'] })
  @IsArray()
  @IsString({ each: true })
  customerIds!: string[];

  @ApiPropertyOptional({
    enum: MessageProvider,
    example: MessageProvider.WHATSAPP,
  })
  @IsOptional()
  @IsEnum(MessageProvider)
  provider?: MessageProvider;

  @ApiPropertyOptional({
    example: 'We can reserve your preferred Friday slot.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
