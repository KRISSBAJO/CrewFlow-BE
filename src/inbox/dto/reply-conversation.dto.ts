import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageProvider } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class ReplyConversationDto {
  @ApiProperty({
    example: 'Thanks, we can get you scheduled for Friday afternoon.',
  })
  @IsString()
  @MinLength(1)
  content: string;

  @ApiPropertyOptional({
    enum: MessageProvider,
    example: MessageProvider.WHATSAPP,
  })
  @IsOptional()
  @IsEnum(MessageProvider)
  provider?: MessageProvider;
}
