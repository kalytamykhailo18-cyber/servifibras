import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for frontend
  app.enableCors({
    origin: [
      'http://localhost:3002',
      'http://localhost:3000',
      'https://dev.ustymkushnir.com',
      'http://dev.ustymkushnir.com'
    ],
    credentials: true,
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);

  console.log(`🚀 Servifibras Backend running on port ${port}`);
}

bootstrap();
