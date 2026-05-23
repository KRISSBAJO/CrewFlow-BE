import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageProvider } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ReceptionistMessageDto {
  @ApiProperty({
    example: 'Hi, can I book a deep clean this week? What is the price?',
  })
  @IsString()
  message: string;

  @ApiPropertyOptional({ example: 'Nia Carter' })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({ example: '+15550102020' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'clx_conversation_id' })
  @IsOptional()
  @IsString()
  conversationId?: string;

  @ApiPropertyOptional({
    enum: MessageProvider,
    example: MessageProvider.WEB_CHAT,
  })
  @IsOptional()
  @IsEnum(MessageProvider)
  channel?: MessageProvider;
}
