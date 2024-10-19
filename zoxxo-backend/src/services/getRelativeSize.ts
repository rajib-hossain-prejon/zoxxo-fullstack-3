const getRelativeSize = (size: number) => {
  const TB_MULTIPLE = 1000 * 1000 * 1000 * 1000;
  const GB_MULTIPLE = 1000 * 1000 * 1000;
  const MB_MULTIPLE = 1000 * 1000;

  if (size >= TB_MULTIPLE) {
    const tbSize = size / TB_MULTIPLE;
    return (
      new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(
        tbSize,
      ) + ' TB'
    );
  } else if (size >= GB_MULTIPLE) {
    const gbSize = size / GB_MULTIPLE;
    return (
      new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(
        gbSize,
      ) + ' GB'
    );
  } else if (size >= MB_MULTIPLE) {
    const mbSize = size / MB_MULTIPLE;
    return (
      new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(
        mbSize,
      ) + ' MB'
    );
  } else {
    const kbSize = size / 1024;
    return (
      new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(
        kbSize,
      ) + ' KB'
    );
  }
};

export default getRelativeSize;
