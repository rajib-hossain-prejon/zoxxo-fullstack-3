import { populate } from 'dotenv';

import { Router, Response, NextFunction } from 'express';
import * as yup from 'yup';
import Stripe from 'stripe';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import mongoose from 'mongoose';
import IRequest from '../../interfaces/IRequest';
import { createInvoice } from '../../services/stripe';
import {
  BadRequestException,
  InternalServerException,
  NotFoundExeption,
  resolveStatus,
} from '../../services/HttpException';
import User from '../../models/User';
import workspacesRouter from './workspaces';
import { calculatePrice } from '../../services/calculatePrice';
import {
  cancelSubscription,
  createSubscriptionPlan,
  getSubscription,
} from '../../services/paypal';
import { sendEmailChangeMail } from '../../services/transport';
import storage from '../../services/google-cloud-storage';
import { File } from '@google-cloud/storage';
import { getProductId } from '../../services/stripe';
import { IUpload } from '../../interfaces/IUpload';
import { encrypt } from '../../services/encryption';
import campaignsRouter from './campaigns';
import Invoice from '../../models/Invoice';
import moment from 'moment';
import zoxxoLogoUri from '../../services/zoxxoLogoUri';
import Upload from '../../models/Upload';
import Workspace from '../../models/Workspace';
import { Variables } from '../../utils/variables';
import MonetizationModel from '../../models/Monetization';

// Stripe initialization
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-08-16',
});

// Router initialization
const usersRouter = Router();

// Helper function to handle user not found scenario
const getUserOrThrow = async (userId: string, req: IRequest) => {
  const user = await User.findById(userId);
  if (!user) throw NotFoundExeption(req.t('user-not-found'));
  return user;
};




usersRouter.use(
  '/workspaces',
  async (req: IRequest, res: Response, next: NextFunction) => {
    console.log(req,'request')
    // middleware for checking subscription status
    try {
      const user = await User.findById(req.user._id).populate({
        path: 'workspaces',
        populate: {
          path: 'uploads',
          match: { isValid: true },
        },
      });
      // when user's subscription invoice is not paid
      // or subscription is canceled and user's storage consumed is greater than 4GB
      // the user should be restricted to perform any update operation
      // he should only be able to see and delete the workspaces or uploads
      if (
        ['active', 'downgrading', 'trialing'].includes(
          user.subscription.status,
        ) &&
        user.subscription.type
      ) {
        const allUploads = user.workspaces.reduce<IUpload[]>(
          (acc = [], curr) => [...acc, ...curr.uploads],
          [],
        );
        const totalSizeConsumed = allUploads.reduce(
          (sum = 0, curr) => sum + curr.sizeInBytes,
          0,
        );
        if (
          totalSizeConsumed > user.storageSizeInBytes &&
          ['post', 'put'].includes(req.method.toLocaleLowerCase())
        ) {
          throw BadRequestException(
            'Storage is full. Please delete your files to free limit of 4 GB',
          );
        }
      }
      next();
    } catch (e: any) {
      res.status(resolveStatus(e)).json({ message: e.message });
    }
  },
  workspacesRouter,
);

usersRouter.use('/campaigns', campaignsRouter);

//@desc Update user's username
//@route POST /api/users/username
//@access Private
usersRouter.post('/username', async (req: IRequest, res: Response) => {
  const usernameSchema = yup
    .string()
    .min(1, req.t('username-too-short-enter-at-least-1-character'))
    .required(req.t('username-is-required'));

  try {
    // Validate the username
    const username = await usernameSchema.validate(req.body.username);


    console.log(req.body.username);

    // Check if the username is already taken
    const existingUser = await User.findOne({
      $or: [{ zoxxoUrl: username }, { username }],
      _id: { $ne: req.user._id }
    }).lean();

    if (existingUser) {
      throw BadRequestException(req.t('username-already-exists'));
    }

    // Update the user's username
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { username, zoxxoUrl: username } },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      throw NotFoundExeption(req.t('user-not-found'));
    }

    res.json({ username: updatedUser.username });

  } catch (error: any) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: req.t('invalid-request') });
    } else {
      console.error('Username update error:', error);
      const status = resolveStatus(error);
      res.status(status).json({ 
        message: error.message || req.t('internal-server-error')
      });
    }
  }
});


//@desc Update user's Zoxxo URL
//@route POST /api/users/zoxxo-url
//@access Private
usersRouter.post('/zoxxo-url', async (req: IRequest, res: Response) => {
  const zoxxoUrlSchema = yup.object({
    zoxxoUrl: yup.string().required(req.t('invalid-value-for-url')),
  });

  try {
    // Validate request body
    const { zoxxoUrl } = await zoxxoUrlSchema.validate(req.body, { abortEarly: true });

    // Check if zoxxoUrl or username already exists
    const existingUser = await User.findOne({
      $or: [
        { zoxxoUrl },
        { username: zoxxoUrl }
      ],
      _id: { $ne: req.user._id }
    });

    if (existingUser) {
      throw BadRequestException(req.t('url-already-exists'));
    }

    // Update user's zoxxoUrl
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { zoxxoUrl },
      { new: true }
    );

    if (!user) throw NotFoundExeption(req.t('user-not-found'));

    // Send updated zoxxoUrl as response
    res.json({ zoxxoUrl: user.zoxxoUrl });
  } catch (error: any) {
    // Handle validation errors
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: error.errors.join(', ') });
    } else if (error.code === 11000) {
      // Handle duplicate key errors
      res.status(400).json({ message: req.t('url-already-exists') });
    } else {
      // Handle other errors
      res.status(error.status || 500).json({ message: error.message });
    }
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2 MB
  },
});
usersRouter.post(
  '/avatar',
  upload.single('avatar'),
  async (req: IRequest, res: Response, next: NextFunction) => {
    let oldFile: File;
    try {
      if (!req.file) throw BadRequestException(req.t('no-file-supplied'));
      if (req.body.color && req.body.color.length > 6)
        throw BadRequestException(req.t('invalid-color-hex-value-should-be-6-characters'));

      const user = await User.findById(req.user._id);
      if (!user) throw NotFoundExeption(req.t('user-not-found'));

      const { originalname, buffer, mimetype } = req.file;
      if (!['image/png', 'image/jpg', 'image/jpeg'].includes(mimetype))
        throw BadRequestException(req.t('file-type-should-be-png-jpg-or-jpeg'));

      if (user.avatar) oldFile = storage.bucket(Variables.publicBucket).file(user.avatar);

      const filename = crypto.randomUUID().slice(0, 18) + '---' + originalname;
      const gFile = storage.bucket(Variables.publicBucket).file(filename);

      const stream = gFile.createWriteStream({
        metadata: {
          contentType: mimetype,
        },
      });

      // Set up stream events before ending the stream
      stream.on('error', (err) => {
        return next(InternalServerException(req.t('error-occurred-file-uploading-file')));
      });

      stream.on('finish', async () => {
        try {
          await user.updateOne({
            $set: {
              avatar: gFile.name,
            },
          }, { new: true });

          // Send response only when everything completes
          res.json(user);
        } catch (error) {
          return next(error);  // Pass any update error to the error handler
        }
      });

     
      stream.end(buffer);
    } catch (e: any) {
      return next(e);  
    } finally {
      try {
        if (await oldFile?.exists()) oldFile.delete();
      } catch (e) {
        console.error(e);  
      }
    }
  },
);
//@desc Update user's language preference
//@route POST /api/users/language
//@access Private
usersRouter.post('/language', async (req: IRequest, res: Response) => {
  const languageSchema = yup.object({
    language: yup.string().required(req.t('language-not-supplied')),
  });

  try {
    // Validate request body
    const { language } = await languageSchema.validate(req.body, { abortEarly: true });

    // Update user's language preference
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { language },
      { new: true }
    );

    if (!user) throw NotFoundExeption(req.t('user-not-found'));

    // Prepare payload for new JWT token
    const payload = {
      email: user.email,
      _id: user._id,
      language: user.language,
      isEmailVerified: user.isEmailVerified,
    };

    // Generate new JWT token with updated language
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });

    // Set new token in cookie
    res.cookie('zoxxo-token', token, {
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: process.env.NODE_ENV === 'production' ? '.zoxxo.io' : 'localhost',
    });

    // Send updated user object as response
    res.json(user.toObject());
  } catch (error: any) {
    // Handle validation errors
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: error.errors.join(', ') });
    } else {
      // Handle other errors
      res.status(error.status || 500).json({ message: error.message });
    }
  }
});

usersRouter.post('/default-workspace', async (req: IRequest, res: Response) => {
  try {
    const ws = req.body.defaultWorkspace;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          defaultWorkspace: ws,
        },
      },
      { new: true },
    );
    res.json(user.toObject());
  } catch (e: any) {
    res
      .status(resolveStatus(e))
      .json({ message: req.t('invalid-id-or-server-error') });
  }
});


//@desc Change user's password
//@route POST /api/users/password
//@access Private
usersRouter.post('/password', async (req: IRequest, res: Response) => {
  const changePasswordSchema = yup.object({
    oldPassword: yup.string().min(8, req.t('invalid-old-password-enter-at-least-8-characters')).required(),
    newPassword: yup.string().min(8, req.t('invalid-new-password-enter-at-least-8-characters')).required(),
  });

  try {
    // Validate request body
    const { oldPassword, newPassword } = await changePasswordSchema.validate(req.body, { abortEarly: true });
    
    // Fetch user from database
    const user = await getUserOrThrow(req.user._id, req);

    // Verify old password
    if (!bcrypt.compareSync(oldPassword, user.password)) {
      throw BadRequestException(req.t('incorrect-old-password'));
    }

    // Hash new password
    const newHashedPassword = bcrypt.hashSync(newPassword, 10);

    // Update user's password in database
    await User.findByIdAndUpdate(req.user._id, { password: newHashedPassword });

    // Send success response
    res.json({ message: req.t('password-updated-successfully') });
  } catch (error: any) {
    // Handle validation errors
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: error.errors.join(', ') });
    } else {
      // Handle other errors
      res.status(error.status || 500).json({ message: error.message });
    }
  }
});

/*
  Required objects and fields:
    Request: body.email, body.password, user._id, i18n
    User: password, email, _id, fullName
*/
//@desc Initiate email change process
//@route POST /api/users/email
//@access Private
usersRouter.post('/email', async (req: IRequest, res: Response) => {
  const changeEmailSchema = yup.object({
    password: yup.string().min(8, req.t('invalid-password-enter-at-least-8-characters')).required(),
    email: yup.string().email(req.t('enter-a-valid-email')).required(),
  });

  try {
    // Validate request body
    const { password, email } = await changeEmailSchema.validate(req.body, { abortEarly: true });
    
    // Fetch user from database
    const user = await getUserOrThrow(req.user._id, req);

    // Verify provided password
    if (!bcrypt.compareSync(password, user.password)) {
      throw BadRequestException(req.t('incorrect-password'));
    }

    // Check if email is already in use
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw BadRequestException(req.t('email-already-exists'));
    }

    // Generate JWT token for email change confirmation
    const token = jwt.sign({ email, userId: req.user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    
    // Send email change confirmation email
    await sendEmailChangeMail({
      fullName: user.fullName,
      link: `${process.env.BACKEND_URL}/users/change-email?token=${token}`,
      to: email,
    }, req.i18n.language);

    // Send success response
    res.json({ message: req.t('email-change-confirmation-sent') });
  } catch (error: any) {
    // Handle validation errors
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: error.errors.join(', ') });
    } else {
      // Handle other errors
      res.status(error.status || 500).json({ message: error.message });
    }
  }
});

//@desc Confirm email change
//@route GET /api/users/change-email
//@access Public
usersRouter.get('/change-email', async (req: IRequest, res: Response) => {
  try {
    // Extract token from query parameters
    const { token } = req.query;
    
    // Validate token
    if (!token || typeof token !== 'string') {
      throw BadRequestException(req.t('invalid-token'));
    }

    // Verify and decode JWT token
    const { email, userId } = jwt.verify(token, process.env.JWT_SECRET) as { email: string; userId: string };

    // Update user's email in database
    await User.findByIdAndUpdate(userId, { email });

    // Redirect to frontend with success parameter
    res.redirect(`${process.env.FRONTEND_URL}/signin?emailChanged=true`);
  } catch (error: any) {
    // Log error and redirect to frontend with error parameter
    console.error('Email change error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/signin?emailChangeError=true`);
  }
});

usersRouter.post('/billing', async (req: IRequest, res: Response) => {
  const billingDetailsSchema = yup.object({
    name: yup.string().trim().required(req.t('name-or-company-is-required')),
    address: yup.string().trim().required(req.t('address-is-required')),
    postalCode: yup
      .string()
      .trim()
      .matches(/^[\w\d\s-]+$/, req.t('invalid-postal-code'))
      .required(req.t('postal-code-is-required')),
    city: yup.string().trim().required(req.t('city-is-required')),
    country: yup.string().trim().required(req.t('country-is-required')),
    vatNumber: yup.string().trim().nullable().optional(),
  });
  try {
    const data = billingDetailsSchema.validateSync(req.body, {
      abortEarly: true,
      stripUnknown: true,
    });
    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          billing: data,
        },
      },
      { new: true },
    );
    res.json(user.toObject());
  } catch (e: any) {
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});



 
 

usersRouter.post('/payment-method', async (req: IRequest, res: Response) => {
  const paymentMethodSchema = yup.object().shape({
    service: yup
      .string()
      .required(req.t('service-is-required'))
      .oneOf(['stripe', 'paypal'], req.t('invalid-service')),
    stripeCardData: yup.object().when('service', {
      is: 'stripe',
      then: () =>
        yup.object().shape({
          stripeId: yup.string().required(req.t('stripe-id-is-required')),
          nameOnCard: yup.string().required(req.t('name-on-card-is-required')),
          brand: yup
            .string()
            .required(req.t('card-brand-is-required'))
            .oneOf(['visa', 'mastercard'], req.t('invalid-card-brand')),
          last4: yup
            .string()
            .required(req.t('last-4-digits-are-required'))
            .matches(/^\d{4}$/, req.t('invalid-last-4-digits-format')),
        }),
      otherwise: () => yup.object().notRequired(),
    }),
  });
  try {
    // validate data
    const data = paymentMethodSchema.validateSync(req.body, {
      abortEarly: true,
      stripUnknown: true,
    });
    let user = await User.findById(req.user._id);
    
    if (data.service === 'paypal') {
      user = await User.findByIdAndUpdate(
        req.user._id,
        {
          $set: {
            paymentMethod: {
              service: 'paypal',
            },
          },
        },
        { new: true },
      );
      res.json(user);
    } else {
      const PaymentId=(data.stripeCardData as any).stripeId;
      let customerId = '';
      if (user.paymentMethod?.stripeCustomerId)
        customerId = user.paymentMethod.stripeCustomerId;
      else {
         const customer = await stripe.customers.create({
          name: user.fullName,
          email: user.email,
          metadata: {
            zoxxoId: user.id,
          },
        });
        customerId = customer.id;
      }
      const intent = await stripe.paymentIntents.create({
        amount: 100,
        currency: 'usd',
        customer: customerId,
        confirm: true, // charge customer immediately
        statement_descriptor: 'Zoxxo Test Charge',
        payment_method: (data.stripeCardData as any).stripeId,
        return_url: process.env.BACKEND_URL + '/redirect',
        metadata: {
          userId: user.id,
          customerId,
        },
        setup_future_usage: 'off_session',  
      });
      await stripe.paymentMethods.attach(PaymentId, { customer: customerId });

       
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: PaymentId },
      });
  
      console.log((data.stripeCardData as any).stripeId,PaymentId,'(data.stripeCardData as any).stripeId')
      user = await User.findByIdAndUpdate(
        req.user._id,
        {
          $set: {
            paymentMethod: {
              ...data,
              stripeCustomerId: customerId,
              PaymentId:PaymentId,
              status: intent.status, 
              verificationLink:
                intent.status === 'requires_action'
                  ? intent.next_action.redirect_to_url.url
                  : undefined,
            },
          },
        },
        { new: true },
      );
      res.json(user);
    }
  } catch (e: any) {
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});

usersRouter.post('/subscription', async (req: IRequest, res: Response) => {
  const newPlanSchema = yup.object({
    extraStorage: yup
      .number()
      .integer(req.t('enter-an-integer-for-storage'))
      .notRequired()
      .default(0),
    extraWorkspaces: yup
      .number()
      .integer(req.t('enter-an-integer-for-workspaces'))
      .notRequired()
      .default(0),
    subscription: yup
      .string()
      .oneOf(
        ['monthly', 'yearly'],
        req.t('subscription-is-invalid-should-be-monthly-or-yearly'),
      )
      .required(req.t('subscription-is-required')),
  });
  try {
    const data = newPlanSchema.validateSync(req.body, {
      abortEarly: true,
      stripUnknown: true,
    });
    let user = await User.findById(req.user._id);
    if (!user) throw NotFoundExeption(req.t('user-not-found'));
    if (!user.paymentMethod?.service)
      throw BadRequestException(req.t('payment-method-is-not-setup'));
    if (user.paymentMethod?.service === 'stripe') {
      if (
        user.paymentMethod.status === 'canceled' ||
        user.paymentMethod.status === 'payment-failed'
      )
        throw BadRequestException(
          req.t('provided-payment-method-is-not-verified-try-some-other-method'),
        );   
      else if(!user.paymentMethod.stripeCustomerId) throw  BadRequestException(req.t('payment-method-is-not-setup'));

      else if (user.paymentMethod.status === 'processing')
        throw BadRequestException(
          req.t('provided-payment-method-is-under-verification'),
        );
      else if (user.paymentMethod.status === 'requires-action')
        throw BadRequestException(
          req.t(
            'provided-payment-method-needs-your-authorization-for-verification-please-check-your-email',
          ),
        );
    }
    if (user.subscription?.type && user.subscription?.status === 'active')
      throw BadRequestException(
        req.t('cannot-resubscribe-cancel-current-subscription'),
      );
    if (!user.billing?.name)
      throw BadRequestException(req.t('billing-details-not-setup'));

  
    const priceData = calculatePrice({
      extraStorage: data.extraStorage,
      extraWorkspaces: data.extraWorkspaces,
      subscription: data.subscription,
    });
    let subscriptionId = ''; //
    let invoiceLink = '';
    let planId = '';  
    try {
      if (user.paymentMethod.service === 'paypal') {
         const discount = user.subscription.isEligibleForProratedDiscount
          ? priceData.proratedDiscount
          : 0;
        const planData: any = await createSubscriptionPlan({
          extraStorage: data.extraStorage,
          extraWorkspaces: data.extraWorkspaces,
          subscription: data.subscription,
          totalPrice: priceData.total,
          proratedDiscount: discount,
        });
        planId = planData.id;
         subscriptionId = encrypt(user.id);
      } else {
       
     
        const customerId = user.paymentMethod?.stripeCustomerId || '';
       
       
        const productId = await getProductId({
          extraStorage: data.extraStorage,
          extraWorkspaces: data.extraWorkspaces,
          subscription: data.subscription,
        });
      
      const totalAmount = Number.isFinite(priceData.total) ? priceData.total : 0;
 
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        description: `Tornado ${data.subscription} plan; extra ${data.extraStorage} TB and ${data.extraWorkspaces} WS`,
        items: [
          {
            price_data: {
              currency: 'usd',
              product: productId,
              unit_amount: Math.floor(totalAmount * 100),  
              recurring: {
                interval: data.subscription === 'monthly' ? 'month' : 'year',
                interval_count: 1,
              },
            },
          },
        ],
        collection_method: 'charge_automatically',
        payment_behavior: 'allow_incomplete',
        payment_settings: {
          payment_method_types: ['card'],
        },
        expand: ['latest_invoice'],
        metadata: {
          extraWorkspaces: data.extraWorkspaces,
          extraStorage: data.extraStorage,
          maxWorkspaces: 5 + (data.extraWorkspaces || 0),
          subscriptionType: data.subscription,
          storageSizeInBytes:
            ((data.extraStorage || 0) + 1) * 1000 * 1000 * 1000 * 1000, 
          userId: user.id,
          ...priceData,
        },
      });

        subscriptionId = subscription.id;
         if (subscription.status === 'active') {
          // update maxWorkspaces and storage
          user = await User.findByIdAndUpdate(
            req.user._id,
            {
              $set: {
                maxWorkspaces: 5 + (data.extraWorkspaces || 0),
                storageSizeInBytes:
                  ((data.extraStorage || 0) + 1) * 1000 * 1000 * 1000 * 1000, // TB Multiple
                subscription: {
                  service: 'stripe',
                  type: data.subscription,
                  status: subscription.status,
                  extraStorageInBytes:
                    data.extraStorage * 1000 * 1000 * 1000 * 1000,
                  extraWorkspaces: data.extraWorkspaces,
                  price: Number(
                    (priceData.total).toFixed(2),
                  ),
                  subscriptionId: subscriptionId,
                },
              },
            },
            { new: true },
          );

          const invoiceData = {
            user: user._id, 
            serviceId:subscriptionId, 
            service: 'stripe',  
            plan: data.subscription,
            type: data.subscription === 'monthly' ? 'monthly' : 'yearly',
            billing: {
              name: user.fullName || '',  
              address: user.billing.address || '',
              postalCode: user.billing.postalCode || '',
              city: user.billing.city || '',
              country: user.billing.country || '',
              vatNumber: user.billing.vatNumber || '',
            },
            amount: totalAmount,
            currency: 'usd',  
            metadata: {
              extraWorkspaces: data.extraWorkspaces,
              extraStorage: data.extraStorage,
              payId: user.paymentMethod.stripeCustomerId,
              ...priceData,
            },
          };
      
         await createInvoice(invoiceData)
        } else if (subscription.status === 'incomplete') {
          
          invoiceLink = (subscription.latest_invoice as Stripe.Invoice)
            .hosted_invoice_url;
          user = await User.findByIdAndUpdate(
            req.user._id,
            {
              $set: {
                subscription: {
                  service: 'stripe',
                  type: data.subscription,
                  status: subscription.status,
                  extraStorageInBytes:
                    data.extraStorage * 1000 * 1000 * 1000 * 1000,
                  extraWorkspaces: data.extraWorkspaces,
                  invoiceLink: (subscription.latest_invoice as Stripe.Invoice)
                    .hosted_invoice_url,
                  subscriptionId: subscription.id,
                },
              },
            },
            { new: true },
          );
        }
      }
    } catch (e) {
      console.log(e);
      throw InternalServerException(
        req.t('an-error-occured-while-processing-your-subscription'),
      );
    }
    res.json({ subscriptionId, invoiceLink, planId, message: "Subscription successfully created!", });
  } catch (e: any) {
    console.log(e);
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});



usersRouter.post(
  '/upgrade-plan/paypal-confirmation',
  async (req: IRequest, res: Response) => {
    const newPlanSchema = yup.object({
      extraStorage: yup
        .number()
        .integer(req.t('enter-an-integer-for-storage'))
        .notRequired()
        .default(0),
      extraWorkspaces: yup
        .number()
        .integer(req.t('enter-an-integer-for-workspaces'))
        .notRequired()
        .default(0),
      subscription: yup
        .string()
        .oneOf(
          ['monthly', 'yearly'],
          req.t('subscription-is-invalid-should-be-monthly-or-yearly'),
        )
        .required(req.t('subscription-is-required')),
    });
    try {
      const paypalSubscriptionId = req.body.paypalSubscriptionId;
      if (!paypalSubscriptionId)
        throw BadRequestException(req.t('no-subscription-id-provided'));
      const paypalSubscription = await getSubscription(paypalSubscriptionId);
      if (!paypalSubscription)
        throw NotFoundExeption(req.t('subscription-could-not-be-verified'));
      let user = await User.findById(req.user._id);
      if (!user) throw NotFoundExeption(req.t('user-not-found'));
      const data = newPlanSchema.validateSync(req.body, {
        abortEarly: true,
        stripUnknown: true,
      });
      // calculate price
      const priceData = calculatePrice({
        extraStorage: data.extraStorage,
        extraWorkspaces: data.extraWorkspaces,
        subscription: data.subscription,
      });
      // handle subscription status
      if (paypalSubscription.status.toLowerCase() !== 'active') {
        user = await User.findByIdAndUpdate(
          req.user._id,
          {
            $set: {
              subscription: {
                service: 'paypal',
                type: data.subscription,
                extraStorageInBytes:
                  data.extraStorage * 1000 * 1000 * 1000 * 1000,
                extraWorkspaces: data.extraWorkspaces,
                price: Number(
                  (priceData.total).toFixed(2),
                ),
                subscriptionId: paypalSubscription.id,
                status: paypalSubscription.status.toLowerCase(),
              },
            },
          },
          { new: true },
        );
      } else {
        user = await User.findByIdAndUpdate(
          req.user._id,
          {
            $set: {
              maxWorkspaces: 5 + (data.extraWorkspaces || 0),
              storageSizeInBytes:
                ((data.extraStorage || 0) + 1) * 1000 * 1000 * 1000 * 1000, // TB Multiple
              subscription: {
                service: 'paypal',
                type: data.subscription,
                extraStorageInBytes:
                  data.extraStorage * 1000 * 1000 * 1000 * 1000,
                extraWorkspaces: data.extraWorkspaces,
                price: Number(
                  (priceData.total).toFixed(2),
                ),
                subscriptionId: paypalSubscription.id,
                status: paypalSubscription.status.toLowerCase(),
              },
            },
          },
          { new: true },
        );
      }
      res.json(user);
      // create invoice
      await Invoice.create({
        user: user._id.toString(),
        service: 'paypal',
        serviceId: paypalSubscription.id,
        plan: 'Zoxxo TORNADO',
        type: user.subscription.type,
        amount: paypalSubscription.billing_info.last_payment.amount.value,
        currency: paypalSubscription.billing_info.last_payment.amount.currency_code.toUpperCase(),
        datePaid: Date.now(),
        billing: user.billing,
        metadata: {
          extraStorage: data.extraStorage + 'TB',
          extraStoragePrice: priceData.extraStoragePrice,
          extraWorkspaces: data.extraWorkspaces,
          extraWorkspacesPrice: priceData.extraWorkspacesPrice,
          proratedDiscount: priceData.proratedDiscount,
          taxPercent: 0,
          taxValue: 0,
        },
      }).catch((r) => r);
    } catch (e: any) {
      console.log(e);
      res.status(resolveStatus(e)).json({ message: e.message });
    }
  },
);

usersRouter.put('/subscription', async (req: IRequest, res: Response) => {
  try {
    let user = await User.findById(req.user._id);
    if (!user) throw NotFoundExeption(req.t('user-not-found'));
    if (!user.subscription.subscriptionId)
      throw NotFoundExeption(req.t('subscription-not-found'));
    if (user.subscription.status === 'downgrading')
      throw BadRequestException(req.t('subscription-is-already-downgrading'));
    if (user.subscription?.status === 'active') {
      if (user.subscription.service === 'stripe') {
        await stripe.subscriptions.cancel(user.subscription.subscriptionId, {
          cancellation_details: {
            comment: 'canceled by user',
          },
        });
      } else {
        // handle paypal cancelation
        try {
          await cancelSubscription(user.subscription.subscriptionId);
          // handle the scenario of removing subscription details after 1 month or 1 year
        } catch (e: any) {
          console.log(e);
          throw InternalServerException(
            req.t('an-error-occured-whiled-canceling-your-subscription'),
          );
        }
      }
      // check subscription cycle
      const downgradesAt = moment().add(1, user?.subscription?.type === 'monthly' ? 'months' : 'years').format('DD-MM-YYYY');
      user = await User.findByIdAndUpdate(
        user.id,
        {
          $set: {
            'subscription.status': 'downgrading',
            'subscription.downgradesAt': downgradesAt,
          },
        },
        { new: true },
      );
    } else {
      // the subscription is neither downgrading nor active
      // it can be in unpaid, incomplete_expired, past_due, incomplete status
      // cancel the subscription immediately without waiting for downgrade period
      if (user.subscription.service === 'stripe') {
        await stripe.subscriptions.cancel(user.subscription.subscriptionId, {
          cancellation_details: {
            comment: 'canceled by user',
          },
          invoice_now: false,
        });
      } else {
        // handle paypal cancelation
        try {
          await cancelSubscription(user.subscription.subscriptionId);
          // handle the scenario of removing subscription details after 1 month or 1 year
        } catch (e: any) {
          console.log(e);
          throw InternalServerException(
            req.t('an-error-occured-whiled-canceling-your-subscription'),
          );
        }
      }
      user = await User.findByIdAndUpdate(
        user.id,
        {
          $set: {
            maxWorkspaces: 1,
            storageSizeInBytes: 4 * 1000 * 1000 * 1000, // 4GB,
            subscription: {
              status: 'canceled',
              // isEligibleForProratedDiscount: false, // this will be uncommented in next release
            },
          },
        },
        { new: true }
      );
    }
    res.json(user);
  } catch (e: any) {
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});

usersRouter.get('/invoices', async (req: IRequest, res: Response) => {
  try {
    const invoices = await Invoice.find().where('user', req.user._id).lean();
    res.json(invoices);
  } catch (e: any) {
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});

usersRouter.get('/invoices/:_id/download', async (req: IRequest, res: Response) => {
  const stringToNumber = (str = '') => {
    let num = 0;
    const arr = [...str];
    num = arr.reduce((acc, c) => acc + c.charCodeAt(0), num);
    return num;
  }
  try {
    const invoice = await Invoice.findById(req.params._id).populate('user').lean();
    if (!invoice) throw NotFoundExeption(req.t('invoice-not-found'));
    // generate pdf document
    const doc = new PDFDocument({ font: 'Helvetica', margin: 25, size: 'A3' });
    doc.font('Helvetica-Bold', 21).text('ZOXXO - FZCO', 0, 185, { align: 'center' });
    doc.font('Helvetica');
    doc.fontSize(17).text('25898 - 001, IFZA Business Park, DDP', { align: 'center' });
    doc.fontSize(17).text('Dubai, United Arab Emirates', { align: 'center' });
    doc.rect(25, 270, 300, 150).fillAndStroke('#f2f2f2', '#f2f2f2').fillColor('black');
    doc.font('Helvetica-Bold', 19).text('To:', 25 + 9, 275 + 3, { width: 300 - 12 });
    doc.fillColor('gray'); doc.font('Helvetica');
    doc.fontSize(14).text(invoice.billing.name, 25 + 12, 300 + 3, { width: 300 - 12 });
    doc.fontSize(14).text(invoice.billing.address, 25 + 12, 315 + 3, { width: 300 - 12 });
    doc.fontSize(14).text(invoice.billing.postalCode + ' ' + invoice.billing.city, 25 + 12, 330 + 3, { width: 300 - 12 });
    doc.fontSize(14).text(invoice.billing.country, 25 + 12, 345 + 3, { width: 300 - 12 });
    doc.fontSize(14).text(invoice.billing.vatNumber || '', 25 + 12, 375 + 3, { width: 300 - 12 });
    doc.rect(doc.page.width - 25 - 300, 270, 300, 150).fillAndStroke('#f2f2f2', '#f2f2f2').fillColor('black');
    doc.fillColor('black');
    doc.font('Helvetica-Bold', 19).text('Invoice:', doc.page.width - 25 + 3 - 300, 275 + 3, { width: 300 - 12 });
    doc.fillColor('gray'); doc.font('Helvetica');
    doc.fontSize(14).text('Date: '+moment(invoice.datePaid).format('DD-MM-YYYY'), doc.page.width - 25 + 12 - 300, 300 + 3, { width: 300 - 12 });
    doc.fontSize(14).text('Number: '+'ZX-'+stringToNumber(invoice._id.toString()), doc.page.width - 25 + 12 - 300, 315 + 3, { width: 300 - 12 });
    doc.rect(25, 500 - 9, doc.page.width - 50, 200).fillAndStroke('#f2f2f2', '#f2f2f2').fillColor('black');
    doc.font('Helvetica-Bold', 19).fillColor('black').text('Tax Invoice', 25 + 9, 500);
    doc.fillAndStroke('#828282', '#828282').moveTo(25, 520).lineTo(doc.page.width - 25, 520).stroke().fillAndStroke('black', 'black');
    doc.fontSize(14).fillColor('gray');
    doc.text('Description', 25 + 9, 525, { width: (doc.page.width * 3 / 4) - 50});
    doc.fillAndStroke('#828282', '#828282').moveTo(25, 540).lineTo(doc.page.width - 25, 540).stroke().fillAndStroke('black', 'black');
    doc.fontSize(14).fillColor('gray');
    doc.moveDown(0.5);
    doc.font('Helvetica');
    doc.text(`TORNADO - ${invoice.type} plan`);
    doc.text(`+ ${invoice.metadata.extraStorage} Extra Storage`);
    doc.text(`+ ${invoice.metadata.extraWorkspaces} Extra Workspaces`);
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fillColor('gray').text('Prorated Discount: ');
    doc.fontSize(14).fillColor('gray'); doc.font('Helvetica');
    doc.moveDown(0.3);
    doc.text('Tax (0%)');
    doc.moveDown(0.5);
    doc.text('Total');
    doc.font('Helvetica-Bold');
    doc.text('Amount', 25 + (doc.page.width * 3 / 4) - 50, 525, { width: (doc.page.width * 1 / 4) - 50, align: 'right'});
    doc.moveDown(0.5);
    doc.font('Helvetica');
    doc.text(`${(invoice.metadata.proratedDiscount + invoice.amount - invoice.metadata.extraStoragePrice - invoice.metadata.extraWorkspacesPrice).toFixed(2)} USD`, {width: (doc.page.width * 1 / 4) - 50,align: 'right'});
    doc.text(`${invoice.metadata.extraStoragePrice} USD`, {width: (doc.page.width * 1 / 4) - 50,align: 'right'});
    doc.text(`${invoice.metadata.extraWorkspacesPrice} USD`, {width: (doc.page.width * 1 / 4) - 50,align: 'right'});
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fillColor('gray').text(`${Number(invoice.metadata.proratedDiscount).toFixed(2)} USD`, {width: (doc.page.width * 1 / 4) - 50,align: 'right'});
    doc.fontSize(14).fillColor('gray'); doc.font('Helvetica');
    doc.moveDown(0.3);
    doc.text('0 USD', {width: (doc.page.width * 1 / 4) - 50,align: 'right'});
    doc.moveDown(0.5);
    doc.text(`${invoice.amount} USD`, {width: (doc.page.width * 1 / 4) - 50,align: 'right'});
    doc.fillAndStroke('#828282', '#828282').moveTo(25, doc.y - 25).lineTo(doc.page.width - 25, doc.y - 25).stroke().fillAndStroke('black', 'black');
    doc.image(zoxxoLogoUri, doc.page.width / 2 - 35, 50, { width: 50 });
    doc.end();
    // send the pdf in response
    // Set appropriate headers for streaming as a pdf file
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${invoice.plan}.pdf"`,
    );
    doc.pipe(res);
  } catch (e: any) {
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});

usersRouter.delete('/', async (req: IRequest, res: Response) => {
  let isSubscriptionCanceled = false;
  try {
    const user = await User.findById(req.user._id).populate({
      path: 'workspaces',
      populate: {
        path: 'uploads'
      }
    }).lean();
    // delete stripe and paypal data
    if (user.paymentMethod.service === 'stripe') {
      // delete customer account in stripe
      await stripe.customers.del(user.paymentMethod.stripeCustomerId);
      console.log('stripe customer deleted:', user.paymentMethod.stripeCustomerId);
      isSubscriptionCanceled = true;
    } else {
      await cancelSubscription(user.subscription.subscriptionId);
      console.log('paypal subscription canceled:', user.subscription.subscriptionId);
      isSubscriptionCanceled = true;
    }
    // delete user account
    await User.findByIdAndDelete(req.user._id);
    // clear the cookie with token
    res.clearCookie(
      'zoxxo-token',
      {
        maxAge: 0,
        expires: new Date(1970),
      },
    );
    if (process.env.NODE_ENV !== 'production') {
      res.clearCookie(
        'zoxxo-token',
        {
          domain: 'localhost',
          maxAge: 0,
          expires: new Date(1970),
        },
      );
    }
    res.json({ success: 'deleted' });
    // delete user avatar
    if (user.avatar.length > 0) storage.bucket(Variables.publicBucket).file(user.avatar).delete().catch((e) => console.log(e.message));
  } catch (e: any) {
    console.log(e);
    res.status(resolveStatus(e)).json({ message: 'error' });
  } finally {
    // handle post deletion activities
    if (isSubscriptionCanceled) {
      const workspaces = await Workspace.find({user: new mongoose.Types.ObjectId(req.user._id)}).populate('uploads');
      workspaces.forEach(async (ws) => {
        try {
          // mark all uploads in the workspace to be invalid
          await Upload.updateMany({ _id: { $in: ws.uploads.map((up) => up._id) } }, {
            $set: {
              isValid: false,
              createdAt: Date(),
            },
            $unset: {
              user: 1,
              workspace: 1,
            }
          });
          await Workspace.findByIdAndDelete(ws._id);
        } catch (e: any) {
          console.log('workspace not deleted', e);
        }
      })
    }
  }
})



const monetizationSchema = yup.object({
  usersId: yup.array().of(yup.string().trim().required('User ID is required')).nullable().optional(),
  uploadId: yup.string().trim().required('Upload ID is required'),
  workspaceId: yup.string().trim().required('workspace ID is required'),
  invoiceIds: yup.array().of(yup.string().trim().optional()).nullable().optional(),
  ownerId: yup.string().trim().required('Owner ID is required'),
  price: yup.number().required('Price is required').positive('Price must be a positive number'),
});

usersRouter.post('/monetization', async (req: IRequest, res: Response) => {
  try {
    
    const validatedData = monetizationSchema.validateSync(req.body, {
      abortEarly: true,  
      stripUnknown: true,  
    });
     const existingMonetization = await MonetizationModel.findOne({uploadId: validatedData.uploadId });

    if(existingMonetization){
      return res.status(400).json({ message:'The File has already  monetized' });
    }
    const existingFile= await Upload.findOne({_id: validatedData.uploadId });

    if(!existingFile){
     return res.status(400).json({ message:'The File not exist ' });
    }

    const monetizationRecord = new MonetizationModel(validatedData);
    const savedRecord = await monetizationRecord.save();

 
    return res.status(201).json(savedRecord);
  } catch (error: any) {
 
    res.status(resolveStatus(error)).json({ message: error.message });
  }
});


usersRouter.delete('/monetization/:id', async (req: IRequest, res: Response) => {
  try {
    const { id } = req.params;

     const deletedRecord = await MonetizationModel.findByIdAndDelete(id);
    if (!deletedRecord) {
      return res.status(404).json({ message: 'Monetization record not found' });
    }

    return res.status(200).json({ message: 'Monetization record deleted successfully' });
  } catch (error: any) {
    res.status(resolveStatus(error)).json({ message: error.message });
  }
});

const updatePriceSchema = yup.object({
  price: yup.number().required('Price is required').positive('Price must be a positive number'),
});

usersRouter.post('/monetization/:id/price', async (req: IRequest, res: Response) => {
  try {
    const validatedData = updatePriceSchema.validateSync(req.body, {
      abortEarly: true,
      stripUnknown: true,
    });

    const { id } = req.params;
    
     const monetizationRecord = await MonetizationModel.findById(id);
    if (!monetizationRecord) {
      return res.status(404).json({ message: 'Monetization record not found' });
    }

    monetizationRecord.price = validatedData.price;
    const updatedRecord = await monetizationRecord.save();

    return res.status(200).json(updatedRecord);
  } catch (error: any) {
    res.status(resolveStatus(error)).json({ message: error.message });
  }
});


usersRouter.get('/monetization/:id', async (req: IRequest, res: Response) => {
  try {
   const id=req.params.id
   console.log(id,'id')

   const monitizedDirector=await MonetizationModel.findById(id).populate([
    {path: "ownerId"},
    {path:'uploadId'}
    ]);
   if(!monitizedDirector){
   return res.status(400).json({ message: 'The File not exist' });
  }
   console.log(monitizedDirector,'monitizedDirector')
   return  res.status(200).json(monitizedDirector);
   } catch (error: any) {
    res.status(resolveStatus(error)).json({ message: error.message });
  }
});
 

usersRouter.put('/:id/payment', async (req: IRequest, res: Response) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) throw NotFoundExeption(req.t('user-not-found'));
    console.log(req.params.id)
    let Monetize = await MonetizationModel.findById(req.params.id);  
    if (!Monetize) throw NotFoundExeption(req.t('Monetize-not-found'));

    if (!user.paymentMethod?.service)
      throw BadRequestException(req.t('payment-method-is-not-setup'));
    if (user.paymentMethod?.service === 'stripe') {
      if (
        user.paymentMethod.status === 'canceled' ||
        user.paymentMethod.status === 'payment-failed'
      )
        throw BadRequestException(
          req.t('provided-payment-method-is-not-verified-try-some-other-method'),
        );
      else if (user.paymentMethod.status === 'processing')
        throw BadRequestException(
          req.t('provided-payment-method-is-under-verification'),
        );
      else if (user.paymentMethod.status === 'requires-action')
        throw BadRequestException(
          req.t(
            'provided-payment-method-needs-your-authorization-for-verification-please-check-your-email',
          ),
        );
    }
    if (Monetize.usersId.includes(user._id))
      throw BadRequestException(req.t(' Monetize-is-already-paid'));
    if (!user.billing?.name)
      throw BadRequestException(req.t('billing-details-are-not-setup'));
    
    try {
    
         const customerId = user.paymentMethod?.stripeCustomerId;
         
        const intent = await stripe.paymentIntents.create({
          amount: Number.parseFloat((Monetize.price * 100).toFixed(2)),
          currency: 'usd',
          customer: customerId,
          confirm: true,  
          statement_descriptor: 'Zoxxo Campaign Price',
          payment_method: (user.paymentMethod.stripeCardData as any).stripeId,
          return_url: process.env.BACKEND_URL + '/redirect',
          metadata: {
            userId: user.id,
            customerId,
            MonetizeId: Monetize._id.toString(),
          },
          setup_future_usage: 'off_session', 
        });
        const invoiceData = {
          user: user._id,
          serviceId: Monetize._id, 
          service: 'stripe',  
          plan: 'monetization', 
          type: 'one-time', 
          billing: {
            name: user.fullName || '',
            address: user.billing.address || '',
            postalCode: user.billing.postalCode || '',
            city: user.billing.city || '',
            country: user.billing.country || '',
            vatNumber: user.billing.vatNumber || '',
          },
          amount: Monetize.price,  
          currency: 'usd',
          metadata: {
            customerId, 
            monetizeId: Monetize._id.toString(),
            stripePaymentId: intent.id,  
          },
        };
  
       
       const Invoice=await createInvoice(invoiceData);

       const updatedMonetize = await MonetizationModel.findByIdAndUpdate(
        Monetize.id,
        {
          $addToSet: {
            usersId: user._id,   
            invoiceIds: Invoice._id,   
          },
        },
        { new: true }
      );
      
         
        res.json(updatedMonetize.toObject());
      
    } catch (e: any) {
      throw new Error(req.t('an-error-occurred-while-processing-your-payment'));
    }
  } catch (e: any) {
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});

export default usersRouter;
