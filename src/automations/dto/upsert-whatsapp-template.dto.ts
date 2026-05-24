import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AutomationTrigger,
  WhatsAppTemplateCategory,
  WhatsAppTemplateStatus,
} from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpsertWhatsappTemplateDto {
  @ApiProperty({ example: 'crewflow_booking_confirmed' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ enum: AutomationTrigger })
  @IsOptional()
  @IsEnum(AutomationTrigger)
  trigger?: AutomationTrigger;

  @ApiPropertyOptional({ example: 'en_US' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ enum: WhatsAppTemplateCategory })
  @IsOptional()
  @IsEnum(WhatsAppTemplateCategory)
  category?: WhatsAppTemplateCategory;

  @ApiPropertyOptional({ enum: WhatsAppTemplateStatus })
  @IsOptional()
  @IsEnum(WhatsAppTemplateStatus)
  status?: WhatsAppTemplateStatus;

  @ApiProperty({
    example:
      'Hi {{customerName}}, your {{service}} appointment is confirmed for {{startTime}}.',
  })
  @IsString()
  body: string;

  @ApiPropertyOptional({ example: ['customerName', 'service', 'startTime'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  variableKeys?: string[];

  @ApiPropertyOptional({
    example: { customerName: 'Ava', service: 'Deep Cleaning' },
  })
  @IsOptional()
  @IsObject()
  sampleValues?: Record<string, string>;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class LinkWhatsappTemplateDto {
  @ApiProperty({ enum: AutomationTrigger })
  @IsEnum(AutomationTrigger)
  trigger: AutomationTrigger;
}
