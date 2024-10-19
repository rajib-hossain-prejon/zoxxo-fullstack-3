import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import moment from 'moment';

import uploadsRouter from './uploads';
import authRouter from './auth';
import authMiddleware from '../services/authMiddleware';
import usersRouter from './users';
import adminRouter from './admins';
import { NotFoundExeption, resolveStatus } from '../services/HttpException';
import Workspace from '../models/Workspace';
import User from '../models/User';
import stripe from '../services/stripe';
import { verifyWebhook, getProductFromPlanId, getSubscription } from '../services/paypal';
import { decrypt } from '../services/encryption';
import publicCampaingsRouter from './campaigns';
import Campaign from '../models/Campaign';
import Invoice from '../models/Invoice';
import getRelativeSize from '../services/getRelativeSize';
import { calculatePrice } from '../services/calculatePrice';

const router = Router();

// Base route
router.get('/', (req, res) => {
  res.send(req.t('greeting'));
});

// Auth routes
 router.use('/auth', authRouter);

// Uploads routes
router.use('/uploads', uploadsRouter);

// Users routes (protected)
router.use('/users', authMiddleware, usersRouter);

// Admin routes (protected)
router.use('/admin', authMiddleware, adminRouter);

// Campaigns routes
router.use('/campaigns', publicCampaingsRouter);

// for handling stripe redirects because they contain senstive information
router.use('/redirect', (req: Request, res: Response) =>
  res.redirect(process.env.FRONTEND_URL),
);
// Workspace routes
router.get(
  '/default-workspace/:username',
  async (req: Request, res: Response) => {
    try {
      const user = await User.findOne({
        $or: [
          { username: req.params.username },
          { zoxxoUrl: req.params.username },
        ],
      })
        .populate({
          path: 'defaultWorkspace',
          populate: {
            path: 'uploads',
          },
        })
        .lean();
      if (!user || !user.defaultWorkspace.uploads)
        throw NotFoundExeption(req.t('files-not-found'));
      res.json({
        ...user.defaultWorkspace,
        user: {
          fullName: user.fullName,
          _id: user._id,
          avatar: user?.avatar,
          subscription: {
            type: user?.subscription?.type,
          },
        },
      });
    } catch (e: any) {
      res.status(resolveStatus(e)).json({ message: req.t('user-not-found') });
    }
  },
);

router.get("/workspace/download/:_id/", async (req: Request, res: Response) => {
  try {
    const workspace = await Workspace.findById(req.params._id)
      .populate({
        path:"uploads",
        match:{isValid:true}
      })
      .populate("user")
      .lean();
      
    res.json(workspace);
   
  } catch (e: any) {
    console.log(e,'err')
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});

router.get('/workspaces/:id', async (req: Request, res: Response) => {
  try {
    const ws = await Workspace.findById(req.params.id).populate({
        path: 'uploads',
        match: { isValid: true },
      });
    if (!ws) throw NotFoundExeption(req.t('files-not-found'));
    const foundUser = await User.findOne().where('workspaces', req.params.id);
    if (!foundUser) throw NotFoundExeption(req.t('files-not-found'));
    res.json({
      ...ws.toObject(),
      user: {
        fullName: foundUser.fullName,
        _id: foundUser._id,
        avatar: foundUser?.avatar,
        subscription: {
          type: foundUser?.subscription?.type,
        },
      },
    });
  } catch (e: any) {
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});

//  Redirect route for handling stripe redirects
router.post('/stripe-webhooks', async (req: Request, res: Response) => {
  try {
    const data = stripe.webhooks.constructEvent(
      (req as any).rawBody,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET,
    );
    if (data.type.startsWith('payment_intent')) {
      const paymentIntent = data.data.object as Stripe.PaymentIntent;
      // check for event idempotency to prevent duplicate events
      // find the user
      const event = paymentIntent.metadata as {
        userId: string;
        customerId: string;
        campaignId: string;
      };
      const paymentMethodId = paymentIntent.payment_method as string;
      // handle only test charge related payment intent events
      // because payment intents are also succeeded for subscriptions
      if (paymentIntent.statement_descriptor === 'Zoxxo Test Charge') {
        const user = await User.findById(event.userId);
        if (
          user.paymentMethod.stripeWebhookEventKey ===
          data.request.idempotency_key
        ) {
          // do nothing and return
          return res.end();
        }
        if (data.type === 'payment_intent.succeeded') {
          // attach payment method
          await stripe.paymentMethods.attach(paymentMethodId, {
            customer: event.customerId,
          });
          // set default payment method
          await stripe.customers.update(event.customerId, {
            invoice_settings: {
              default_payment_method: paymentMethodId,
            },
          });
          await user.updateOne({
            $set: {
              'paymentMethod.status': 'succeeded',
              'paymentMethod.verificationLink': '',
            },
          });
          await stripe.refunds.create({
            payment_intent: paymentIntent.id,
          });
          res.end();
        } else if (data.type === 'payment_intent.processing') {
          await user.updateOne({
            $set: {
              'paymentMethod.status': 'processing',
              'paymentMethod.verificationLink': '',
            },
          });
          res.end();
        } else if (data.type === 'payment_intent.payment_failed') {
          await user.updateOne({
            $set: {
              'paymentMethod.status': paymentIntent.status,
              'paymentMethod.verificationLink': '',
            },
          });
          res.end();
        } else if (data.type === 'payment_intent.requires_action') {
          await user.updateOne({
            $set: {
              'paymentMethod.status': paymentIntent.status,
              'paymentMethod.verificationLink':
                paymentIntent.next_action.redirect_to_url.url,
            },
          });
          res.end();
        }
        // add the event idempotency key
        await User.findByIdAndUpdate(paymentIntent.metadata.userId, {
          $set: {
            'paymentMethod.stripeWebhookEventKey': data.request.idempotency_key,
          },
        });
      } else if (
        paymentIntent.statement_descriptor === 'Zoxxo Campaign Price'
      ) {
        const campaign = await Campaign.findById(event.campaignId);
        console.log('campaign', campaign.id);
        if (!campaign) return res.end();
        if (
          campaign.payment.stripeWebhookEventKey ===
          data.request.idempotency_key
        ) {
          // do nothing and return
          console.log('campaign', campaign.id, 'do nothing');
          return res.end();
        }
        if (data.type !== 'payment_intent.requires_action') {
          await campaign.updateOne({
            $set: {
              'payment.status': paymentIntent.status,
              'payment.invoiceLink': '',
            },
          });
          console.log('campaign', campaign.id, 'other than requires action');
          res.end();
        } else if (data.type === 'payment_intent.requires_action') {
          await campaign.updateOne({
            $set: {
              'payment.status': paymentIntent.status,
              'payment.invoiceLink':
                paymentIntent.next_action.redirect_to_url.url,
            },
          });
          console.log('campaign', campaign.id, 'requires action');
          res.end();
        }
        // add the event idempotency key
        await campaign.updateOne({
          $set: {
            'payment.stripeWebhookEventKey': data.request.idempotency_key,
          },
        });
      } else if (paymentIntent.invoice && data.type === 'payment_intent.succeeded') {
        let invoice: Stripe.Invoice;
        if (typeof paymentIntent.invoice === 'string') invoice = await stripe.invoices.retrieve(paymentIntent.invoice);
        else invoice = paymentIntent.invoice;
        // check whether the invoice was created by a subscription
        if (invoice.subscription_details) {
          const user = await User.findById(invoice.subscription_details.metadata.userId);
          await Invoice.create({
            user: invoice.subscription_details.metadata.userId,
            service: 'stripe',
            serviceId: typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription.id,
            plan: 'Zoxxo TORNADO',
            type: invoice.subscription_details.metadata.subscriptionType,
            amount: invoice.amount_paid / 100,
            currency: invoice.currency,
            datePaid: Date.now(),
            billing: user.billing,
            metadata: {
              extraStorage: invoice.subscription_details.metadata.extraStorage + 'TB',
              extraStoragePrice: Number(invoice.subscription_details.metadata.extraStoragePrice),
              extraWorkspaces: Number(invoice.subscription_details.metadata.extraWorkspaces),
              extraWorkspacesPrice: Number(invoice.subscription_details.metadata.extraWorkspacesPrice),
              proratedDiscount: Number(invoice.subscription_details.metadata.proratedDiscount),
              taxPercent: 0,
              taxValue: 0,
            }
          });
          res.end();
        }
      } else res.end();
    } else if (
      data.type === 'customer.subscription.created' ||
      data.type === 'customer.subscription.updated' ||
      data.type === 'customer.subscription.deleted'
    ) {
      const subscription = data.data.object as Stripe.Subscription;
      // check for event idempotency to prevent duplicate events
      // find the user who is subscribed to this subscription
      const user = await User.findById(subscription.metadata.userId);
      if (
        user.subscription.stripeWebhookEventKey === data.request.idempotency_key
      ) {
        // do nothing and return
        return res.end();
      }
      // all subscriptions on zoxxo are charged automatically
      // if a subscription is active or becomes active i.e. its invoice is successfully paid
      // or it's trialing, simply update the status in database
      if (
        subscription.status === 'active' ||
        subscription.status === 'trialing'
      ) {
        await User.findByIdAndUpdate(subscription.metadata.userId, {
          $set: {
            maxWorkspaces: Number(subscription.metadata.maxWorkspaces),
            storageSizeInBytes: Number(
              subscription.metadata.storageSizeInBytes,
            ),
            'subscription.status': subscription.status,
            'subscription.invoiceLink': '',
          },
        });
      }
      // if a subscription has latest invoice failed i.e. subscription is not valid and is incomplete
      // posibility card decline, no funds in card, card expired etc.
      else if (
        subscription.status === 'incomplete' ||
        subscription.status === 'past_due'
      ) {
        // send latest invoice link to user for processing it manually
        const latestInvoice = await stripe.invoices.retrieve(
          subscription.latest_invoice as string,
        );
        await User.findByIdAndUpdate(subscription.metadata.userId, {
          $set: {
            'subscription.status': subscription.status,
            'subscription.invoiceLink': latestInvoice.hosted_invoice_url,
          },
        });
      }
      // if first invoice is not paid or payment invoice is expired
      else if (subscription.status === 'incomplete_expired' || subscription.status === 'unpaid') {
        // let user take advantage of prorated discount
        await User.findByIdAndUpdate({
          $set: {
            'subscription.status': subscription.status,
            'subscription.invoiceLink': '',
          },
        });
      }
      // if a sbuscription was incomplete and has payment invoice expired
      // cancel the subscription
      else if (
        subscription.status === 'canceled'
      ) {
        console.log('canceled');
        // delete the subscription from user acount
        // currently subscription invoices are uncollectible and subscription has ended
        // Create a new subscription and delete the existing one
        const user = await User.findById(subscription.metadata.userId);
        const downgradesAt = moment().add(1, user?.subscription?.type === 'monthly' ? 'months' : 'years').format('DD-MM-YYYY');
        await User.findByIdAndUpdate(subscription.metadata.userId, {
          $set: {
            'subscription.status': 'downgrading',
            'subscription.downgradesAt': downgradesAt,
          },
        });
      }
      // add the event idempotency key
      await User.findByIdAndUpdate(subscription.metadata.userId, {
        $set: {
          'subscription.stripeWebhookEventKey': data.request.idempotency_key,
        },
      });
      res.end();
    }
  } catch (e) {
    console.log(e);
    res.status(500).end();
  }
});

router.post('/paypal-webhooks', async (req: Request, res: Response) => {
  try {
    const eventData = await verifyWebhook({
      transmission_id: req.get('paypal-transmission-sig'),
      transmission_time: req.get('paypal-transmission-time'),
      cert_url: req.get('paypal-cert-url'),
      auth_algo: req.get('paypal-auth-algo'),
      transmission_sig: req.get('paypal-transmission-sig'),
      webhook_id: req.body.id,
      webhook_event: (req as any).rawBody.toString(),
    });
    console.log(eventData.event_type, 'type');
    if (eventData.event_type.startsWith('BILLING.SUBSCRIPTION')) {
      const subscription = eventData.resource;
      const userId = decrypt(eventData.resource.custom_id);
      const user = await User.findById(userId).lean();
      const { metadata } = await getProductFromPlanId(
        eventData.resource.plan_id,
      );
      if (
        [
          'BILLING.SUBSCRIPTION.ACTIVATED',
        ].includes(eventData.event_type)
      ) {
        // do not update if subscription is already active
        const usr = await User.findById(user._id);
        if (usr.subscription.status.toLowerCase() === 'active') return res.end();
        // handle active subscription by updating maxWorkspaces and storageSize
        await User.findByIdAndUpdate(user._id, {
          $set: {
            maxWorkspaces: 5 + (metadata.extraWorkspaces || 0),
            storageSizeInBytes:
              ((metadata.extraStorage || 0) + 1) * 1000 * 1000 * 1000 * 1000, // TB Multiple
            subscription: {
              service: 'paypal',
              type: metadata.subscription,
              status: 'active',
              extraStorageInBytes:
                metadata.extraStorage * 1000 * 1000 * 1000 * 1000,
              extraWorkspaces: metadata.extraWorkspaces,
              price: Number(
                subscription.billing_info.outstanding_balance.value,
              ),
              subscriptionId: subscription.id,
            },
          },
        });
      } else if (
        eventData.event_type === 'BILLING.SUBSCRIPTION.RE-ACTIVATED'
      ) {
        // check whether the latest invoice is paid or not
        await User.findByIdAndUpdate(userId, {
          $set: {
            'subscription.status': 'active',
            'subscription.invoiceLink': 'https://www.paypal.com/signin',
          },
        });
      } else if (
        eventData.event_type === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED'
      ) {
        // check whether the latest invoice is paid or not
        await User.findByIdAndUpdate(userId, {
          $set: {
            'subscription.status': subscription.status.toLowerCase(),
            'subscription.invoiceLink': 'https://www.paypal.com/signin',
          },
        });
      } else if (
        [
          'BILLING.SUBSCRIPTION.UPDATED',
          'BILLING.SUBSCRIPTION.SUSPENDED',
        ].includes(eventData.event_type)
      ) {
        // only update the status
        await User.findByIdAndUpdate(userId, {
          $set: {
            'subscription.status': subscription.status.toLowerCase(),
          },
        });
      } else if (
        ['BILLING.SUBSCRIPTION.CANCELLED'].includes(eventData.event_type)
      ) {
        // delete the subscription from user acount
        // Create a new subscription and delete the existing one
        await User.findByIdAndUpdate(user._id, {
          $set: {
            'subscription.status': 'canceled', // handle maxWorkspaces and storageSize manually
            // subscription.isEligibleForProratedDiscount: false, // this will be uncommented in next release
          },
        });
      }
    } else if (eventData.event_type === 'PAYMENT.SALE.COMPLETED') {
      // this is fired when recurring payment is completed for a subscription
      const subscriptionId = eventData.resource.billing_agreement_id || '';
      const user = await User.findOne({ 'subscription.subscriptionId': subscriptionId }).lean();
      if (!user) return res.end();
      const subscription = await getSubscription(subscriptionId);
      if (!subscription) return res.end();
      // calculate price data that will be used in metada for invoice generation
      const relativeSize = getRelativeSize(user.subscription.extraStorageInBytes);
      const extraStorage = !relativeSize.includes('TB') ? 0 : Number(relativeSize.split('TB')[0]);
      const priceData = calculatePrice({
        extraStorage: extraStorage,
        extraWorkspaces: user.subscription.extraWorkspaces,
        subscription: user.subscription.type,
      });
      await Invoice.create({
        user: user._id.toString(),
        service: 'paypal',
        serviceId: subscription.id,
        plan: 'Zoxxo TORNADO',
        type: user.subscription.type,
        amount: subscription.billing_info.last_payment.amount.value,
        currency: subscription.billing_info.last_payment.amount.currency_code.toUpperCase(),
        datePaid: Date.now(),
        billing: user.billing,
        metadata: {
          extraStorage: extraStorage + 'TB',
          extraStoragePrice: priceData.extraStoragePrice,
          extraWorkspaces: user.subscription.extraWorkspaces,
          extraWorkspacesPrice: priceData.extraWorkspacesPrice,
          proratedDiscount: priceData.proratedDiscount,
          taxPercent: 0,
          taxValue: 0,
        },
      });
    }
    res.end();
  } catch (e: any) {
    console.log(e);
    res.end();
  }
});

export default router;
