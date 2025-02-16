import { format, isValid, parse } from 'date-fns';

type DateFormat =
  | 'yyyyMM'
  | 'yyyy年MM月'
  | 'yyyy-MM'
  | 'yyyy/MM/dd H:mm'
  | 'MMMM yyyy';

export const parseDate = (s: string, f: DateFormat) => parse(s, f, new Date());

export const formatDate = (d: Date, f: DateFormat) => format(d, f);

export const changeMonthFormat = (
  s: string,
  from: DateFormat,
  to: DateFormat,
) => formatDate(parseDate(s, from), to);

export const assertDateFormat: (
  value: string,
  format: DateFormat,
  message: string,
) => asserts value is string = (value, format, message) => {
  if (!isValid(parseDate(value, format))) {
    throw new Error(message);
  }
};
