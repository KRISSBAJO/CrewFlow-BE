import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { Roles } from '../common/roles.decorator';
import { CreateBillingEventDto } from './dto/create-billing-event.dto';
import { CreatePlatformCheckoutDto } from './dto/create-platform-checkout.dto';
import { CreatePlatformTenantDto } from './dto/create-platform-tenant.dto';
import { CreatePlatformUserDto } from './dto/create-platform-user.dto';
import { CreateSupportAccessDto } from './dto/create-support-access.dto';
import { CreateSupportNoteDto } from './dto/create-support-note.dto';
import { UpdateActionDto } from '../workflows/dto/update-action.dto';
import { UpdatePlatformUserDto } from './dto/update-platform-user.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { PlatformService } from './platform.service';

@ApiTags('platform')
@ApiBearerAuth()
@Roles(UserRole.PLATFORM_ADMIN)
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('metrics')
  metrics() {
    return this.platform.metrics();
  }

  @Get('tenants')
  tenants() {
    return this.platform.tenants();
  }

  @Post('tenants')
  createTenant(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePlatformTenantDto,
  ) {
    return this.platform.createTenant(user, dto);
  }

  @Get('users')
  users() {
    return this.platform.users();
  }

  @Post('users')
  createUser(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePlatformUserDto,
  ) {
    return this.platform.createUser(user, dto);
  }

  @Patch('users/:id')
  updateUser(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePlatformUserDto,
  ) {
    return this.platform.updateUser(user, id, dto);
  }

  @Get('actions')
  actions() {
    return this.platform.actions();
  }

  @Patch('actions/:id')
  updateAction(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateActionDto,
  ) {
    return this.platform.updateAction(user, id, dto);
  }

  @Get('tenants/:id')
  tenant(@Param('id') id: string) {
    return this.platform.tenant(id);
  }

  @Get('tenants/:id/health')
  tenantHealth(@Param('id') id: string) {
    return this.platform.tenantHealth(id);
  }

  @Get('tenants/:id/usage')
  tenantUsage(@Param('id') id: string) {
    return this.platform.tenantUsage(id);
  }

  @Patch('tenants/:id')
  updateTenant(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateTenantStatusDto,
  ) {
    return this.platform.updateTenant(user, id, dto);
  }

  @Get('tenants/:id/support-notes')
  supportNotes(@Param('id') id: string) {
    return this.platform.supportNotes(id);
  }

  @Post('tenants/:id/support-notes')
  addSupportNote(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateSupportNoteDto,
  ) {
    return this.platform.addSupportNote(user, id, dto);
  }

  @Get('tenants/:id/support-access')
  supportAccess(@Param('id') id: string) {
    return this.platform.supportAccess(id);
  }

  @Post('tenants/:id/support-access')
  createSupportAccess(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateSupportAccessDto,
  ) {
    return this.platform.createSupportAccess(user, id, dto);
  }

  @Get('tenants/:id/billing')
  billingSummary(@Param('id') id: string) {
    return this.platform.billingSummary(id);
  }

  @Get('tenants/:id/billing-events')
  billingEvents(@Param('id') id: string) {
    return this.platform.billingEvents(id);
  }

  @Post('tenants/:id/billing-events')
  createBillingEvent(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateBillingEventDto,
  ) {
    return this.platform.createBillingEvent(user, id, dto);
  }

  @Post('tenants/:id/billing/checkout')
  createBillingCheckout(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreatePlatformCheckoutDto,
  ) {
    return this.platform.createBillingCheckout(user, id, dto);
  }

  @Post('tenants/:id/billing/portal')
  createBillingPortal(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.platform.createBillingPortal(user, id);
  }

  @Public()
  @Roles()
  @Get('mock-billing/:id/success')
  renderMockBillingSuccess(@Param('id') id: string) {
    return this.platform.markMockBillingSucceeded(id);
  }

  @Public()
  @Roles()
  @Post('mock-billing/:id/success')
  markMockBillingSucceeded(@Param('id') id: string) {
    return this.platform.markMockBillingSucceeded(id);
  }

  @Get('automation-failures')
  automationFailures() {
    return this.platform.automationFailures();
  }

  @Get('webhook-failures')
  webhookFailures() {
    return this.platform.webhookFailures();
  }

  @Get('audit')
  audit() {
    return this.platform.auditLogs();
  }
}
