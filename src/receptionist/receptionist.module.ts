import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AiReceptionistService } from './ai-receptionist.service';
import { ReceptionistController } from './receptionist.controller';
import { ReceptionistService } from './receptionist.service';

@Module({
  imports: [AuditModule],
  controllers: [ReceptionistController],
  providers: [ReceptionistService, AiReceptionistService],
})
export class ReceptionistModule {}
