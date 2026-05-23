import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateServiceDto {
  @ApiProperty({ example: 'Deep Home Cleaning' })
  @IsString()
  title: string;

  @ApiPropertyOptional({
    example: 'Kitchen, bathrooms, floors, dusting, and detailed reset.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 180, minimum: 5 })
  @IsInt()
  @Min(5)
  durationMinutes: number;

  @ApiProperty({
    example: 249,
    minimum: 0,
    description: 'Display amount in dollars. Stored internally as cents.',
  })
  @IsNumber()
  @Min(0)
  price: number;
}
