import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable CORS
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', /\.shapeshift\.com$/],
    credentials: true,
  });

  const port = process.env.PORT || 3003;
  await app.listen(port);
  
  console.log(`Notifications service is running on: http://localhost:${port}`);
}

bootstrap();
