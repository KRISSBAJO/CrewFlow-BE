import { Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { RetentionService } from './retention.service';

@ApiTags('retention')
@ApiBearerAuth()
@Roles(UserRole.OWNER, UserRole.MANAGER)
@Controller('retention')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Get()
  summary(@CurrentUser() user: AuthUser) {
    return this.retention.summary(user);
  }

  @Post('scan')
  scan(@CurrentUser() user: AuthUser) {
    return this.retention.scan(user);
  }
}
