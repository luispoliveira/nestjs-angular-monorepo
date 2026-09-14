import { INestApplication, Logger, VersioningType } from '@nestjs/common';
import { ApplicationConfig } from '@nestjs/core';
import { mapToExcludeRoute } from '@nestjs/core/middleware/utils.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import z, { parse } from 'zod';

const LogLevelEnum = z.enum([
  'log',
  'error',
  'warn',
  'debug',
  'verbose',
  'fatal',
]);

const bootstrapUtilConfigSchema = z.object({
  globalPrefix: z.string(),
  globalPrefixExclude: z.array(z.string()).optional(),
  logger: z.array(LogLevelEnum).optional(),
  useHelmet: z.boolean(),
  enableVersioning: z.boolean(),
  swagger: z
    .object({
      title: z.string(),
      description: z.string(),
      version: z.string(),
      tag: z.string(),
      path: z.string(),
    })
    .optional(),
  enableCookieParser: z.boolean(),
  cors: z.object({
    origin: z.union([z.string().min(1), z.array(z.string().min(1))]),
    credentials: z.boolean(),
  }),
  trustProxy: z.boolean().optional(),
});

type BootstrapUtilConfig = z.infer<typeof bootstrapUtilConfigSchema>;

export class BootstrapUtil {
  static setup(app: INestApplication, config: BootstrapUtilConfig) {
    const validated = parse(bootstrapUtilConfigSchema, config);

    this.setGlobalPrefix(app, validated);
    this.setLogger(app, validated.logger);
    this.enableHelmet(app, validated);
    this.enableVersioning(app, validated);
    this.setupSwagger(app, validated.swagger);
    this.enableCookieParser(app, validated);
    this.enableCors(app, validated);
    this.setTrustProxy(app, validated);
  }

  private static setGlobalPrefix(
    app: INestApplication,
    config: BootstrapUtilConfig,
  ) {
    app.setGlobalPrefix(config.globalPrefix);

    if (config.globalPrefixExclude?.length) {
      const appConfig = app.get(ApplicationConfig);
      const current = appConfig.getGlobalPrefixOptions();
      appConfig.setGlobalPrefixOptions({
        ...current,
        exclude: [
          ...(current.exclude ?? []),
          ...mapToExcludeRoute(config.globalPrefixExclude),
        ],
      });
    }
  }

  private static setLogger(
    app: INestApplication,
    logger?: BootstrapUtilConfig['logger'],
  ) {
    if (!logger) return;

    app.useLogger(logger);
  }

  private static enableHelmet(
    app: INestApplication,
    config: BootstrapUtilConfig,
  ) {
    if (!config.useHelmet) return;

    app.use(helmet());
  }

  private static enableVersioning(
    app: INestApplication,
    config: BootstrapUtilConfig,
  ) {
    if (!config.enableVersioning) return;

    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
  }

  private static setupSwagger(
    app: INestApplication,
    swaggerConfig: BootstrapUtilConfig['swagger'],
  ) {
    if (!swaggerConfig) return;

    const config = new DocumentBuilder()
      .setTitle(swaggerConfig.title)
      .setDescription(swaggerConfig.description)
      .setVersion(swaggerConfig.version)
      .addTag(swaggerConfig.tag)
      .addBearerAuth()
      .addCookieAuth('connect.sid')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    try {
      // ponytail: nestjs-zod can emit a self-referencing $ref stub for a
      // paginated/codec-wrapped schema on some passes, which cleanupOpenApiDoc
      // rejects as a duplicate ("Found multiple schemas with name ..."). Docs
      // generation failing shouldn't crash the whole app boot.
      SwaggerModule.setup(swaggerConfig.path, app, cleanupOpenApiDoc(document), {
        useGlobalPrefix: true,
        jsonDocumentUrl: `${swaggerConfig.path}-json`,
      });
    } catch (error) {
      new Logger(BootstrapUtil.name).warn(
        `Swagger setup failed, continuing without API docs: ${(error as Error).message}`,
      );
    }
  }

  private static enableCookieParser(
    app: INestApplication,
    config: BootstrapUtilConfig,
  ) {
    if (!config.enableCookieParser) return;

    app.use(cookieParser());
  }

  private static enableCors(
    app: INestApplication,
    config: BootstrapUtilConfig,
  ) {
    // `cors` only matches/reflects an origin when given an array (or function) —
    // a string origin is echoed verbatim into Access-Control-Allow-Origin, so a
    // comma-joined CORS_ORIGIN value would produce an invalid multi-origin header.
    // Note `*` here is a LITERAL string (never matches any real origin), whereas
    // in better-auth's `trustedOrigins` the same `*` is a WILDCARD that trusts
    // every origin — do not "clean up" the CORS_ORIGIN filtering on that assumption.
    const origin =
      typeof config.cors.origin === 'string'
        ? config.cors.origin.split(',').map((o) => o.trim())
        : config.cors.origin;
    app.enableCors({ origin, credentials: config.cors.credentials });
  }

  private static setTrustProxy(
    app: INestApplication,
    config: BootstrapUtilConfig,
  ) {
    if (!config.trustProxy) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (app.getHttpAdapter().getInstance() as any).set('trust proxy', 1);
  }
}
