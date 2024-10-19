const ABTESTING_MULTIPLES = {
  'upload-screen': 2.5,
  'download-screen': 1.5,
  'upload-download-screen': 2,
};

const PERDAY_BASE_PRICES = {
  'upload-screen': 7,
  'download-screen': 5,
  'upload-download-screen': 10,
};

const calculateCampaignPrice = (options: {
  isABTesting: boolean;
  days: number;
  display: 'upload-screen' | 'download-screen' | 'upload-download-screen';
}) => {
  // get ab testing multiple
  const abTestinMultiple = options.isABTesting
    ? ABTESTING_MULTIPLES[options.display]
    : 1;
  // get base price
  const perDayPrice = abTestinMultiple * PERDAY_BASE_PRICES[options.display];
  // calculate overall price
  const totalPrice = perDayPrice * options.days;
  return totalPrice;
};

export default calculateCampaignPrice;
