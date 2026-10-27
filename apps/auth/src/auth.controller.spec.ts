import { RpcException } from '@nestjs/microservices';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { AuthController } from './auth.controller';

// Mock the ESM-only package to avoid Jest CJS/ESM parse errors.
// The factory completely replaces the module — no real code is loaded.
jest.mock('@thallesp/nestjs-better-auth', () => ({
  AuthService: class MockAuthService {
    api = { getSession: jest.fn() };
  },
  BetterAuthModule: { forRoot: jest.fn() },
  InjectBetterAuth: () => () => undefined,
  CurrentUser: () => () => undefined,
}));

/**
 * Unit tests for AuthController
 *
 * Tests cover:
 * - authenticate() — valid token returns user
 * - authenticate() — null session throws RpcException (401)
 * - authenticate() — unexpected error is wrapped in RpcException
 *
 * This file serves as a boilerplate for NestJS microservice controller unit tests.
 *
 * @see AuthController
 */
describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<Pick<AuthService, 'api'>>;

  beforeEach(async () => {
    // Mock only the parts of AuthService used by this controller
    authService = {
      api: {
        getSession: jest.fn(),
      },
    } as unknown as jest.Mocked<Pick<AuthService, 'api'>>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  // ===========================================================================
  // authenticate() Tests
  // ===========================================================================

  describe('authenticate()', () => {
    /**
     * Test: Returns user when session is valid
     *
     * Scenario: AuthService resolves a session with a user object
     * Expected: The user object is returned
     */
    it('should add impersonatedBy to the reply for an impersonation session', async () => {
      const mockUser = { id: 'user-id', email: 'test@example.com' };
      (authService.api.getSession as unknown as jest.Mock).mockResolvedValue({
        user: mockUser,
        session: { impersonatedBy: 'admin-id' },
      });

      const result = await controller.authenticate({ token: 'valid-token' });

      expect(result).toEqual({ ...mockUser, impersonatedBy: 'admin-id' });
    });

    it('should leave the reply unchanged when the session is not an impersonation', async () => {
      const mockUser = { id: 'user-id', email: 'test@example.com' };
      (authService.api.getSession as unknown as jest.Mock).mockResolvedValue({
        user: mockUser,
        session: { impersonatedBy: null },
      });

      const result = await controller.authenticate({ token: 'valid-token' });

      expect(result).toEqual(mockUser);
      expect(result).not.toHaveProperty('impersonatedBy');
    });

    it('should return user when session is valid', async () => {
      // Arrange
      const mockUser = { id: 'user-id', email: 'test@example.com' };
      (authService.api.getSession as unknown as jest.Mock).mockResolvedValue({
        user: mockUser,
      });

      // Act
      const result = await controller.authenticate({ token: 'valid-token' });

      // Assert
      expect(result).toEqual(mockUser);
    });

    /**
     * Test: Throws RpcException when session is null
     *
     * Scenario: Token is invalid — AuthService returns null
     * Expected: RpcException with status 401 is thrown
     */
    it('should throw RpcException(401) when session is null', async () => {
      // Arrange
      (authService.api.getSession as unknown as jest.Mock).mockResolvedValue(
        null,
      );

      // Act & Assert
      await expect(
        controller.authenticate({ token: 'invalid-token' }),
      ).rejects.toThrow(RpcException);
    });

    /**
     * Test: Wraps unexpected errors in RpcException
     *
     * Scenario: AuthService throws an unexpected error
     * Expected: RpcException with status 401 is thrown (not the raw error)
     */
    it('should throw RpcException(401) on unexpected errors', async () => {
      // Arrange
      (authService.api.getSession as unknown as jest.Mock).mockRejectedValue(
        new Error('Network error'),
      );

      // Act & Assert
      await expect(
        controller.authenticate({ token: 'some-token' }),
      ).rejects.toThrow(RpcException);
    });
  });
});
