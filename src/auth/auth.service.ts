import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import * as nodemailer from 'nodemailer';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(email: string, password: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await this.prisma.user.create({
      data: { email, password: hashedPassword },
    });

    return this.createAuthResponse(user.id, user.email);
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.createAuthResponse(user.id, user.email);
  }

  async forgotPassword(email: string) {
    const genericResponse = {
      message:
        'If an account with that email exists, a password reset token has been sent.',
    };

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });

    if (!user) {
      return genericResponse;
    }

    const resetToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashResetToken(resetToken);
    const expiresAt = new Date(
      Date.now() + this.getResetTtlMinutes() * 60 * 1000,
    );

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.deleteMany({
        where: { userId: user.id, usedAt: null },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          tokenHash,
          expiresAt,
          userId: user.id,
        },
      }),
    ]);

    await this.sendPasswordResetTokenEmail(user.email, resetToken);

    return genericResponse;
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = this.hashResetToken(token);
    const now = new Date();

    const resetRecord = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });

    if (!resetRecord || resetRecord.usedAt || resetRecord.expiresAt < now) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetRecord.userId },
        data: { password: hashedPassword },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: resetRecord.id },
        data: { usedAt: now },
      }),
      this.prisma.passwordResetToken.deleteMany({
        where: { userId: resetRecord.userId, usedAt: null },
      }),
    ]);

    return { message: 'Password has been reset successfully' };
  }

  private async createAuthResponse(userId: number, email: string) {
    const accessToken = await this.jwt.signAsync({ sub: userId, email });
    return { accessToken };
  }

  private hashResetToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private getResetTtlMinutes() {
    const ttl = Number(
      this.config.get<string>('PASSWORD_RESET_TOKEN_TTL_MINUTES') ?? '15',
    );
    if (!Number.isFinite(ttl) || ttl <= 0) {
      return 15;
    }
    return ttl;
  }

  private parseBoolean(value: string | undefined, defaultValue = false) {
    if (value === undefined) {
      return defaultValue;
    }
    return value.toLowerCase() === 'true';
  }

  private getEnvTrimmed(...keys: string[]) {
    for (const key of keys) {
      const value = process.env[key] ?? this.config.get<string>(key);
      if (value !== undefined) {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }
    return undefined;
  }

  private async sendPasswordResetTokenEmail(email: string, token: string) {
    const host = this.getEnvTrimmed('MAIL_HOST', 'SMTP_HOST');
    const portValue = this.getEnvTrimmed('MAIL_PORT', 'SMTP_PORT') ?? '587';
    const port = Number(portValue);
    const secure = this.parseBoolean(
      this.getEnvTrimmed('MAIL_SECURE', 'SMTP_SECURE'),
      false,
    );
    const user = this.getEnvTrimmed('MAIL_USER', 'SMTP_USER');
    const pass = this.getEnvTrimmed(
      'MAIL_PASSWORD',
      'MAIL_PASS',
      'SMTP_PASSWORD',
      'SMTP_PASS',
    );
    const from =
      this.getEnvTrimmed('MAIL_FROM', 'SMTP_FROM') ??
      this.getEnvTrimmed('MAIL_USER', 'SMTP_USER');

    const missingKeys: string[] = [];
    if (!host) missingKeys.push('MAIL_HOST');
    if (!user) missingKeys.push('MAIL_USER');
    if (!pass) missingKeys.push('MAIL_PASSWORD');
    if (!from) missingKeys.push('MAIL_FROM');
    if (!Number.isFinite(port)) missingKeys.push('MAIL_PORT');

    if (missingKeys.length > 0) {
      this.logger.error(
        `Email configuration invalid. Missing/invalid: ${missingKeys.join(', ')}`,
      );
      throw new InternalServerErrorException(
        `Email configuration is missing or invalid: ${missingKeys.join(', ')}`,
      );
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });

    try {
      await transporter.sendMail({
        from,
        to: email,
        subject: 'Your password reset token',
        text: `Your password reset token is: ${token}\nThis token expires in ${this.getResetTtlMinutes()} minutes.`,
      });
    } catch (error) {
      this.logger.error('Failed to send password reset token email', error);
      throw new InternalServerErrorException(
        'Unable to send password reset token email',
      );
    }
  }
}
