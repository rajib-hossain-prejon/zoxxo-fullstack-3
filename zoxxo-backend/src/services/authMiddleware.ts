// authMiddleware.ts

import { NextFunction, Response } from 'express';
import jwt, { JsonWebTokenError, Jwt, JwtPayload } from 'jsonwebtoken';

import IRequest from '../interfaces/IRequest';
import { UnauthorizedException } from './HttpException';
import User from '../models/User';

interface ITokenData {
  email: string;
  _id: string;
  language: string;
  isEmailVerified: boolean;
}

export default async function authMiddleware(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const data = jwt.decode(
      req.cookies['zoxxo-token'] || req.headers.authorization || (req.query.token as string) || '',
    ) as JwtPayload & Jwt & void & ITokenData;
    
    req.i18n.changeLanguage(data?.language || 'en');
    
    if (req.query.token) {
      next();
    } else {
      const data = jwt.verify(
        req.cookies['zoxxo-token'] || req.headers.authorization || (req.query.token as string) || '',
        process.env.JWT_SECRET,
      ) as JwtPayload & ITokenData;
      
      if (!data.isEmailVerified)
        throw UnauthorizedException(req.t('email-is-not-verified'));
      
      const user = await User.findById(data._id).select('isAdmin isSuperAdmin');
      
      if (!user) {
        throw UnauthorizedException(req.t('user-not-found'));
      }
      
      req.user = {
        _id: data._id,
        email: data.email,
        isAdmin: user.isAdmin,
        isSuperAdmin: user.isSuperAdmin,
      };
      
      next();
    }
  } catch (e: any) {
    console.log(e)
    if (e instanceof JsonWebTokenError) {
      return res.status(401).json({ message: req.t('unauthorized') });
    } else return res.status(e.status || 500).json({ message: e.message });
  }
}