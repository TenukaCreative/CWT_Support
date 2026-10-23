import { prisma } from '../lib/prisma.js';

// Admin-tunable knobs live in the Setting table; code supplies the defaults.
export const SETTING_DEFAULTS = {
  faqRequireApproval: false,
  reopenWindowDays: 7, // customers may reopen a RESOLVED ticket within this many days
  autoCloseAfterDays: 7, // RESOLVED tickets close by themselves after this many days
  feedbackEditWindowHours: 24, // a rating can be edited for this long after it was given
};

export async function getSetting(key) {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row ? row.value : SETTING_DEFAULTS[key];
}

export async function getAllSettings() {
  const rows = await prisma.setting.findMany();
  return { ...SETTING_DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

export const setSetting = (key, value) =>
  prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
