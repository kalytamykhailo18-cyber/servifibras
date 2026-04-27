import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Servifibras AI Platform API - Running ✓';
  }
}
