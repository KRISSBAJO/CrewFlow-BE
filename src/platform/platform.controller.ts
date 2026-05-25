import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { Roles } from '../common/roles.decorator';
import { ArchiveTenantDto } from './dto/archive-tenant.dto';
import { CreateBillingEventDto } from './dto/create-billing-event.dto';
import { CreatePlatformCheckoutDto } from './dto/create-platform-checkout.dto';
import { CreatePlatformTenantDto } from './dto/create-platform-tenant.dto';
import { CreatePlatformUserDto } from './dto/create-platform-user.dto';
import { CreateSupportAccessDto } from './dto/create-support-access.dto';
import { CreateSupportNoteDto } from './dto/create-support-note.dto';
import { ReplayPlatformFailureDto } from './dto/replay-platform-failure.dto';
import { ApplySubscriptionPlanDto } from './dto/apply-subscription-plan.dto';
import { UpdateActionDto } from '../workflows/dto/update-action.dto';
import { UpdatePlatformUserDto } from './dto/update-platform-user.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { UpsertSubscriptionPlanDto } from './dto/upsert-subscription-plan.dto';
import { PlatformService } from './platform.service';

@ApiTags('platform')
@ApiBearerAuth()
@Roles(UserRole.PLATFORM_ADMIN, UserRole.PLATFORM_SUPPORT)
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('metrics')
  metrics() {
    return this.platform.metrics();
  }

  @Get('provider-health')
  providerHealth() {
    return this.platform.providerHealth();
  }

  @Post('billing/scan-trials')
  scanTrialExpiry(@CurrentUser() user: AuthUser) {
    return this.platform.scanTrialExpiry(user);
  }

  @Post('billing/scan-past-due')
  scanPastDueBilling(@CurrentUser() user: AuthUser) {
    return this.platform.scanPastDueBilling(user);
  }

  @Get('risk')
  risk() {
    return this.platform.riskBoard();
  }

  @Get('support-sessions')
  supportSessions() {
    return this.platform.supportSessions();
  }

  @Get('tenants')
  tenants() {
    return this.platform.tenants();
  }

  @Get('plans')
  plans() {
    return this.platform.plans();
  }

  @Post('plans')
  createPlan(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertSubscriptionPlanDto,
  ) {
    return this.platform.createPlan(user, dto);
  }

  @Patch('plans/:id')
  updatePlan(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpsertSubscriptionPlanDto,
  ) {
    return this.platform.updatePlan(user, id, dto);
  }

  @Post('tenants')
  createTenant(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePlatformTenantDto,
  ) {
    return this.platform.createTenant(user, dto);
  }

  @Get('search')
  search(@Query('q') q: string) {
    return this.platform.search(q);
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

  @Post('tenants/:id/apply-plan')
  applyPlan(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ApplySubscriptionPlanDto,
  ) {
    return this.platform.applyPlan(user, id, dto);
  }

  @Post('tenants/:id/archive')
  archiveTenant(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ArchiveTenantDto,
  ) {
    return this.platform.archiveTenant(user, id, dto);
  }

  @Post('tenants/:id/restore')
  restoreTenant(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.platform.restoreTenant(user, id);
  }

  @Get('tenants/:id/export')
  exportTenant(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.platform.exportTenant(user, id);
  }

  @Get('tenants/:id/timeline')
  tenantTimeline(@Param('id') id: string) {
    return this.platform.tenantTimeline(id);
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

  @Post('support-access/:token/impersonate')
  impersonate(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    return this.platform.impersonate(user, token);
  }

  @Post('support-access/:id/revoke')
  revokeSupportAccess(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.platform.revokeSupportAccess(user, id);
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

  @Post('automation-failures/:id/retry')
  retryAutomationFailure(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReplayPlatformFailureDto,
  ) {
    return this.platform.retryAutomationFailure(user, id, dto);
  }

  @Get('webhook-failures')
  webhookFailures() {
    return this.platform.webhookFailures();
  }

  @Post('webhook-failures/:id/replay')
  replayWebhookFailure(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReplayPlatformFailureDto,
  ) {
    return this.platform.replayWebhookFailure(user, id, dto);
  }

  @Get('exports')
  exports() {
    return this.platform.exportHistory();
  }

  @Get('audit')
  audit(
    @Query('tenantId') tenantId?: string,
    @Query('action') action?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.platform.auditLogs({ tenantId, action, q, limit });
  }
}
