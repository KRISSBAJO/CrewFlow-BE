import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class CreateCustomerDto {
  @ApiProperty({ example: 'Nia Carter' })
  @IsString()
  name: string;

  @ApiProperty({ example: '+15550102020' })
  @IsString()
  phone: string;

  @ApiPropertyOptional({ example: 'nia@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/demo/image/upload/customers/nia.jpg',
  })
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiPropertyOptional({
    example: 'Prefers WhatsApp. Has a dog. Gate code 4821.',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
