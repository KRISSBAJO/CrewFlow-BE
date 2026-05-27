import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AutomationsModule } from '../automations/automations.module';
import { PaymentsModule } from '../payments/payments.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AuditModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN', '1d'),
        },
      }),
    }),
    AutomationsModule,
    PaymentsModule,
    WebhooksModule,
    WorkflowsModule,
  ],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
