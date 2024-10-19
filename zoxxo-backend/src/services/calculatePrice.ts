// all prices are in USD
const yearlyProratedDiscounts = [
  26.39, 95.87, 143.75, 191.63, 239.51, 179.39, 227.27, 383.15, 323.03, 370.91,
  310.79, 358.67, 406.55, 454.43, 502.31, 766.19, 490.07, 537.95, 693.83,
  633.71, 681.59, 837.47, 993.35, 1149.23, 765.11, 812.99, 860.87, 908.75,
  848.63, 896.51, 944.39, 884.27, 932.15, 980.03, 1135.91, 967.79, 1123.67,
  1063.55, 1111.43, 1159.31, 1099.19, 1255.07, 1194.95, 1242.83, 1398.71,
  1554.59, 1710.47, 1866.35, 1590.23, 1638.11, 1457.89, 1517.87, 1565.75,
  1613.63, 1553.51, 1601.39, 1541.27, 1589.15, 1745.03, 1792.91, 1732.79,
  1672.67, 1720.55, 1768.43, 1816.31, 1756.19, 1804.07, 1851.95, 1899.83,
  1947.71, 1995.59, 1935.47, 1983.35, 2031.23, 2079.11, 2126.99, 2066.87,
  2222.75, 2162.63, 2210.51, 2150.39, 2198.27, 2246.15, 2294.03, 2341.91,
  2389.79, 2437.67, 2377.55, 2425.43, 2473.31, 2413.19, 2461.07, 2508.95,
  2556.83, 2604.71, 2652.59, 2592.47, 2640.35, 2688.23, 2854.8,
];

const yearlyProratedDiscountMap = new Map();

yearlyProratedDiscounts.forEach((discount, index) => {
  const TB = index + 1;
  yearlyProratedDiscountMap.set(TB, discount);
});

const monthlyProratedDiscounts = [
  0.0, 3.99, 5.98, 7.97, 9.96, 1.95, 3.94, 15.93, 7.92, 9.91, 1.9, 3.89, 5.88,
  7.87, 9.86, 31.85, 3.84, 5.83, 17.82, 9.81, 11.8, 23.79, 35.78, 47.77, 9.76,
  11.75, 13.74, 15.73, 7.72, 9.71, 11.7, 3.69, 5.68, 7.67, 19.66, 1.65, 13.64,
  5.63, 7.62, 9.61, 1.6, 13.59, 5.58, 7.57, 19.56, 31.55, 43.54, 55.53, 27.52,
  29.51, 10.38, 13.49, 15.48, 17.47, 9.46, 11.45, 3.44, 5.43, 17.42, 19.41,
  11.4, 3.39, 5.38, 7.37, 9.36, 1.35, 3.34, 5.33, 7.32, 9.31, 11.3, 3.29, 5.28,
  7.27, 9.26, 11.25, 3.24, 15.23, 7.22, 9.21, 1.2, 3.19, 5.18, 7.17, 9.16,
  11.15, 13.14, 5.13, 7.12, 9.11, 1.1, 3.09, 5.08, 7.07, 9.06, 11.05, 3.04,
  5.03, 7.02, 20.0,
];

const monthlyProratedDiscountMap = new Map();

monthlyProratedDiscounts.forEach((discount, index) => {
  const TB = index + 1;
  monthlyProratedDiscountMap.set(TB, discount);
});

const workspacesPriceMap = new Map([
  [3, 15],
  [5, 25],
  [10, 50],
  [20, 100],
  [50, 250],
]);

export const calculatePrice = (options: {
  extraStorage: number;
  extraWorkspaces: number;
  subscription: 'monthly' | 'yearly';
}) => {
  // calculate workpsaces price
  const extraWorkspacesPrice =
    workspacesPriceMap.get(options.extraWorkspaces) || 0;

  // calculate storage price
  const baseMonthlyPrice = 21.99;
  const baseYearlyPrice = 263.88;
  const baseYearlyDiscount = 26.39;
  // monthly prices
  const monthlyPrice = options.extraStorage * 21.99; // usd price
  const monthlyProratedDiscount =
    (monthlyPrice + baseMonthlyPrice) / 2 +
    (monthlyProratedDiscountMap.get(options.extraStorage) || 0);
  // yearly prices
  const yearlyPrice = options.extraStorage ? options.extraStorage * 263.88 : 0; // usd price
  const yearlyProratedDiscount =
    baseYearlyDiscount +
    (baseYearlyPrice + yearlyPrice) / 2 +
    (yearlyProratedDiscountMap.get(options.extraStorage || 0) || 0);

  let total = 0;
  if (options.subscription === 'monthly') {
    total =
      extraWorkspacesPrice +
      monthlyPrice +
      baseMonthlyPrice -
      monthlyProratedDiscount;
  } else {
    total =
      extraWorkspacesPrice +
      yearlyPrice +
      baseYearlyPrice -
      yearlyProratedDiscount;
  }

  return {
    extraWorkspacesPrice,
    extraStoragePrice:
      options.subscription === 'monthly' ? monthlyPrice : yearlyPrice,
    basePrice:
      options.subscription === 'monthly' ? baseMonthlyPrice : baseYearlyPrice,
    proratedDiscount:
      options.subscription === 'monthly'
        ? monthlyProratedDiscount
        : yearlyProratedDiscount,
    total,
  };
};
