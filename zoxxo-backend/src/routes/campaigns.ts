import { Request, Response, Router } from 'express';

import {
  BadRequestException,
  NotFoundExeption,
  resolveStatus,
} from '../services/HttpException';
import Campaign from '../models/Campaign';
import { decrypt, encrypt } from '../services/encryption';
import moment from 'moment';

const publicCampaingsRouter = Router();

publicCampaingsRouter.put(
  '/clicks/:id',
  async (req: Request, res: Response) => {
    try {
      const foundCampaign = await Campaign.findById(req.params.id);
      // validate token
      const id = decrypt(req.body.token || '');
      if (foundCampaign.id !== id)
        throw BadRequestException(req.t('invalid-request'));
      // increment the clicks on specified date
      const allImpressions = foundCampaign.impressions;
      const foundIndex = allImpressions.findIndex(
        (i) => i.date === moment().format('YYYY-MM-DD'),
      );
      const updatedImpressions =
        foundIndex >= 0
          ? [
              ...allImpressions.slice(0, foundIndex),
              {
                ...allImpressions[foundIndex],
                totalClicks: allImpressions[foundIndex].totalClicks + 1,
              },
              ...allImpressions.slice(foundIndex + 1),
            ]
          : [
              ...allImpressions,
              {
                date: moment().format('YYYY-MM-DD'),
                totalImpressions: 1,
                totalClicks: 1,
              },
            ];
      // update the campaign
      await Campaign.findOneAndUpdate(foundCampaign._id, {
        $set: {
          impressions: updatedImpressions,
        },
      });
      res.json({ success: req.t('ad-updated-successfully') });
    } catch (e: any) {
      res.status(resolveStatus(e)).json({ message: e.message });
    }
  },
);

publicCampaingsRouter.get('/:display', async (req: Request, res: Response) => {
  try {
    const display = req.params.display as string;
    // get campaign that is served at minimum by sorting in ascending order
    let notServed = await Campaign.findOne({
      isServed: false,
      display,
      'payment.status': 'succeeded',
    }).lean();
    // when no campaign is already served, make all as not served
    if (!notServed) {
      await Campaign.updateMany({ display }, { $set: { isServed: false } });
      notServed = await Campaign.findOne({ isServed: false, display, 'payment.status': 'succeeded', }).lean();
    }
    if (!notServed) throw NotFoundExeption(req.t('campaign-not-found'));
    // generate token for validating request when ad is clicked
    const token = encrypt(notServed._id.toString());
    // increment the impressions on specified date
    const allImpressions = notServed.impressions;
    const foundIndex = allImpressions.findIndex(
      (i) => i.date === moment().format('YYYY-MM-DD'),
    );
    const updatedImpressions =
      foundIndex >= 0
        ? [
            ...allImpressions.slice(0, foundIndex),
            {
              ...allImpressions[foundIndex],
              totalImpressions: allImpressions[foundIndex].totalImpressions + 1,
            },
            ...allImpressions.slice(foundIndex + 1),
          ]
        : [
            ...allImpressions,
            {
              date: moment().format('YYYY-MM-DD'),
              totalImpressions: 1,
              totalClicks: 0,
            },
          ];
    // update the campaign
    await Campaign.findOneAndUpdate(notServed._id, {
      $set: {
        updateToken: token,
        isServed: true,
        impressions: updatedImpressions,
      },
    });
    res.json({ ...notServed, updateToken: token });
  } catch (e: any) {
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});

export default publicCampaingsRouter;
