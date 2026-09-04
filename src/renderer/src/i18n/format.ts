export const formatSize = (size: bigint | number, language: string): string => {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;
  let value = Number(size);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return new Intl.NumberFormat(language, {
    maximumFractionDigits: unitIndex === 0 ? 0 : 1,
    style: 'unit',
    unit: units[unitIndex],
    unitDisplay: 'short',
  }).format(value);
};
export const formatDate = (value: string, language: string): string =>
  new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
