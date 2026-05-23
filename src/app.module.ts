import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AttendanceModule } from './attendance/attendance.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { AutomationsModule } from './automations/automations.module';
import { BookingsModule } from './bookings/bookings.module';
import { RolesGuard } from './common/roles.guard';
import { CustomersModule } from './customers/customers.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { FieldOpsModule } from './field-ops/field-ops.module';
import { HealthModule } from './health/health.module';
import { InvoicesModule } from './invoices/invoices.module';
import { InboxModule } from './inbox/inbox.module';
import { LeadsModule } from './leads/leads.module';
import { MessagesModule } from './messages/messages.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReceptionistModule } from './receptionist/receptionist.module';
import { RetentionModule } from './retention/retention.module';
import { ServicesModule } from './services/services.module';
import { RateLimitGuard } from './security/rate-limit.guard';
import { SchedulerModule } from './scheduler/scheduler.module';
import { SecurityModule } from './security/security.module';
import { TenantsModule } from './tenants/tenants.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { WorkflowsModule } from './workflows/workflows.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    SecurityModule,
    HealthModule,
    AuthModule,
    AuditModule,
    TenantsModule,
    CustomersModule,
    ServicesModule,
    BookingsModule,
    FieldOpsModule,
    AttendanceModule,
    InvoicesModule,
    InboxModule,
    LeadsModule,
    PaymentsModule,
    MessagesModule,
    AutomationsModule,
    DashboardModule,
    ReceptionistModule,
    RetentionModule,
    WebhooksModule,
    WorkflowsModule,
    SchedulerModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
