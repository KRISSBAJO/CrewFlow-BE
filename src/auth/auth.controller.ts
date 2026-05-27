import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.register(dto);
    this.auth.setSessionCookies(response, session);
    return this.auth.expose(session);
  }

  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.login(dto);
    this.auth.setSessionCookies(response, session);
    return this.auth.expose(session);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @Public()
  @Post('refresh')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.refresh(
      this.auth.refreshTokenFromCookieHeader(request.headers.cookie),
    );
    this.auth.setSessionCookies(response, session);
    return this.auth.expose(session);
  }

  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) response: Response) {
    this.auth.clearSessionCookies(response);
    return { ok: true };
  }
}
