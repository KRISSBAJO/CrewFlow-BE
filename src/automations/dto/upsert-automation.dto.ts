import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AutomationTrigger, MessageProvider } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpsertAutomationDto {
  @ApiProperty({
    enum: AutomationTrigger,
    example: AutomationTrigger.BOOKING_CONFIRMED,
  })
  @IsEnum(AutomationTrigger)
  trigger: AutomationTrigger;

  @ApiPropertyOptional({
    enum: MessageProvider,
    example: MessageProvider.WHATSAPP,
  })
  @IsOptional()
  @IsEnum(MessageProvider)
  provider?: MessageProvider;

  @ApiProperty({
    example: 'Your {{service}} appointment is confirmed for {{startTime}}.',
  })
  @IsString()
  template: string;

  @ApiPropertyOptional({ example: 'cmwhatsapptemplate123' })
  @IsOptional()
  @IsString()
  whatsappTemplateId?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ example: 30, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  delayMinutes?: number;
}
