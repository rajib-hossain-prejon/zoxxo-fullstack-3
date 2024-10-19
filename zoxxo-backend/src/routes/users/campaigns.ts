import { Router, Response, Express } from 'express';
import * as yup from 'yup';
import moment from 'moment';
import multer from 'multer';

import IRequest from '../../interfaces/IRequest';
import {
  BadRequestException,
  NotFoundExeption,
  resolveStatus,
} from '../../services/HttpException';
import Campaign from '../../models/Campaign';
import User from '../../models/User';
import { parse } from '../../services/fdMap';
import { getPublicUrl, uploadFile } from '../../services/google-cloud-storage';
import calculateCampaignPrice from '../../services/calculateCampaignPrice';
import stripe from '../../services/stripe';
import { captureOrder, createCampaingOrder } from '../../services/paypal';
import { Variables } from '../../utils/variables';

const campaignsRouter = Router();

campaignsRouter.get('/', async (req: IRequest, res: Response) => {
  try {
    const user = await User.findById(req.user._id)
      .populate({
        path: 'campaigns',
        options: {
          sort: {
            startDate: -1, // newest campaigns first
          },
        },
      })
      .lean();
    res.json(user.campaigns);
  } catch (e: any) {
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});

campaignsRouter.get('/:id', async (req: IRequest, res: Response) => {
  try {
     
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      // user: req.user._id,
    }).lean();
    if (!campaign) throw NotFoundExeption(req.t('campaign-not-found'));
    console.log(campaign)
    res.json(campaign);
  } catch (e: any) {
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2 MB
  },
});


campaignsRouter.post(
  '/',
  upload.fields([
    { name: 'creative.image', maxCount: 1 },
    { name: 'creativeABTesting.image', maxCount: 1 },
  ]),
  async (req: IRequest, res: Response) => {
    const campaignSchema = yup.object({
      title: yup
        .string()
        .min(3, req.t('title-should-be-at-least-3-characters-long'))
        .required('title-is-required'),
      description: yup
        .string()
        .min(10, req.t('description-should-be-at-least-10-characters-long')),
      display: yup
        .array()
        .of(yup.string().oneOf(['upload-screen', 'download-screen']))
        .min(1, req.t('at-least-one-display-screen-is-required'))
        .required(req.t('display-screens-are-required')),
      isABTesting: yup.bool(),
      creative: yup
        .object({
          url: yup
            .string()
            .url(req.t('creative-is-not-valid'))
            .required(req.t('creative-url-is-required')),
          image: yup
            .object()
            .shape({
              originalname: yup.string(),
              mimetype: yup.string(),
              buffer: yup.mixed(),
            })
            .test(
              'is-image',
              req.t('invalid-image-file-should-be-jpeg-or-png'),
              (val: any) => {
                return (
                  ['image/png', 'image/jpg', 'image/jpeg'].includes(
                    val.mimetype,
                  ) && val.originalname
                );
              },
            )
            .required(req.t('creative-image-is-required')),
        })
        .required(req.t('creative-is-required')),
      creativeABTesting: yup.object().when('isABTesting', {
        is: true,
        then: () =>
          yup
            .object({
              url: yup
                .string()
                .url(req.t('creative-is-not-valid'))
                .required(req.t('creative-url-is-required')),
              image: yup
                .object()
                .shape({
                  originalname: yup.string(),
                  mimetype: yup.string(),
                  buffer: yup.mixed(),
                })
                .test(
                  'is-image',
                  req.t('invalid-image-file-should-be-jpeg-or-png'),
                  (val: any) => {
                    return (
                      ['image/png', 'image/jpg', 'image/jpeg'].includes(
                        val.mimetype,
                      ) && val.originalname
                    );
                  },
                )
                .required(req.t('creative-image-is-required')),
            })
            .required(req.t('creative-is-required')), // This line is important
        otherwise: () => yup.object().nullable(), // Allow nullable when isABTesting is false
      }),
      startDate: yup
        .string()
        .test(
          'valid-start-date',
          req.t('invalid-start-date'),
          (val) =>
            moment(val).isValid() &&
            !moment(val).isBefore(moment().format('YYYY-MM-DD')),
        )
        .required(req.t('start-date-is-required')),
      endDate: yup
        .string()
        .test('valid-end-date', req.t('invalid-end-date'), (val) =>
          moment(val).isValid(),
        )
        .test(
          '3-days-after-and-upto-30-days',
          req.t(
            'end-date-should-be-at-least-3-days-after-start-date-and-30-days-at-max',
          ),
          (val, ctx) => {
            const diffDays = moment(val).diff(
              moment(ctx.parent.startDate),
              'days',
            );
            return diffDays >= 3 && diffDays <= 30;
          },
        )
        .required(req.t('end-date-is-required')),
    });
    try {
      const d = parse(req.body);
      d.creative.image = (
        req.files as unknown as Record<string, Express.Multer.File[]>
      )['creative.image'][0];
      if (d.creativeABTesting) {
        d.creativeABTesting.image = (
          req.files as unknown as Record<string, Express.Multer.File[]>
        )['creativeABTesting.image'][0];
      }
      const data = campaignSchema.validateSync(d, {
        abortEarly: true,
        stripUnknown: true,
      });
      // upload the files to cloud storage
      const creativeImage = await uploadFile(
        data.creative.image.originalname,
        data.creative.image.buffer,
        data.creative.image.mimetype,
      );
    
      let creativeABTestingImage = '';
      if (data.creativeABTesting) {
        creativeABTestingImage = await uploadFile(
          (data.creativeABTesting as any).image.originalname,
          (data.creativeABTesting as any).image.buffer,
          (data.creativeABTesting as any).image.mimetype,
        );
      }
      const creativeImageUrl = await getPublicUrl(
        creativeImage,
        Variables.publicBucket,
      );
      const creativeABTestingImageUrl = data.isABTesting
        ? await getPublicUrl(creativeABTestingImage, Variables.publicBucket)
        : '';
      const campaign = await Campaign.create({
        title: data.title,
        description: data.description,
        display: data.display,
        isABTesting: data.isABTesting,
        creative: {
          url: data.creative.url,
          image: creativeImageUrl,
        },
        creativeABTesting: data.isABTesting
          ? {
              url: (data.creativeABTesting as any).url,
              image: creativeABTestingImageUrl,
            }
          : undefined,
        startDate: data.startDate,
        endDate: data.endDate,
      });
      await User.findByIdAndUpdate(
        req.user._id,
        {
          $push: {
            campaigns: campaign.id,
          },
        },
        { new: true },
      );
      res.json(campaign.toObject());
    } catch (e: any) {
      console.log(e);
      res.status(resolveStatus(e)).json({ message: e.message });
    }
  },
);

campaignsRouter.put('/:id/payment', async (req: IRequest, res: Response) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) throw NotFoundExeption(req.t('user-not-found'));
    console.log(req.params.id)
    let campaign = await Campaign.findById(req.params.id); /* .where(
      'user',
      req.user._id,
    ); */
    if (!campaign) throw NotFoundExeption(req.t('campaign-not-found'));

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
    if (campaign.payment?.status === 'succeeded')
      throw BadRequestException(req.t('campaign-is-already-paid'));
    if (!user.billing?.name)
      throw BadRequestException(req.t('billing-details-are-not-setup'));
    const total = calculateCampaignPrice({
      isABTesting: campaign.isABTesting,
      days: moment(campaign.endDate).diff(moment(campaign.startDate), 'days'),
      display:
        campaign.display.includes('upload-screen') &&
        campaign.display.includes('download-screen')
          ? 'upload-download-screen'
          : campaign.display[0],
    });
    try {
      // if payment method is paypal
      if (user.paymentMethod?.service === 'paypal') {
        const create_payment_link = await createCampaingOrder({
          isABTesting: campaign.isABTesting,
          display: campaign.display,
          days: moment(campaign.endDate, 'YYYY-MM-DD').diff(
            moment(campaign.startDate, 'YYYY-MM-DD'),
            'days',
            
          ),
          campaignId:campaign._id,
        });
     
        res.json({ ...campaign.toObject(), redirect_url: create_payment_link });
      } else {
         const customerId = user.paymentMethod?.stripeCustomerId;
         
        const intent = await stripe.paymentIntents.create({
          amount: Number.parseFloat((total * 100).toFixed(2)),
          currency: 'usd',
          customer: customerId,
          confirm: true, // charge customer immediately
          statement_descriptor: 'Zoxxo Campaign Price',
          payment_method: (user.paymentMethod.stripeCardData as any).stripeId,
          return_url: process.env.BACKEND_URL + '/redirect',
          metadata: {
            userId: user.id,
            customerId,
            campaignId: campaign._id.toString(),
          },
          setup_future_usage: 'off_session', // use the payment method for future
        });
      

        campaign = await Campaign.findByIdAndUpdate(
          campaign.id,
          {
            $set: {
              payment: {
                service: 'stripe',
                serviceId: intent.id,
                price: total,
                status: intent.status,
                invoiceLink:
                  intent.status === 'requires_action'
                    ? intent.next_action.redirect_to_url.url
                    : undefined,
              },
            },
          },
          { new: true },
        );
        console.log('customerId',customerId,total)
        res.json(campaign.toObject());
      }
    } catch (e: any) {
      throw new Error(req.t('an-error-occurred-while-processing-your-payment'));
    }
  } catch (e: any) {
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});

campaignsRouter.put(
  '/:id/capture/:orderId/token/:tokenId',
  async (req: IRequest, res: Response) => {
    try {
      let campaign = await Campaign.findById(req.params.id);
      const tokenId=req.params.tokenId
      if (!campaign) throw NotFoundExeption(req.t('campaign-not-found'));
      const orderId=req.params.orderId
      const check_payment = await captureOrder(orderId,tokenId);
      const total = calculateCampaignPrice({
        isABTesting: campaign.isABTesting,
        days: moment(campaign.endDate).diff(moment(campaign.startDate), 'days'),
        display:
          campaign.display.includes('upload-screen') &&
          campaign.display.includes('download-screen')
            ? 'upload-download-screen'
            : campaign.display[0],
      });
    
      campaign = await Campaign.findByIdAndUpdate(
        campaign.id,
        {
          $set: {
            payment: {
              service: 'paypal',
              serviceId: check_payment.id,
              price: total,
              status: check_payment.status,
            },
          },
        },
        { new: true },
      );
      res.json(campaign.toObject());
    } catch (e: any) {
      res.status(resolveStatus(e)).json({ message: e.message });
    }
  },
);

export default campaignsRouter;
