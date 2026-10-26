import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { CurrentUser, RateLimit } from '@repo/shared';
import { ZodSerializerDto } from 'nestjs-zod';
import {
  PushPublicKeyDto,
  PushSubscriptionDto,
  PushUnsubscribeDto,
} from './push.dto';
import { PushService } from './push.service';

/**
 * Open to any authenticated caller — no `@Roles`: every user manages their own
 * browsers. Ownership is enforced in the service, never by the request body.
 */
@Controller('push')
@RateLimit('default')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('public-key')
  @ZodSerializerDto(PushPublicKeyDto)
  publicKey() {
    return this.push.publicKey();
  }

  @Post('subscriptions')
  @HttpCode(HttpStatus.NO_CONTENT)
  subscribe(
    @CurrentUser() user: { id: string },
    @Body() body: PushSubscriptionDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.push.subscribe(user.id, body, userAgent);
  }

  @Delete('subscriptions')
  @HttpCode(HttpStatus.NO_CONTENT)
  unsubscribe(
    @CurrentUser() user: { id: string },
    @Body() body: PushUnsubscribeDto,
  ) {
    return this.push.unsubscribe(user.id, body.endpoint);
  }

  @Post('test')
  @HttpCode(HttpStatus.ACCEPTED)
  sendTest(@CurrentUser() user: { id: string }) {
    return this.push.sendTest(user.id);
  }
}
