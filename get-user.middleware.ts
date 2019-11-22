import { decodeJwt } from './security.utils';
import { Request, Response, NextFunction } from 'express';
import * as moment from 'moment';

/**
 * Verify that JWT passed is legitimate (used for authentication for RESTful API)
 * Can either be bearer auth or as part of a POST
 */
export async function validateJwtRequest(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Get JWT bearer auth (preferred)
  let jwtEnc = undefined;
  const header: string = req.headers['authorization'] as string;
  if (header) {
    const bearer = header.split(' ');
    const token = bearer[1];
    jwtEnc = token;
  }
  if (!jwtEnc) {
    // If that fails, try to get token from POST.
    if (req.method === 'POST' && req.body) {
      jwtEnc = req.body.token;
    } // No longer support GET token passing
  }
  if (!jwtEnc) { // still undefined, then fail
    res.status(401).json({
      status: 401,
      message: 'Missing bearer auth token.'
    });
    return;
  }

  try {
    const jwt = await handleJwtToken(jwtEnc, res);
    // Valid, so continue.
    next();
  } catch (err) {
    res.status(401).json({
      status: 401,
      message: err.message
    });
    console.log( moment().format(), err.message);
  }
}

async function handleJwtToken(jwt: string, res: any) {
  const payload = await decodeJwt(jwt);
  res['user'] = JSON.parse(payload.sub);
  return payload;
}
