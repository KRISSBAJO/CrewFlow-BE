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
import { InvoicesModule } from './invoices/invoices.module';
import { MessagesModule } from './messages/messages.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReceptionistModule } from './receptionist/receptionist.module';
import { ServicesModule } from './services/services.module';
import { TenantsModule } from './tenants/tenants.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { WorkflowsModule } from './workflows/workflows.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    AuditModule,
    TenantsModule,
    CustomersModule,
    ServicesModule,
    BookingsModule,
    AttendanceModule,
    InvoicesModule,
    PaymentsModule,
    MessagesModule,
    AutomationsModule,
    DashboardModule,
    ReceptionistModule,
    WebhooksModule,
    WorkflowsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
