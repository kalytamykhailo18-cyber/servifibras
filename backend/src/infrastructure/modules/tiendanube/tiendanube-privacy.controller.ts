import {
  Controller,
  HttpCode,
  Logger,
  Post,
  Body,
} from '@nestjs/common';

@Controller('tiendanube/privacy')
export class TiendaNubePrivacyController {
  private readonly logger = new Logger(TiendaNubePrivacyController.name);

  @Post('store-redact')
  @HttpCode(200)
  storeRedact(@Body() body: any) {
    this.logger.warn(
      `[GDPR] store-redact received: ${JSON.stringify(body).slice(0, 500)}`,
    );
    return { received: true };
  }

  @Post('customers-redact')
  @HttpCode(200)
  customersRedact(@Body() body: any) {
    this.logger.warn(
      `[GDPR] customers-redact received: ${JSON.stringify(body).slice(0, 500)}`,
    );
    return { received: true };
  }

  @Post('customers-data-request')
  @HttpCode(200)
  customersDataRequest(@Body() body: any) {
    this.logger.warn(
      `[GDPR] customers-data-request received: ${JSON.stringify(body).slice(0, 500)}`,
    );
    return { received: true };
  }
}
