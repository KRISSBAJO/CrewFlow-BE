import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CreateSupportNoteDto {
  @ApiProperty({ example: 'Customer asked for help configuring WhatsApp.' })
  @IsString()
  @MinLength(3)
  note: string;
}
