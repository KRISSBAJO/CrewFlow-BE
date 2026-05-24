import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { SendCampaignDto } from './dto/send-campaign.dto';
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

  @Get('revenue-engine')
  revenueEngine(@CurrentUser() user: AuthUser) {
    return this.retention.revenueEngine(user);
  }

  @Post('scan')
  scan(@CurrentUser() user: AuthUser) {
    return this.retention.scan(user);
  }

  @Post('campaigns/send')
  sendCampaign(@CurrentUser() user: AuthUser, @Body() dto: SendCampaignDto) {
    return this.retention.sendCampaign(user, dto);
  }
}
