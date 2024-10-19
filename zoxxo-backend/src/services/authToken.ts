import { Request } from "express";

export default function authToken(req: Request): string {
  let token: string = req.cookies['zoxxo-token'];
  if (token && token.length > 10) return token;
  token = req.headers.authorization;
  if (token && token.length > 10) return token;
  token = (req.query.token || '').toString();
  if (token && token.length > 10) return token;
  return '';
}