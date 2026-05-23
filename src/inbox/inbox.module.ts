import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BookingsModule } from '../bookings/bookings.module';
import { MessagingModule } from '../messaging/messaging.module';
import { InboxAiService } from './inbox-ai.service';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

@Module({
  imports: [AuditModule, MessagingModule, BookingsModule],
  controllers: [InboxController],
  providers: [InboxService, InboxAiService],
})
export class InboxModule {}
