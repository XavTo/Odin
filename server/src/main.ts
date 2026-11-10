import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.enableCors({ origin: '*' });
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
bootstrap();
