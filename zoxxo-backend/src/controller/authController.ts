import { Request, Response } from 'express';
import * as yup from 'yup';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import  Workspace  from '../models/Workspace'; // Assuming these are your Mongoose models
import User from '../models/User'; // Assuming these are your Mongoose models
import { BadRequestException } from '../services/HttpException'; // Custom exception
import { sendEmailVerifcationMail } from '../services/transport'; // Email utility function

// Validation schema
const registerSchema = yup.object({
  fullName: yup.string().min(3).required(),
  username: yup.string().min(1).required(),
  email: yup.string().email().required(),
  password: yup.string().min(8).required(),
});

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    // Validate input data
    const data = await registerSchema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
    });

    // Check for existing username or email
    const existingUser = await User.findOne({
      $or: [{ username: data.username }, { email: data.email }],
    }).lean();

    if (existingUser) {
      throw  BadRequestException(req.t('username-or-email-already-exists'));
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, 10);

    // Create default workspace
    const workspace = new Workspace({ name: 'Default Workspace' });

    // Create user
    const user = await User.create({
      ...data,
      password: hashedPassword,
      workspaces: [workspace._id],
      defaultWorkspace: workspace._id,
      language: req.i18n.language,
    });

    // Associate user with workspace
    await workspace.set('user', user._id).save();

    // Generate JWT token for email verification
    const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET as string);

    // Send verification email
    await sendEmailVerifcationMail({
      link: `${process.env.BACKEND_URL}/auth/email-verification?token=${token}`,
      to: user.email,
      fullName: user.fullName,
    }, req.i18n.language);

    // Send response
    res.status(201).json({
      message: req.t('registration-successful'),
      user: { ...user.toObject(), password: undefined },
    });
  } catch (error: any) {
    if (error instanceof yup.ValidationError) {
      res.status(400).json({ message: error.errors.join(', ') });
    } else {
      res.status(error.status || 500).json({ message: error.message || 'Internal Server Error' });
    }
  }
};

// Usage in router
// authRouter.post('/register', register);


