import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CreateSupportAccessDto {
  @ApiProperty({ example: 'Troubleshooting tenant setup before launch call.' })
  @IsString()
  @MinLength(8)
  reason: string;
}
