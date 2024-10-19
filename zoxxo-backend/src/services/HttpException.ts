import { JsonWebTokenError } from 'jsonwebtoken';
import { MongooseError } from 'mongoose';
import { MulterError } from 'multer';
import { ValidationError } from 'yup';

// export default class HttpException extends Error {
//   public status: number = 400;
//   public message: string = '';
//   public errorCode: string;

//   constructor(status: number, message: string, errorCode?: string) {
//     super(message);
//     this.status = status;
//     this.message = message;
//     this.errorCode = errorCode;
//   }
// }

// export function NotFoundExeption(message: string, errorCode?: string) {
//   return new HttpException(404, message, errorCode);
// }

// export function BadRequestException(message: string, errorCode?: string) {
//   return new HttpException(400, message, errorCode);
// }

// export function UnauthorizedException(message: string, errorCode?: string) {
//   return new HttpException(401, message, errorCode);
// }

// export function InternalServerException(message: string, errorCode?: string) {
//   return new HttpException(500, message, errorCode);
// }


 

export default class HttpException extends Error {
  public status: number;
  public message: string;
  public errorCode: string;
  public errors?: any;

  constructor(status: number, message: string, errorCode: string = 'UNKNOWN_ERROR', errors?: any) {
    super(message);
    this.status = status;
    this.message = message;
    this.errorCode = errorCode;
    this.errors = errors;
  }
}

export function NotFoundExeption(message: string, errorCode?: string) {
  return new HttpException(404, message, errorCode || 'NOT_FOUND');
}

export function BadRequestException(message: string, errorCode?: string) {
  return new HttpException(400, message, errorCode || 'BAD_REQUEST');
}

export function UnauthorizedException(message: string, errorCode?: string) {
  return new HttpException(401, message, errorCode || 'UNAUTHORIZED');
}

export function InternalServerException(message: string, errorCode?: string, errors?: any) {
  return new HttpException(500, message, errorCode || 'INTERNAL_SERVER_ERROR', errors);
}


export function JwtException(error: JsonWebTokenError) {
  return new HttpException(401, error.message, 'JWT_ERROR');
}

 
export function MongooseException(error: MongooseError) {
  return new HttpException(500, error.message, 'MONGOOSE_ERROR', error);
}

 
export function MulterException(error: MulterError) {
  return new HttpException(400, error.message, 'MULTER_ERROR');
}
 
export function ValidationException(error: ValidationError) {
  return new HttpException(400, error.message, 'VALIDATION_ERROR', error.errors);
}

export function resolveStatus(error: any): number {
  if (error.status) return error.status as number;

  if (error instanceof MulterError) return 415;  
  if (error instanceof ValidationError) return 400;  
  if (error instanceof JsonWebTokenError) return 401;  
  if (error instanceof MongooseError) return 500;  

  // Custom error code handling
  if (error.name === 'CastError') return 400;  
  if (error.name === 'DocumentNotFoundError') return 404; // Not Found for missing documents

  return 500;  
}