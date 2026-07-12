import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { preprocessImageForVision } from './imagePreprocess.js';

const SHEET_TOOL = {
  name: 'record_daily_sheet',
  description: 'Record the extracted daily game room reconciliation sheet',
  input_schema: {
    type: 'object',
    required: ['machines', 'totals'],
    properties: {
      machines: {
        type: 'array',
        description: 'One entry per machine row (1..40). Skip nothing — include zero rows too.',
        items: {
          type: 'object',
          required: ['machine_number', 'prev_in', 'curr_in', 'daily_in', 'prev_out', 'curr_out', 'daily_out'],
          properties: {
            machine_number: { type: 'integer' },
            prev_in: { type: 'number' },
            curr_in: { type: 'number' },
            daily_in: { type: 'number' },
            prev_out: { type: 'number' },
            curr_out: { type: 'number' },
            daily_out: { type: 'number' },
          },
        },
      },
      totals: {
        type: 'object',
        required: ['total_in', 'total_out'],
        properties: {
          total_in: { type: 'number', description: 'TOTAL row Daily In / "Total In" box' },
          total_out: { type: 'number', description: 'TOTAL row Daily Out / "Total Out" box' },
        },
      },
      settlement: {
        type: 'object',
        properties: {
          match_amount: { type: 'number', description: 'Match row amount, 0 if blank' },
          loan_rtn: { type: 'number', description: 'Loan RTN amount, 0 if blank' },
        },
      },
      expenses: {
        type: 'array',
        description:
          'Non-empty expense rows. Every payee row under "Pay" (each row literally labeled "name" with a person\'s ' +
          'amount next to it) MUST use category "pay" — never use the category "name" itself, "name" is just the ' +
          'row label on the sheet, not a category. Other categories: "FD" row (label category as "family dollar", ' +
          'NOT "food"), coke, grass, cleaning, sams, walmart, misc, loan, rent, bonus, drawing, credit, referral',
        items: {
          type: 'object',
          required: ['category', 'amount'],
          properties: {
            category: { type: 'string' },
            amount: { type: 'number' },
          },
        },
      },
      bank: {
        type: 'object',
        properties: {
          start_bank: { type: 'number', description: 'Opening / Start Bank if shown' },
          end_bank: { type: 'number', description: 'New Bank / End Bank if shown' },
          meter_profit: { type: 'number', description: 'Profit (Loss) box; negative for loss' },
          over_short: { type: 'number', description: 'Short/Over box; negative if in parentheses/red' },
        },
      },
    },
  },
};

const MEDIA_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

export function mediaTypeForExt(ext) {
  return MEDIA_TYPES[ext.toLowerCase()] || null;
}

// The model occasionally returns `machines` as an object (e.g. keyed by row
// index) instead of a true array — never trust the shape of external/LLM
// output, coerce it here so nothing downstream has to guess.
export function normalizeMachines(machines) {
  return Array.isArray(machines) ? machines : Object.values(machines || {});
}

// "name" is the row label on the sheet for a payee under Pay, not a real
// category — the model sometimes uses it as the category verbatim despite
// the prompt, producing a duplicate-looking "name" entry alongside "pay".
export function normalizeExpenses(expenses) {
  return (Array.isArray(expenses) ? expenses : []).map((e) => ({
    ...e,
    category: String(e?.category || '').trim().toLowerCase() === 'name' ? 'pay' : e.category,
  }));
}

/** Extract sheet data from a photo/screenshot using Claude vision with forced tool_use. */
export async function extractFromImage(buffer) {
  if (!config.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured — image extraction unavailable. Upload the .xlsx file instead.');
  }
  // Downscale (if oversized)/sharpen/normalize ourselves before Claude ever
  // sees it — see imagePreprocess.js for why this matters for dense tables.
  const prepared = await preprocessImageForVision(buffer);
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 8000,
    tools: [SHEET_TOOL],
    tool_choice: { type: 'tool', name: 'record_daily_sheet' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: prepared.mediaType, data: prepared.buffer.toString('base64') },
          },
          {
            type: 'text',
            text: [
              'This is a daily game room reconciliation sheet with a machine meter table',
              '(#, Previous In, Current In, Daily In, Previous Out, Current Out, Daily Out, Hold),',
              'a settlement box (Total Out, Match, Pay names, expense rows, Total In, Loan RTN)',
              'and a Bank box (Opening, Profit (Loss), Short/Over, New Bank).',
              'Read every machine row exactly as printed, including rows that are all zeros.',
              'Numbers in parentheses or red are negative.',
              'Empty cells rendered as "-" mean zero — never treat a leading "-" as a minus sign on the next value.',
              'Record the data with the tool.',
            ].join(' '),
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('Extraction failed — model returned no structured data');
  const data = toolUse.input;

  return {
    machines: normalizeMachines(data.machines),
    totals: data.totals || {},
    settlement: {
      match_amount: data.settlement?.match_amount || 0,
      loan_rtn: data.settlement?.loan_rtn || 0,
    },
    expenses: normalizeExpenses(data.expenses),
    bank: data.bank || {},
  };
}
