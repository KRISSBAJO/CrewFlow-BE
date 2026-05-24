import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { corsOrigins, validateEnv } from './config/env';

async function bootstrap() {
  validateEnv();
  const app = await NestFactory.create(AppModule, { rawBody: true });
  if (process.env.TRUST_PROXY === 'true') {
    const server = app.getHttpAdapter().getInstance() as {
      set: (key: string, value: unknown) => void;
    };
    server.set('trust proxy', 1);
  }
  app.use(helmet());
  app.enableCors({
    origin: corsOrigins(),
    credentials: true,
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  if (process.env.SWAGGER_ENABLED !== 'false') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('CrewFlow Operations API')
      .setDescription(
        'Tenant-aware operations backend for service businesses: bookings, staff, invoices, messages, automations, and AI receptionist intake.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const openApiDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, openApiDocument, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });
  }

  await app.listen(process.env.PORT ?? 3002);
}
void bootstrap();
