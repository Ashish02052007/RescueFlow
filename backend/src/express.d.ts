import 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name: string;
        email: string;
        passwordHash: string;
        role: 'ADMIN' | 'EMERGENCY_VEHICLE' | 'HOSPITAL' | 'TRAFFIC_CONTROLLER' | 'PUBLIC_USER';
        createdAt: string;
        updatedAt: string;
      };
    }
  }
}

export {};
