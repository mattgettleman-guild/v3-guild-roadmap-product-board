const FISCAL_YEAR_START_MONTH = parseInt(process.env.FISCAL_YEAR_START_MONTH || "2", 10);

const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4,
  may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4,
  jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function parseTimePeriodToDate(timePeriod: string | null | undefined): string | null {
  if (!timePeriod || !timePeriod.trim()) return null;

  const input = timePeriod.trim();

  const fyMatch = input.match(/^FY(\d{2,4})$/i);
  if (fyMatch) {
    let fyNumber = parseInt(fyMatch[1], 10);
    if (fyNumber < 100) fyNumber += 2000;
    const calendarYear = fyNumber - 1;
    const month = String(FISCAL_YEAR_START_MONTH).padStart(2, "0");
    return `${calendarYear}-${month}-01`;
  }

  const monthYearMatch = input.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monthYearMatch) {
    const monthNum = MONTH_NAMES[monthYearMatch[1].toLowerCase()];
    if (monthNum) {
      return `${monthYearMatch[2]}-${String(monthNum).padStart(2, "0")}-01`;
    }
  }

  const yearMonthMatch = input.match(/^(\d{4})-(\d{1,2})$/);
  if (yearMonthMatch) {
    const month = parseInt(yearMonthMatch[2], 10);
    if (month >= 1 && month <= 12) {
      return `${yearMonthMatch[1]}-${String(month).padStart(2, "0")}-01`;
    }
  }

  const qMatch = input.match(/^Q(\d)\s+(\d{4})$/i);
  if (qMatch) {
    const quarter = parseInt(qMatch[1], 10);
    const year = parseInt(qMatch[2], 10);
    if (quarter >= 1 && quarter <= 4) {
      const month = (quarter - 1) * 3 + 1;
      return `${year}-${String(month).padStart(2, "0")}-01`;
    }
  }

  return null;
}

export function extractFiscalYearContext(filename: string, documentText?: string): { fyNumber: number; startYear: number; endYear: number; startMonth: number } | null {
  const source = `${filename} ${(documentText || "").slice(0, 2000)}`;
  const fyMatch = source.match(/FY\s*(\d{2,4})/i);
  if (!fyMatch) return null;

  let fyNumber = parseInt(fyMatch[1], 10);
  if (fyNumber < 100) fyNumber += 2000;

  const startYear = fyNumber - 1;
  const endYear = fyNumber;
  return { fyNumber, startYear, endYear, startMonth: FISCAL_YEAR_START_MONTH };
}

export function buildFiscalYearPromptHint(filename: string, documentText?: string): string {
  const fy = extractFiscalYearContext(filename, documentText);
  if (!fy) return "";

  const monthName = Object.entries(MONTH_NAMES).find(([k, v]) => v === fy.startMonth && k.length > 3)?.[0] || "february";
  const capMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  const endMonthNum = fy.startMonth === 1 ? 12 : fy.startMonth - 1;
  const endMonthName = Object.entries(MONTH_NAMES).find(([k, v]) => v === endMonthNum && k.length > 3)?.[0] || "january";
  const capEndMonth = endMonthName.charAt(0).toUpperCase() + endMonthName.slice(1);

  return `IMPORTANT FISCAL YEAR CONTEXT: This document references FY${fy.fyNumber % 100}. ` +
    `FY${fy.fyNumber % 100} runs from ${capMonth} 1, ${fy.startYear} to ${capEndMonth} 31, ${fy.endYear}. ` +
    `So months ${capMonth} through December are in calendar year ${fy.startYear}, ` +
    `and January${fy.startMonth > 2 ? ` through ${capEndMonth}` : ""} is in calendar year ${fy.endYear}. ` +
    `Use the correct calendar year for each month — do NOT assume all months are in ${fy.endYear}.`;
}

export function correctMonthYear(month: string | undefined, filename: string, documentText?: string): string | undefined {
  if (!month) return month;

  const fy = extractFiscalYearContext(filename, documentText);
  if (!fy) return month;

  const match = month.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return month;

  const monthNum = MONTH_NAMES[match[1].toLowerCase()];
  const yearInLabel = parseInt(match[2], 10);
  if (!monthNum) return month;

  let correctYear: number;
  if (monthNum >= fy.startMonth) {
    correctYear = fy.startYear;
  } else {
    correctYear = fy.endYear;
  }

  if (yearInLabel !== correctYear) {
    return `${match[1]} ${correctYear}`;
  }
  return month;
}

export function computeRecencyWeight(timePeriodDate: string | null | undefined): number {
  if (!timePeriodDate) return 0;
  const docDate = new Date(timePeriodDate);
  const now = new Date();
  const monthsSince = (now.getFullYear() - docDate.getFullYear()) * 12 + (now.getMonth() - docDate.getMonth());
  return Math.max(0, 1 - monthsSince / 12);
}
