export default interface ICampaign {
  title: string;
  description: string;
  display: ('upload-screen' | 'download-screen')[];
  isABTesting: boolean;
  creative: {
    url: string;
    image: string;
  };
  creativeABTesting?: {
    url: string;
    image: string;
  };
  startDate: string;
  endDate: string;
  payment?: {
    service: 'stripe' | 'paypal';
    serviceId: string;
    price: number;
    status: string;
    invoiceLink: string; // for handling invoices manually by user interaction
    stripeWebhookEventKey: string; // to guard against duplicate events
  };
  impressions: {
    date: string;
    totalImpressions: number;
    totalClicks: number;
  }[];
  updateToken: string; // used for updating number of clicks and impressions
  isServed: boolean; // used for not sending already served campaign
}
