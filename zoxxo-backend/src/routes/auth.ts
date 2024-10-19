// Node Js Imports

// Internal Imports
import User from '../models/User';
import HttpException, {
  BadRequestException,
  NotFoundExeption,
  UnauthorizedException,
  resolveStatus,
} from '../services/HttpException';
import Workspace from '../models/Workspace';
import {
  sendEmailVerifcationMail,
  sendNewAccountMail,
  sendPasswordResetMail,
} from '../services/transport';

// Third Party Imports
import { Request, Response, Router } from 'express';
import * as yup from 'yup';
import bcrypt from 'bcrypt';
import jwt, { TokenExpiredError } from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import moment from 'moment';

// Create an Express router instance
const authRouter = Router();


// Function to configure authentication cookie options
const getAuthCookieConfig = (options?: {
  domain?: string;
  maxAge?: number;
  expires?: Date;
}) => ({
  maxAge: options?.maxAge || 24 * 60 * 60 * 1000, // 24 hours
  domain: options?.domain || '.zoxxo.io',
  expires: options?.expires,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as boolean | 'none' | 'strict' | 'lax',
});

//@desc Check user authentication and return user data
//@route GET /api/auth
//@access Private
authRouter.get('/', async (req: Request, res: Response) => {
  let user;
  try {
    // Extract token from cookies or authorization header
    const token = req.cookies['zoxxo-token'] || req.headers.authorization?.split(' ')[1];
    if (!token) {
      throw UnauthorizedException(req.t('unauthorized'));
    }

    // Verify JWT token
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET) as {
      _id: string;
      email: string;
    };

    // Fetch user data
    user = await User.findById(decodedToken._id).populate({
      path: 'workspaces',
      populate: {
        path: 'uploads',
        match: { isValid: true },
      },
    });

    if (!user) {
      throw UnauthorizedException(req.t('user-not-found'));
    }

    // Check and handle user subscription downgrade
    await handleUserDowngrade(user);

    // Send user data (excluding password)
    res.json({ ...user.toObject(), password: undefined });

  } catch (error: any) {
    if (error instanceof TokenExpiredError) {
      handleTokenExpiredError(req, res);
    } else {
      const status = error instanceof HttpException ? error.status : 500;
      res.status(status).json({ message: error.message });
    }
  }
});

// Helper function to handle token expiration
const handleTokenExpiredError = (req: Request, res: Response) => {
  res.status(401).json({ message: req.t('login-session-expired') });
  const cookieOptions = getAuthCookieConfig({
    maxAge: 0,
    expires: new Date(0),
  });
  res.clearCookie('zoxxo-token', cookieOptions);

  if (process.env.NODE_ENV !== 'production') {
    res.clearCookie('zoxxo-token', { ...cookieOptions, domain: 'localhost' });
  }
};

// Helper function to handle user subscription downgrade
const handleUserDowngrade = async (user: any) => {
  const isDowngradingOver = moment(user?.subscription?.downgradesAt, 'DD-MM-YYYY').isBefore(moment());
  if (isDowngradingOver) {
    await User.findByIdAndUpdate(
      user.id,
      {
        $set: {
          maxWorkspaces: 1,
          storageSizeInBytes: 4 * 1000 * 1000 * 1000, // 4GB
          subscription: {
            status: 'canceled',
            // isEligibleForProratedDiscount: false, // this will be uncommented in next release
          },
        },
      },
      { new: true }
    );
  }
};
//@desc Authenticate user & get token
//@route POST /api/auth/login
//@access Public
authRouter.post('/login', async (req: Request, res: Response) => {
  const loginSchema = yup.object({
    email: yup
      .string()
      .email(req.t('invalid-email'))
      .required(req.t('email-is-required')),
    password: yup
      .string()
      .min(8, req.t('password-should-be-at-least-8-characters-long'))
      .required(req.t('password-is-required')),
  });

  try {
    // Validate request body
    const data = await loginSchema.validateSync(req.body, {
      abortEarly: true,
      stripUnknown: true,
    });

    // Find user by email
    const user = await User.findOne({ email: data.email }).populate({
      path: 'workspaces',
      populate: {
        path: 'uploads',
        match: { isValid: true },
      },
    });

    if (!user) {
      throw UnauthorizedException(req.t('user-not-found'));
    }

    // Check password
    if (!bcrypt.compareSync(data.password, user.password)) {
      throw UnauthorizedException(req.t('incorrect-password'));
    }

    // Check if email is verified
    if (!user.isEmailVerified) {
      throw UnauthorizedException(req.t('email-is-not-verified'), 'EMAIL_NOT_VERIFIED');
    }

    // Generate JWT token
    const payload = {
      email: user.email,
      _id: user._id,
      language: user.language,
      isEmailVerified: user.isEmailVerified,
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET || '', {
      expiresIn: '24h',
    });

    // Set cookies
    res.cookie('zoxxo-token', token, getAuthCookieConfig({}));
    if (process.env.NODE_ENV !== 'production') {
      res.cookie(
        'zoxxo-token',
        token,
        getAuthCookieConfig({ domain: 'localhost' }),
      );
    }

    // Send response
    res.json({ ...user.toObject(), token: undefined, password: undefined });

  } catch (e: any) {
    res.status(e.status || 400).json({ message: e.message, errorCode: e.errorCode });
  }
});

//@desc Register a new user
//@route POST /api/auth/register
//@access Public
authRouter.post('/register', async (req: Request, res: Response) => {
  const registerSchema = yup.object({
    fullName: yup
      .string()
      .min(3, req.t('name-or-company-too-short-enter-at-least-3-characters'))
      .required(req.t('name-or-company-is-required')),
    username: yup
      .string()
      .min(1, req.t('username-too-short-enter-at-least-1-character'))
      .required(req.t('username-is-required')),
    email: yup
      .string()
      .email(req.t('enter-a-valid-email'))
      .required(req.t('email-is-required')),
    password: yup
      .string()
      .min(8, req.t('password-too-short-enter-at-least-8-characters'))
      .required(req.t('password-is-required')),
  });

  try {
    // Validate request body
    const data = await registerSchema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
    });

    // Check if username or zoxxoUrl already exists
    const existingUser = await User.findOne({
      $or: [{ zoxxoUrl: data.username }, { username: data.username }]
    }).lean();

    if (existingUser) {
      throw BadRequestException(req.t('username-already-exists'));
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, 10);

    // Create default workspace
    const workspace = new Workspace({
      name: 'Default Workspace',
    });

    // Create user
    const user = await User.create({
      ...data,
      workspaces: [workspace._id],
      password: hashedPassword,
      defaultWorkspace: workspace._id,
      language: req.i18n.language,
    });

    // Associate workspace with user
    await workspace.set('user', user._id).save();

    // Generate email verification token
    const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET);

    // Send email verification
    try {
      await sendEmailVerifcationMail(
        {
          link: `${process.env.BACKEND_URL}/auth/email-verification?token=${token}`,
          to: user.email,
          fullName: user.fullName,
        },
        req.i18n.language,
      );
    } catch (emailError) {
      console.error('Failed to send verification email:', emailError);
      // Don't delete the user, but inform the client about the email issue
      return res.status(201).json({ 
        message: req.t('user-registered-but-failed-to-send-verification-email'),
        user: { ...user.toObject(), password: undefined } 
      });
    }

     // Send success response
     res.status(201).json({ 
      message: req.t('user-registered-successfully'),
      user: { ...user.toObject(), password: undefined } 
    });

  } catch (e: any) {
    if (e.code === 11000) {
      res.status(400).json({ message: req.t('username-or-email-already-exists') });
    } else {
      res.status(e.status || 400).json({ message: e.message });
    }
  }
});  

//@desc Verify user's email
//@route GET /api/auth/email-verification
//@access Public
authRouter.get('/email-verification', async (req: Request, res: Response) => {
  try {
    // Extract token from query parameters
    const token = req.query.token?.toString();
    
    if (!token) {
      throw BadRequestException(req.t('missing-verification-token'));
    }

    // Verify the JWT token
    let decodedToken;
    try {
      decodedToken = jwt.verify(token, process.env.JWT_SECRET) as { email: string };
    } catch (error) {
      throw UnauthorizedException(req.t('invalid-or-expired-token'));
    }

    // Find and update the user's email verification status
    const user = await User.findOneAndUpdate(
      { email: decodedToken.email },
      { $set: { isEmailVerified: true } },
      { new: true }
    );

    if (!user) {
      throw NotFoundExeption(req.t('user-not-found'));
    }

    // Send welcome email
    await sendNewAccountMail(
      {
        link: `${process.env.FRONTEND_URL}/signin`,
        to: user.email,
        fullName: user.fullName,
      },
      req.i18n.language
    );

    // Redirect to frontend with success parameter
    res.redirect(`${process.env.FRONTEND_URL}/signin?isEmailVerified=true`);

  } catch (error: any) {
    console.error('Email verification error:', error);

    // Handle different types of errors
    if (error instanceof HttpException) {
      res.status(error.status).json({ message: error.message });
    } else {
      res.status(500).json({ message: req.t('internal-server-error') });
    }
  }
});











authRouter.post('/google-login', async (req: Request, res: Response) => {
  try {
    const authCode = req.query.authCode;

    console.log(authCode);

    if (!authCode)
      throw BadRequestException(req.t('invalid-auth-code-in-query'));
    const client = new OAuth2Client({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: 'postmessage', // DO NOT PUT (http://local...), issue fixed from https://stackoverflow.com/a/48121098/1389981
    });
    const { tokens } = await client.getToken(authCode as string);
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token || '',
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const foundUser = await User.findOne({ email: payload.email }).populate({
      // populate workspaces and uploads so that they are iterable on frontend
      path: 'workspaces',
      populate: {
        path: 'uploads',
        match: { isValid: true },
      },
    });
    let user;
    if (foundUser) {
      user = foundUser;
    } else {
      // create a default workspace
      const workspace = new Workspace({
        name: 'Default Workspace',
      });
      user = await User.create({
        email: payload.email,
        fullName: payload.name,
        username: payload.email.split('@')[0]+Date.now(),
        password: Math.random().toString(),
        workspaces: [workspace._id.toString()],
        defaultWorkspace: workspace._id,
        isEmailVerified: true,
        language: req.i18n.language,
      });
      await workspace.set('user', user._id).save();
      // populate workspaces so that uploads are iterable in frontend
      user = await User.findById(user.id).populate({
        path: 'workspaces',
        populate: {
          path: 'uploads',
          match: { isValid: true },
        },
      });
      sendNewAccountMail(
        {
          link: `${process.env.FRONTEND_URL}/signin`,
          to: user.email,
          fullName: user.fullName,
        },
        req.i18n.language,
      );
    }
    const jwtPayload = {
      email: user.email,
      _id: user._id,
      language: user.language,
      isEmailVerified: user.isEmailVerified,
    };
    const token = jwt.sign(jwtPayload, process.env.JWT_SECRET || '', {
      expiresIn: '24h',
    });
    res.cookie('zoxxo-token', token, getAuthCookieConfig({}));
    if (process.env.NODE_ENV !== 'production') {
      res.cookie(
        'zoxxo-token',
        token,
        getAuthCookieConfig({ domain: 'localhost' }),
      );
    }
    res.json({ ...user.toObject(), token: undefined, password: undefined });
  } catch (e: any) {
    console.log(e);
    res
      .status(resolveStatus(e))
      .json({ message: req.t('error-occured-while-processing-google-login'), errorCode: e.errorCode });
  }
});


//@desc Logout user
//@route GET /api/auth/logout
//@access Public
authRouter.get('/logout', async (req: Request, res: Response) => {
  try {
    // Clear the authentication cookie
    const cookieOptions = getAuthCookieConfig({
      maxAge: 0,
      expires: new Date(0),
    });

    res.clearCookie('zoxxo-token', cookieOptions);

    // Clear cookie for non-production environments (e.g., localhost)
    if (process.env.NODE_ENV !== 'production') {
      res.clearCookie('zoxxo-token', {
        ...cookieOptions,
        domain: 'localhost',
      });
    }

    // Send success response
    res.status(200).json({ message: req.t('logout-successful') });
  } catch (error: any) {
    console.error('Logout error:', error);
    res.status(500).json({ message: req.t('internal-server-error') });
  }
});








//@desc forgot password
//@route POST /api/auth/forgot-password
//@access Public
authRouter.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    yup
      .string()
      .email(req.t('invalid-email'))
      .required(req.t('email-is-required'))
      .validateSync(email);
    const user = await User.findOne().where('email', email).lean();
    if (!user) throw NotFoundExeption(req.t('user-not-found'));
    const token = jwt.sign({ email, _id: user._id }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });
    sendPasswordResetMail(
      {
        to: email,
        fullName: user.fullName,
        link: `${process.env.FRONTEND_URL}/password-reset?token=${token}`,
      },
      req.i18n.language,
    );
    res.json({ success: req.t('reset-email-is-sent') });
  } catch (e: any) {
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});






//@desc Reset password
//@route POST /api/auth/reset-password
//@access Public
authRouter.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { newPassword, token } = req.body;


    console.log('Np: ',newPassword);
    console.log('Token:',token);

    // Validate password length
    if (!newPassword || newPassword.length < 8) {
      throw BadRequestException(req.t('new-password-should-be-at-least-8-characters-long'));
    }

    // Validate token presence
    if (!token) {
      throw BadRequestException(req.t('invalid-request'));
    }

    // Verify the JWT token
    const data = jwt.verify(token, process.env.JWT_SECRET) as { email: string; _id: string };

    // Find the user by ID
    const user = await User.findById(data._id).lean();

    // Check if the user exists and the email matches
    if (!user || data.email !== user.email) {
      throw BadRequestException(req.t('invalid-request'));
    }

    // Hash the new password
    const hashedPassword = bcrypt.hashSync(newPassword, bcrypt.genSaltSync(10));

    // Update the user's password
    await User.findByIdAndUpdate(data._id, {
      $set: { password: hashedPassword },
    });

    // Respond with success
    res.json({ success: req.t('password-reset-successfully') });
  } catch (e: any) {
    console.error('Error during password reset:', e);
    res.status(resolveStatus(e)).json({ message: req.t('password-reset-failed') });
  }
});








//@desc Resend email verification mail
//@route POST /api/auth/resend-email-verification-mail
//@access Public
authRouter.post('/resend-email-verification-mail', async (req: Request, res: Response) => {
  try {
    // Validate email input
    const { email } = req.body;
    await yup
      .string()
      .email(req.t('invalid-email'))
      .required(req.t('email-is-required'))
      .validate(email);

    // Find user by email
    const user = await User.findOne({ email }).lean();
    if (!user) {
      throw NotFoundExeption(req.t('user-not-found'));
    }

    // Check if email is already verified
    if (user.isEmailVerified) {
      return res.status(400).json({ message: req.t('email-already-verified') });
    }

    // Generate new email verification token
    const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET, { expiresIn: '24h' });

    // Send new verification email
    await sendEmailVerifcationMail(
      {
        link: `${process.env.BACKEND_URL}/auth/email-verification?token=${token}`,
        to: user.email,
        fullName: user.fullName,
      },
      req.i18n.language,
    );

    // Send success response
    res.json({ success: req.t('verification-email-resent') });

  } catch (error: any) {
    if (error instanceof yup.ValidationError) {
      res.status(400).json({ message: error.message });
    } else if (error instanceof HttpException) {
      res.status(error.status).json({ message: error.message });
    } else {
      console.error('Resend verification email error:', error);
      res.status(500).json({ message: req.t('internal-server-error') });
    }
  }
  
});

export default authRouter;
