import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { CollectionActionDto } from './dto/collection-action.dto';
import { CollectionsService } from './collections.service';

@Controller('collections')
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.collections.summary(user);
  }

  @Get('invoices/:invoiceId/timeline')
  timeline(
    @CurrentUser() user: AuthUser,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.collections.timeline(user, invoiceId);
  }

  @Post('invoices/:invoiceId/action')
  runAction(
    @CurrentUser() user: AuthUser,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: CollectionActionDto,
  ) {
    return this.collections.runAction(user, invoiceId, dto);
  }

  @Post('scan')
  scan(@CurrentUser() user: AuthUser) {
    return this.collections.scanOverdue(user);
  }
}
