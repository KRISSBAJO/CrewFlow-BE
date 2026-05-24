import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class UpdateCustomerDto {
  @ApiPropertyOptional({ example: 'Nia Carter' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: '+15550102020' })
  @IsOptional()
  @IsString()
  phone?: string;

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

  @ApiPropertyOptional({ example: 'Recurring customer. Use side entrance.' })
  @IsOptional()
  @IsString()
  notes?: string;
}
