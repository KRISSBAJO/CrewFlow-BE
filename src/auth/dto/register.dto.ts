import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Sparkle Home Services' })
  @IsString()
  @IsNotEmpty()
  businessName: string;

  @ApiProperty({ example: 'Cleaning + Home Services' })
  @IsString()
  @IsNotEmpty()
  industry: string;

  @ApiProperty({ example: 'Ava Johnson' })
  @IsString()
  @IsNotEmpty()
  ownerName: string;

  @ApiPropertyOptional({ example: '+15551234567' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ example: 'owner@sparkle.test' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Password123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({
    example: ['Standard cleaning', 'Deep cleaning', 'Move-out cleaning'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  services?: string[];

  @ApiPropertyOptional({ example: '3-10' })
  @IsOptional()
  @IsString()
  staffCount?: string;

  @ApiPropertyOptional({ example: '+15551234567' })
  @IsOptional()
  @IsString()
  whatsappNumber?: string;

  @ApiPropertyOptional({ example: 'Missed inquiries and follow-up' })
  @IsOptional()
  @IsString()
  biggestProblem?: string;
}
