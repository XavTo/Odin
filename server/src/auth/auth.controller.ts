import {
  Body,
  Controller,
  Get,
  Headers,
  Header,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  status(@Headers('authorization') authorization?: string) {
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : undefined;
    return {
      required: this.auth.required,
      authorized: this.auth.accepts(token),
    };
  }
  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  login(@Body() body: { password?: unknown }, @Req() request: Request) {
    return this.auth.login(body?.password, request.ip ?? 'unknown');
  }
}
