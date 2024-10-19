import mongoose from 'mongoose';

import ICampaign from '../interfaces/ICampaign';

interface ICampaignModel extends mongoose.Document, ICampaign {}

const campaignSchema = new mongoose.Schema({
  title: {
    type: String,
    trim: true,
    required: true,
  },
  description: {
    type: String,
    default: '',
  },
  display: {
    type: [String],
    default: ['upload-screen'],
    required: true,
  },
  isABTesting: {
    type: Boolean,
    default: false,
  },
  creative: {
    type: {
      url: String,
      image: String, // url of image file
    },
    required: true,
  },
  creativeABTesting: {
    url: String,
    image: String, // url of image file
  },
  startDate: {
    type: String,
    required: true,
  },
  endDate: {
    type: String,
    required: true,
  },
  payment: {
    service: {
      type: String,
      enum: ['stripe', 'paypal'],
    },
    serviceId: String,
    price: Number,
    status: String, // success, processing, error, failed
    invoiceLink: String, // for handling manually
    stripeWebhookEventKey: String,
  },
  impressions: {
    type: [Object],
    default: [],
  },
  updateToken: {
    // used for updating impressions and clicks
    type: String,
    default: '',
  },
  isServed: {
    type: Boolean,
    default: false,
  },
});

const Campaign = mongoose.model<ICampaignModel>('Campaign', campaignSchema);

export default Campaign;
